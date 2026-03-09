const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
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
  try {
    const { TransactionType, TransID, TransTime, TransAmount, BillRefNumber, MSISDN, FirstName, MiddleName, LastName } = req.body;

    // Log the transaction
    const { data: mpesaTx, error: mpesaError } = await supabase
      .from('mpesa_transactions')
      .insert({
        transaction_type: TransactionType || 'Payment',
        transaction_id: TransID,
        transaction_time: new Date(TransTime),
        amount: TransAmount,
        phone_number: MSISDN,
        first_name: FirstName,
        last_name: LastName || MiddleName,
        status: 'pending'
      })
      .select()
      .single();

    if (mpesaError) throw mpesaError;

    // Try to match with invoice
    let matchedInvoice = null;

    // Check if it's for an order
    if (BillRefNumber) {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, total_amount')
        .eq('order_number', BillRefNumber);

      if (orders && orders.length > 0) {
        const order = orders[0];
        
        await supabase
          .from('payments')
          .insert({
            order_id: order.id,
            amount: TransAmount,
            payment_method: 'mpesa',
            mpesa_receipt: TransID,
            mpesa_phone: MSISDN,
            status: 'completed'
          });

        matchedInvoice = { type: 'order', id: order.id };
      }
    }

    // Update mpesa transaction status
    if (mpesaTx) {
      await supabase
        .from('mpesa_transactions')
        .update({ 
          status: matchedInvoice ? 'matched' : 'pending',
          invoice_id: matchedInvoice?.id 
        })
        .eq('id', mpesaTx.id);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (error) {
    console.error('M-Pesa callback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get M-Pesa transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { status, from_date, to_date, limit = 100 } = req.query;
    
    let query = supabase
      .from('mpesa_transactions')
      .select('*')
      .order('transaction_time', { ascending: false })
      .limit(parseInt(limit));

    if (status) query = query.eq('status', status);
    if (from_date) query = query.gte('transaction_time', from_date);
    if (to_date) query = query.lte('transaction_time', to_date);

    const { data: transactions, error } = await query;

    if (error) throw error;
    res.json({ transactions });
  } catch (error) {
    console.error('Get M-Pesa transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record manual M-Pesa payment
router.post('/record-payment', authenticateToken, async (req, res) => {
  try {
    const { order_id, room_booking_id, catering_event_id, amount, phone_number, receipt_number, notes } = req.body;

    const transactionId = receipt_number || `MPS${Date.now()}`;

    const { data: mpesaTx, error: mpesaError } = await supabase
      .from('mpesa_transactions')
      .insert({
        transaction_type: 'Payment',
        transaction_id: transactionId,
        transaction_time: new Date(),
        amount,
        phone_number,
        first_name: 'Customer',
        invoice_id: order_id || room_booking_id || catering_event_id,
        status: 'matched'
      })
      .select()
      .single();

    if (mpesaError) throw mpesaError;

    // Create payment record
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        order_id,
        room_booking_id,
        catering_event_id,
        amount,
        payment_method: 'mpesa',
        mpesa_receipt: transactionId,
        mpesa_phone: phone_number,
        processed_by: req.user.id,
        notes,
        status: 'completed'
      });

    if (paymentError) throw paymentError;

    // Update order status if fully paid
    if (order_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('id', order_id)
        .single();

      if (order) {
        const { data: payments } = await supabase
          .from('payments')
          .select('amount')
          .eq('order_id', order_id);

        const paidAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        if (paidAmount >= parseFloat(order.total_amount)) {
          await supabase
            .from('orders')
            .update({ 
              status: 'completed', 
              updated_at: new Date().toISOString() 
            })
            .eq('id', order_id);
        }
      }
    }

    await logActivity(req.user.id, 'MPESA_PAYMENT', 'payments', `Recorded M-Pesa payment: ${transactionId}`, req);

    res.status(201).json({ 
      message: 'M-Pesa payment recorded',
      transaction: mpesaTx
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

    let query = supabase
      .from('mpesa_transactions')
      .select('amount, status');

    if (from_date) query = query.gte('transaction_time', from_date);
    if (to_date) query = query.lte('transaction_time', to_date);

    const { data: transactions, error } = await query;

    if (error) throw error;

    const totalTransactions = transactions.length;
    const totalAmount = transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const matched = transactions.filter(t => t.status === 'matched').length;

    res.json({ 
      summary: { 
        total_transactions: totalTransactions,
        total_amount: totalAmount,
        matched
      } 
    });
  } catch (error) {
    console.error('Get M-Pesa summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
