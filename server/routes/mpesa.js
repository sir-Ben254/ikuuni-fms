const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// M-Pesa STK Push simulation (In production, integrate with Safaricom API)
router.post('/stk-push', authenticateToken, async (req, res) => {
  try {
    const { phone_number, amount, invoice_id, description } = req.body;

    // In production, this would call Safaricom's API
    // For now, we'll simulate a successful transaction
    
    const transactionId = `MPS${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Simulate STK push response
    res.json({
      success: true,
      message: 'STK Push initiated',
      transaction_id: transactionId,
      checkout_request_id: `CK${Date.now()}`,
      note: 'In production, this would trigger an STK push to the phone'
    });
  } catch (error) {
    console.error('STK Push error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// M-Pesa callback (For processing payment notifications)
router.post('/callback', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { TransactionType, TransID, TransTime, TransAmount, BillRefNumber, InvoiceNumber, ThirdPartyTransID, MSISDN, FirstName, MiddleName, LastName } = req.body;

    // Log the transaction
    await client.query(
      `INSERT INTO mpesa_transactions (transaction_type, transaction_id, transaction_time, amount, phone_number, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [TransactionType || 'Payment', TransID, new Date(TransTime), TransAmount, MSISDN, FirstName, LastName || MiddleName]
    );

    // Try to match with invoice
    let matchedInvoice = null;

    // Check if it's for an order
    if (BillRefNumber || InvoiceNumber) {
      const orderResult = await client.query(
        `SELECT id, total_amount, paid_amount FROM orders WHERE order_number = $1`,
        [BillRefNumber || InvoiceNumber]
      );

      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const newPaidAmount = parseFloat(order.paid_amount || 0) + parseFloat(TransAmount);

        await client.query(
          `INSERT INTO payments (order_id, amount, payment_method, mpesa_receipt, mpesa_phone, status)
           VALUES ($1, $2, 'mpesa', $3, $4, 'completed')`,
          [order.id, TransAmount, TransID, MSISDN]
        );

        if (newPaidAmount >= parseFloat(order.total_amount)) {
          await client.query(
            `UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [order.id]
          );
        }

        matchedInvoice = { type: 'order', id: order.id };
      }
    }

    // Update mpesa transaction status
    await client.query(
      `UPDATE mpesa_transactions SET status = 'matched', invoice_id = $1 WHERE transaction_id = $2`,
      [matchedInvoice?.id, TransID]
    );

    await client.query('COMMIT');

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('M-Pesa callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get M-Pesa transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { status, from_date, to_date, limit = 100 } = req.query;
    
    let query = `SELECT * FROM mpesa_transactions WHERE 1=1`;
    const values = [];
    let paramCount = 1;

    if (status) {
      query += ` AND status = $${paramCount++}`;
      values.push(status);
    }
    if (from_date) {
      query += ` AND transaction_time >= $${paramCount++}`;
      values.push(from_date);
    }
    if (to_date) {
      query += ` AND transaction_time <= $${paramCount++}`;
      values.push(to_date);
    }

    query += ` ORDER BY transaction_time DESC LIMIT $${paramCount++}`;
    values.push(parseInt(limit));

    const result = await pool.query(query, values);
    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('Get M-Pesa transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record manual M-Pesa payment
router.post('/record-payment', authenticateToken, async (req, res) => {
  try {
    const { order_id, room_booking_id, catering_event_id, amount, phone_number, receipt_number, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO mpesa_transactions (transaction_type, transaction_id, transaction_time, amount, phone_number, first_name, invoice_id, status)
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, 'matched')
       RETURNING *`,
      ['Payment', receipt_number || `MPS${Date.now()}`, amount, phone_number, 'Customer', order_id || room_booking_id || catering_event_id]
    );

    // Create payment record
    await pool.query(
      `INSERT INTO payments (order_id, room_booking_id, catering_event_id, amount, payment_method, mpesa_receipt, mpesa_phone, processed_by, notes)
       VALUES ($1, $2, $3, $4, 'mpesa', $5, $6, $7, $8)`,
      [order_id, room_booking_id, catering_event_id, amount, receipt_number, phone_number, req.user.id, notes]
    );

    // Update order/booking status if fully paid
    if (order_id) {
      const orderResult = await pool.query(
        `SELECT total_amount, paid_amount FROM orders WHERE id = $1`,
        [order_id]
      );

      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const newPaidAmount = parseFloat(order.paid_amount || 0) + parseFloat(amount);

        if (newPaidAmount >= parseFloat(order.total_amount)) {
          await pool.query(
            `UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [order_id]
          );
        }
      }
    }

    await logActivity(req.user.id, 'MPESA_PAYMENT', 'payments', `Recorded M-Pesa payment: ${receipt_number}`, req);

    res.status(201).json({ 
      message: 'M-Pesa payment recorded',
      transaction: result.rows[0]
    });
  } catch (error) {
    console.error('Record M-Pesa payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get M-Pesa summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    let filter = '';
    const values = [];

    if (from_date && to_date) {
      filter = `WHERE transaction_time BETWEEN $1 AND $2`;
      values.push(from_date, to_date);
    }

    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0) as total_amount,
        COUNT(*) FILTER (WHERE status = 'matched') as matched
       FROM mpesa_transactions ${filter}`,
      values
    );

    res.json({ summary: result.rows[0] });
  } catch (error) {
    console.error('Get M-Pesa summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
