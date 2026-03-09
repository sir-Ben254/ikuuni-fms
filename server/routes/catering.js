const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get all menu packages
router.get('/packages', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM menu_packages WHERE is_active = true ORDER BY name`
    );
    res.json({ packages: result.rows });
  } catch (error) {
    console.error('Get packages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create menu package
router.post('/packages', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, description, price_per_person, menu_items } = req.body;

    const result = await pool.query(
      `INSERT INTO menu_packages (name, description, price_per_person, menu_items)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, description, price_per_person, JSON.stringify(menu_items || [])]
    );

    await logActivity(req.user.id, 'CREATE', 'catering', `Created menu package: ${name}`, req);
    res.status(201).json({ package: result.rows[0] });
  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get catering events
router.get('/events', authenticateToken, async (req, res) => {
  try {
    const { status, from_date, to_date } = req.query;
    
    let query = `
      SELECT ce.*, mp.name as package_name, u.full_name as created_by_name
      FROM catering_events ce
      LEFT JOIN menu_packages mp ON ce.menu_package_id = mp.id
      LEFT JOIN users u ON ce.created_by = u.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (status) {
      query += ` AND ce.status = $${paramCount++}`;
      values.push(status);
    }
    if (from_date) {
      query += ` AND ce.event_date >= $${paramCount++}`;
      values.push(from_date);
    }
    if (to_date) {
      query += ` AND ce.event_date <= $${paramCount++}`;
      values.push(to_date);
    }

    query += ` ORDER BY ce.event_date DESC`;

    const result = await pool.query(query, values);
    res.json({ events: result.rows });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create catering event
router.post('/events', authenticateToken, async (req, res) => {
  try {
    const {
      event_name, client_name, client_phone, client_email,
      event_date, event_type, venue, number_of_guests,
      menu_package_id, price_per_person, transport_cost, staff_cost,
      notes
    } = req.body;

    const subtotal = price_per_person * number_of_guests;
    const total_cost = (transport_cost || 0) + (staff_cost || 0);
    const total_amount = subtotal;

    const result = await pool.query(
      `INSERT INTO catering_events (
        event_name, client_name, client_phone, client_email,
        event_date, event_type, venue, number_of_guests,
        menu_package_id, price_per_person, subtotal, transport_cost,
        staff_cost, total_cost, total_amount, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [
        event_name, client_name, client_phone, client_email,
        event_date, event_type, venue, number_of_guests,
        menu_package_id, price_per_person, subtotal, transport_cost || 0,
        staff_cost || 0, total_cost, total_amount, notes, req.user.id
      ]
    );

    await logActivity(req.user.id, 'CREATE', 'catering', `Created catering event: ${event_name}`, req);
    res.status(201).json({ event: result.rows[0] });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update catering event
router.put('/events/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const values = [];
    let paramCount = 1;

    const fields = [
      'event_name', 'client_name', 'client_phone', 'client_email',
      'event_date', 'event_type', 'venue', 'number_of_guests',
      'menu_package_id', 'price_per_person', 'transport_cost', 'staff_cost',
      'status', 'notes'
    ];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramCount++}`);
        values.push(req.body[field]);
      }
    }

    // Recalculate totals if relevant fields changed
    if (req.body.number_of_guests || req.body.price_per_person) {
      const current = await pool.query(`SELECT * FROM catering_events WHERE id = $1`, [id]);
      if (current.rows.length > 0) {
        const c = current.rows[0];
        const guests = req.body.number_of_guests || c.number_of_guests;
        const price = req.body.price_per_person || c.price_per_person;
        const subtotal = guests * price;
        
        updates.push(`subtotal = $${paramCount++}`);
        values.push(subtotal);
        updates.push(`total_amount = $${paramCount++}`);
        values.push(subtotal);
      }
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE catering_events SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'catering', `Updated catering event: ${id}`, req);
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Assign staff to event
router.post('/events/:id/staff', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { staff_ids, role } = req.body;

    for (const staff_id of staff_ids) {
      await pool.query(
        `INSERT INTO catering_staff (event_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [id, staff_id, role || 'staff']
      );
    }

    await logActivity(req.user.id, 'ASSIGN', 'catering', `Assigned staff to event: ${id}`, req);
    res.json({ message: 'Staff assigned successfully' });
  } catch (error) {
    console.error('Assign staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record payment for event
router.post('/events/:id/payment', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { amount, payment_method, reference_number, mpesa_receipt, notes } = req.body;

    // Get current event
    const eventResult = await client.query(
      `SELECT * FROM catering_events WHERE id = $1`,
      [id]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];
    const newPaidAmount = parseFloat(event.paid_amount) + parseFloat(amount);

    // Create payment
    await client.query(
      `INSERT INTO payments (catering_event_id, amount, payment_method, reference_number, mpesa_receipt, processed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, amount, payment_method, reference_number, mpesa_receipt, req.user.id, notes]
    );

    // Update event payment status
    let paymentStatus = 'partial';
    if (newPaidAmount >= parseFloat(event.total_amount)) {
      paymentStatus = 'paid';
    }

    await client.query(
      `UPDATE catering_events SET paid_amount = $1, payment_status = $2 WHERE id = $3`,
      [newPaidAmount, paymentStatus, id]
    );

    await client.query('COMMIT');

    await logActivity(req.user.id, 'PAYMENT', 'catering', `Payment for event: ${event.event_name}`, req);

    const updatedEvent = await pool.query(`SELECT * FROM catering_events WHERE id = $1`, [id]);
    res.json({ 
      message: 'Payment recorded successfully',
      event: updatedEvent.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Complete event
router.post('/events/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE catering_events SET status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await logActivity(req.user.id, 'COMPLETE', 'catering', `Completed event: ${id}`, req);
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Complete event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get catering statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'booked') as booked_events,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_events,
        COUNT(*) FILTER (WHERE event_date = CURRENT_DATE) as today_events,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed'), 0) as total_revenue,
        COALESCE(SUM(paid_amount) FILTER (WHERE status != 'cancelled'), 0) as collected_amount
       FROM catering_events`
    );

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    console.error('Get catering stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
