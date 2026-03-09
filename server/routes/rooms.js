const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get all rooms
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = `SELECT * FROM rooms`;
    const values = [];

    if (status) {
      query += ` WHERE status = $1`;
      values.push(status);
    }

    query += ` ORDER BY room_number`;

    const result = await pool.query(query, values);
    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create room
router.post('/', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { room_number, room_type, price_per_night, amenities, description } = req.body;

    const result = await pool.query(
      `INSERT INTO rooms (room_number, room_type, price_per_night, amenities, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [room_number, room_type, price_per_night, amenities || [], description]
    );

    await logActivity(req.user.id, 'CREATE', 'rooms', `Created room: ${room_number}`, req);
    res.status(201).json({ room: result.rows[0] });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update room
router.put('/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { room_number, room_type, price_per_night, status, amenities, description } = req.body;

    const result = await pool.query(
      `UPDATE rooms 
       SET room_number = COALESCE($1, room_number), 
           room_type = COALESCE($2, room_type),
           price_per_night = COALESCE($3, price_per_night),
           status = COALESCE($4, status),
           amenities = COALESCE($5, amenities),
           description = COALESCE($6, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [room_number, room_type, price_per_night, status, amenities, description, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'rooms', `Updated room: ${id}`, req);
    res.json({ room: result.rows[0] });
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get room availability for date range
router.get('/availability', authenticateToken, async (req, res) => {
  try {
    const { check_in, check_out } = req.query;

    const result = await pool.query(
      `SELECT r.*, 
       CASE WHEN rb.id IS NULL THEN true ELSE false END as is_available
       FROM rooms r
       LEFT JOIN room_bookings rb ON r.id = rb.room_id 
         AND rb.payment_status != 'cancelled'
         AND (rb.check_in, rb.check_out) OVERLAPS ($1::date, $2::date)
       ORDER BY r.room_number`,
      [check_in, check_out]
    );

    res.json({ rooms: result.rows });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all guests
router.get('/guests', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM guests ORDER BY created_at DESC`
    );
    res.json({ guests: result.rows });
  } catch (error) {
    console.error('Get guests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create guest
router.post('/guests', authenticateToken, async (req, res) => {
  try {
    const { full_name, email, phone, id_number, address, nationality } = req.body;

    const result = await pool.query(
      `INSERT INTO guests (full_name, email, phone, id_number, address, nationality)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [full_name, email, phone, id_number, address, nationality]
    );

    res.status(201).json({ guest: result.rows[0] });
  } catch (error) {
    console.error('Create guest error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create booking
router.post('/bookings', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { room_id, guest_id, check_in, check_out, number_of_guests, payment_method, mpesa_receipt, notes } = req.body;

    // Get room price
    const roomResult = await client.query(
      `SELECT * FROM rooms WHERE id = $1`,
      [room_id]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    // Check availability
    const availabilityResult = await client.query(
      `SELECT id FROM room_bookings 
       WHERE room_id = $1 AND payment_status != 'cancelled'
       AND (check_in, check_out) OVERLAPS ($2::date, $3::date)`,
      [room_id, check_in, check_out]
    );

    if (availabilityResult.rows.length > 0) {
      return res.status(400).json({ error: 'Room is not available for selected dates' });
    }

    // Calculate nights and total
    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const totalAmount = room.price_per_night * nights;

    // Create booking
    const bookingResult = await client.query(
      `INSERT INTO room_bookings (room_id, guest_id, check_in, check_out, number_of_guests, total_amount, payment_method, mpesa_receipt, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [room_id, guest_id, check_in, check_out, number_of_guests || 1, totalAmount, payment_method, mpesa_receipt, notes, req.user.id]
    );

    const booking = bookingResult.rows[0];

    // If payment made, record payment and update room status
    if (payment_method) {
      const paymentAmount = totalAmount;
      
      await client.query(
        `INSERT INTO payments (room_booking_id, amount, payment_method, mpesa_receipt, processed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [booking.id, paymentAmount, payment_method, mpesa_receipt, req.user.id]
      );

      await client.query(
        `UPDATE room_bookings SET payment_status = 'paid', paid_amount = $1 WHERE id = $2`,
        [paymentAmount, booking.id]
      );

      await client.query(
        `UPDATE rooms SET status = 'occupied' WHERE id = $1`,
        [room_id]
      );
    }

    await client.query('COMMIT');

    await logActivity(req.user.id, 'CREATE', 'bookings', `Created room booking for room ${room.room_number}`, req);

    // Get full booking details
    const fullBooking = await pool.query(
      `SELECT rb.*, r.room_number, r.room_type, g.full_name as guest_name, g.phone as guest_phone
       FROM room_bookings rb
       JOIN rooms r ON rb.room_id = r.id
       JOIN guests g ON rb.guest_id = g.id
       WHERE rb.id = $1`,
      [booking.id]
    );

    res.status(201).json({ booking: fullBooking.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get bookings
router.get('/bookings', authenticateToken, async (req, res) => {
  try {
    const { status, date } = req.query;
    
    let query = `
      SELECT rb.*, r.room_number, r.room_type, g.full_name as guest_name, g.phone as guest_phone
      FROM room_bookings rb
      JOIN rooms r ON rb.room_id = r.id
      JOIN guests g ON rb.guest_id = g.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (status) {
      query += ` AND rb.payment_status = $${paramCount++}`;
      values.push(status);
    }
    if (date) {
      query += ` AND $${paramCount++}::date BETWEEN rb.check_in AND rb.check_out`;
      values.push(date);
    }

    query += ` ORDER BY rb.check_in DESC`;

    const result = await pool.query(query, values);
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check-in
router.post('/bookings/:id/check-in', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const bookingResult = await pool.query(
      `SELECT rb.*, r.room_number FROM room_bookings rb
       JOIN rooms r ON rb.room_id = r.id
       WHERE rb.id = $1`,
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Update room status
    await pool.query(
      `UPDATE rooms SET status = 'occupied' WHERE id = $1`,
      [booking.room_id]
    );

    await logActivity(req.user.id, 'CHECK_IN', 'rooms', `Guest checked in to room ${booking.room_number}`, req);

    res.json({ message: 'Check-in successful', booking: bookingResult.rows[0] });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check-out
router.post('/bookings/:id/check-out', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { additional_charges = 0, payment_method, mpesa_receipt } = req.body;

    const bookingResult = await client.query(
      `SELECT rb.*, r.room_number FROM room_bookings rb
       JOIN rooms r ON rb.room_id = r.id
       WHERE rb.id = $1`,
      [id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    // Calculate final amount
    const totalDue = parseFloat(booking.total_amount) + parseFloat(additional_charges);
    const balance = totalDue - parseFloat(booking.paid_amount);

    // Process payment if there's balance
    if (balance > 0 && payment_method) {
      await client.query(
        `INSERT INTO payments (room_booking_id, amount, payment_method, mpesa_receipt, processed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, balance, payment_method, mpesa_receipt, req.user.id]
      );

      await client.query(
        `UPDATE room_bookings SET paid_amount = paid_amount + $1, payment_status = 'paid' WHERE id = $2`,
        [balance, id]
      );
    }

    // Update room status
    await client.query(
      `UPDATE rooms SET status = 'available' WHERE id = $1`,
      [booking.room_id]
    );

    await client.query('COMMIT');

    await logActivity(req.user.id, 'CHECK_OUT', 'rooms', `Guest checked out from room ${booking.room_number}`, req);

    const updatedBooking = await pool.query(
      `SELECT rb.*, r.room_number FROM room_bookings rb
       JOIN rooms r ON rb.room_id = r.id
       WHERE rb.id = $1`,
      [id]
    );

    res.json({ 
      message: 'Check-out successful', 
      booking: updatedBooking.rows[0],
      totalDue,
      balance
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Check-out error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get room statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total_rooms,
        COUNT(*) FILTER (WHERE status = 'occupied') as occupied_rooms,
        COUNT(*) FILTER (WHERE status = 'available') as available_rooms,
        COUNT(*) FILTER (WHERE status = 'maintenance') as maintenance_rooms,
        COALESCE(SUM(price_per_night) FILTER (WHERE status = 'occupied'), 0) as occupied_revenue
       FROM rooms`
    );

    const todayBookings = await pool.query(
      `SELECT COUNT(*) as today_checkins
       FROM room_bookings 
       WHERE check_in = CURRENT_DATE AND payment_status != 'cancelled'`
    );

    res.json({
      stats: stats.rows[0],
      todayCheckins: todayBookings.rows[0]
    });
  } catch (error) {
    console.error('Get room stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
