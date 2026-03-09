const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get all menu packages
router.get('/packages', authenticateToken, async (req, res) => {
  try {
    const { data: packages, error } = await supabase
      .from('menu_packages')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json({ packages });
  } catch (error) {
    console.error('Get packages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create menu package
router.post('/packages', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, description, price_per_person, menu_items } = req.body;

    const { data: pkg, error } = await supabase
      .from('menu_packages')
      .insert({
        name,
        description,
        price_per_person,
        menu_items: menu_items || [],
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'catering', `Created menu package: ${name}`, req);
    res.status(201).json({ package: pkg });
  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get catering events
router.get('/events', authenticateToken, async (req, res) => {
  try {
    const { status, from_date, to_date } = req.query;
    
    let query = supabase
      .from('catering_events')
      .select('*, menu_packages(name), users!catering_events_created_by_fkey(full_name)')
      .order('event_date', { ascending: false });

    if (status) query = query.eq('status', status);
    if (from_date) query = query.gte('event_date', from_date);
    if (to_date) query = query.lte('event_date', to_date);

    const { data: events, error } = await query;

    if (error) throw error;
    res.json({ events });
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

    const { data: event, error } = await supabase
      .from('catering_events')
      .insert({
        event_name,
        client_name,
        client_phone,
        client_email,
        event_date,
        event_type,
        venue,
        number_of_guests,
        menu_package_id,
        price_per_person,
        subtotal,
        transport_cost: transport_cost || 0,
        staff_cost: staff_cost || 0,
        total_cost,
        total_amount,
        notes,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'catering', `Created catering event: ${event_name}`, req);
    res.status(201).json({ event });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update catering event
router.put('/events/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      event_name, client_name, client_phone, client_email,
      event_date, event_type, venue, number_of_guests,
      menu_package_id, price_per_person, transport_cost, staff_cost,
      status, notes
    } = req.body;

    const updates = {};
    if (event_name) updates.event_name = event_name;
    if (client_name) updates.client_name = client_name;
    if (client_phone) updates.client_phone = client_phone;
    if (client_email) updates.client_email = client_email;
    if (event_date) updates.event_date = event_date;
    if (event_type) updates.event_type = event_type;
    if (venue) updates.venue = venue;
    if (number_of_guests) updates.number_of_guests = number_of_guests;
    if (menu_package_id) updates.menu_package_id = menu_package_id;
    if (price_per_person) updates.price_per_person = price_per_person;
    if (transport_cost !== undefined) updates.transport_cost = transport_cost;
    if (staff_cost !== undefined) updates.staff_cost = staff_cost;
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    updates.updated_at = new Date().toISOString();

    // Recalculate totals if relevant fields changed
    if (number_of_guests || price_per_person) {
      const { data: current } = await supabase
        .from('catering_events')
        .select('number_of_guests, price_per_person')
        .eq('id', id)
        .single();
      
      if (current) {
        const guests = number_of_guests || current.number_of_guests;
        const price = price_per_person || current.price_per_person;
        updates.subtotal = guests * price;
        updates.total_amount = guests * price;
      }
    }

    const { data: event, error } = await supabase
      .from('catering_events')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'catering', `Updated catering event: ${id}`, req);
    res.json({ event });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record payment for event
router.post('/events/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, payment_method, reference_number, mpesa_receipt, notes } = req.body;

    // Get current event
    const { data: event, error: eventError } = await supabase
      .from('catering_events')
      .select('*')
      .eq('id', id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const newPaidAmount = parseFloat(event.paid_amount || 0) + parseFloat(amount);

    // Create payment
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        catering_event_id: id,
        amount,
        payment_method,
        reference_number,
        mpesa_receipt,
        processed_by: req.user.id,
        notes,
        status: 'completed'
      });

    if (paymentError) throw paymentError;

    // Update event payment status
    let paymentStatus = 'partial';
    if (newPaidAmount >= parseFloat(event.total_amount)) {
      paymentStatus = 'paid';
    }

    await supabase
      .from('catering_events')
      .update({ 
        paid_amount: newPaidAmount, 
        payment_status: paymentStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    await logActivity(req.user.id, 'PAYMENT', 'catering', `Payment for event: ${event.event_name}`, req);

    const { data: updatedEvent } = await supabase
      .from('catering_events')
      .select('*')
      .eq('id', id)
      .single();

    res.json({ 
      message: 'Payment recorded successfully',
      event: updatedEvent
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Complete event
router.post('/events/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: event, error } = await supabase
      .from('catering_events')
      .update({ 
        status: 'completed', 
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await logActivity(req.user.id, 'COMPLETE', 'catering', `Completed event: ${id}`, req);
    res.json({ event });
  } catch (error) {
    console.error('Complete event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get catering statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { data: events } = await supabase
      .from('catering_events')
      .select('status, event_date, total_amount, paid_amount');

    const bookedEvents = events.filter(e => e.status === 'booked').length;
    const completedEvents = events.filter(e => e.status === 'completed').length;
    
    const today = new Date().toISOString().slice(0, 10);
    const todayEvents = events.filter(e => e.event_date === today).length;
    
    const totalRevenue = events
      .filter(e => e.status === 'completed')
      .reduce((sum, e) => sum + parseFloat(e.total_amount || 0), 0);
    
    const collectedAmount = events
      .filter(e => e.status !== 'cancelled')
      .reduce((sum, e) => sum + parseFloat(e.paid_amount || 0), 0);

    res.json({
      stats: {
        booked_events: bookedEvents,
        completed_events: completedEvents,
        today_events: todayEvents,
        total_revenue: totalRevenue,
        collected_amount: collectedAmount
      }
    });
  } catch (error) {
    console.error('Get catering stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
