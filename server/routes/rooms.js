const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get all rooms
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = supabase
      .from('rooms')
      .select('*');

    if (status) query = query.eq('status', status);

    const { data: rooms, error } = await query.order('room_number');

    if (error) throw error;
    res.json({ rooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create room
router.post('/', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { room_number, room_type, price_per_night, amenities, description } = req.body;

    const { data: room, error } = await supabase
      .from('rooms')
      .insert({
        room_number,
        room_type,
        price_per_night,
        amenities: amenities || [],
        description
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'rooms', `Created room: ${room_number}`, req);
    res.status(201).json({ room });
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

    const updates = {};
    if (room_number) updates.room_number = room_number;
    if (room_type) updates.room_type = room_type;
    if (price_per_night) updates.price_per_night = price_per_night;
    if (status) updates.status = status;
    if (amenities) updates.amenities = amenities;
    if (description !== undefined) updates.description = description;
    updates.updated_at = new Date().toISOString();

    const { data: room, error } = await supabase
      .from('rooms')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'rooms', `Updated room: ${id}`, req);
    res.json({ room });
  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get room availability for date range
router.get('/availability', authenticateToken, async (req, res) => {
  try {
    const { check_in, check_out } = req.query;

    // Get all rooms
    const { data: rooms } = await supabase
      .from('rooms')
      .select('*')
      .order('room_number');

    // Get bookings that overlap with the requested dates
    const { data: bookings } = await supabase
      .from('room_bookings')
      .select('room_id')
      .neq('payment_status', 'cancelled')
      .lte('check_in', check_out)
      .gte('check_out', check_in);

    const bookedRoomIds = new Set(bookings.map(b => b.room_id));

    // Mark rooms as available or not
    const roomsWithAvailability = rooms.map(room => ({
      ...room,
      is_available: !bookedRoomIds.has(room.id)
    }));

    res.json({ rooms: roomsWithAvailability });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all guests
router.get('/guests', authenticateToken, async (req, res) => {
  try {
    const { data: guests, error } = await supabase
      .from('guests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ guests });
  } catch (error) {
    console.error('Get guests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create guest
router.post('/guests', authenticateToken, async (req, res) => {
  try {
    const { full_name, email, phone, id_number, address, nationality } = req.body;

    const { data: guest, error } = await supabase
      .from('guests')
      .insert({
        full_name,
        email,
        phone,
        id_number,
        address,
        nationality
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ guest });
  } catch (error) {
    console.error('Create guest error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create booking
router.post('/bookings', authenticateToken, async (req, res) => {
  try {
    const { room_id, guest_id, check_in, check_out, number_of_guests, payment_method, mpesa_receipt, notes } = req.body;

    // Get room price
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', room_id)
      .single();

    if (roomError || !room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Calculate nights and total
    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const totalAmount = room.price_per_night * nights;

    // Create booking
    const { data: booking, error: bookingError } = await supabase
      .from('room_bookings')
      .insert({
        room_id,
        guest_id,
        check_in,
        check_out,
        number_of_guests: number_of_guests || 1,
        total_amount: totalAmount,
        payment_method,
        mpesa_receipt,
        notes,
        created_by: req.user.id
      })
      .select()
      .single();

    if (bookingError) throw bookingError;

    // If payment made, record payment and update room status
    if (payment_method) {
      const paymentAmount = totalAmount;
      
      await supabase
        .from('payments')
        .insert({
          room_booking_id: booking.id,
          amount: paymentAmount,
          payment_method,
          mpesa_receipt,
          processed_by: req.user.id,
          status: 'completed'
        });

      await supabase
        .from('room_bookings')
        .update({ payment_status: 'paid', paid_amount: paymentAmount })
        .eq('id', booking.id);

      await supabase
        .from('rooms')
        .update({ status: 'occupied' })
        .eq('id', room_id);
    }

    await logActivity(req.user.id, 'CREATE', 'bookings', `Created room booking for room ${room.room_number}`, req);

    // Get full booking details
    const { data: fullBooking } = await supabase
      .from('room_bookings')
      .select('*, rooms(room_number, room_type), guests(full_name, phone)')
      .eq('id', booking.id)
      .single();

    res.status(201).json({ booking: fullBooking });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get bookings
router.get('/bookings', authenticateToken, async (req, res) => {
  try {
    const { status, date } = req.query;
    
    let query = supabase
      .from('room_bookings')
      .select('*, rooms(room_number, room_type), guests(full_name, phone)')
      .order('check_in', { ascending: false });

    if (status) query = query.eq('payment_status', status);
    if (date) {
      query = query.lte('check_in', date).gte('check_out', date);
    }

    const { data: bookings, error } = await query;

    if (error) throw error;
    res.json({ bookings });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check-in
router.post('/bookings/:id/check-in', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: booking, error } = await supabase
      .from('room_bookings')
      .select('*, rooms(room_number)')
      .eq('id', id)
      .single();

    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Update room status
    await supabase
      .from('rooms')
      .update({ status: 'occupied' })
      .eq('id', booking.room_id);

    await logActivity(req.user.id, 'CHECK_IN', 'rooms', `Guest checked in to room ${booking.rooms?.room_number}`, req);

    res.json({ message: 'Check-in successful', booking });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check-out
router.post('/bookings/:id/check-out', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { additional_charges = 0, payment_method, mpesa_receipt } = req.body;

    const { data: booking, error } = await supabase
      .from('room_bookings')
      .select('*, rooms(room_number)')
      .eq('id', id)
      .single();

    if (error || !booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Calculate final amount
    const totalDue = parseFloat(booking.total_amount) + parseFloat(additional_charges);
    const balance = totalDue - parseFloat(booking.paid_amount || 0);

    // Process payment if there's balance
    if (balance > 0 && payment_method) {
      await supabase
        .from('payments')
        .insert({
          room_booking_id: id,
          amount: balance,
          payment_method,
          mpesa_receipt,
          processed_by: req.user.id,
          status: 'completed'
        });

      await supabase
        .from('room_bookings')
        .update({ 
          paid_amount: parseFloat(booking.paid_amount || 0) + balance, 
          payment_status: 'paid' 
        })
        .eq('id', id);
    }

    // Update room status
    await supabase
      .from('rooms')
      .update({ status: 'available' })
      .eq('id', booking.room_id);

    await logActivity(req.user.id, 'CHECK_OUT', 'rooms', `Guest checked out from room ${booking.rooms?.room_number}`, req);

    const { data: updatedBooking } = await supabase
      .from('room_bookings')
      .select('*, rooms(room_number)')
      .eq('id', id)
      .single();

    res.json({ 
      message: 'Check-out successful', 
      booking: updatedBooking,
      totalDue,
      balance
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get room statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { data: rooms } = await supabase
      .from('rooms')
      .select('status, price_per_night');

    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'occupied').length;
    const availableRooms = rooms.filter(r => r.status === 'available').length;
    const maintenanceRooms = rooms.filter(r => r.status === 'maintenance').length;
    const occupiedRevenue = rooms
      .filter(r => r.status === 'occupied')
      .reduce((sum, r) => sum + parseFloat(r.price_per_night || 0), 0);

    const today = new Date().toISOString().slice(0, 10);
    const { count: todayCheckins } = await supabase
      .from('room_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('check_in', today)
      .neq('payment_status', 'cancelled');

    res.json({
      stats: {
        total_rooms: totalRooms,
        occupied_rooms: occupiedRooms,
        available_rooms: availableRooms,
        maintenance_rooms: maintenanceRooms,
        occupied_revenue: occupiedRevenue
      },
      todayCheckins: {
        today_checkins: todayCheckins || 0
      }
    });
  } catch (error) {
    console.error('Get room stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
