const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get all menu categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('menu_categories')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create menu category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    
    const { data: category, error } = await supabase
      .from('menu_categories')
      .insert({ name, type, description })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'menu', `Created category: ${name}`, req);
    res.status(201).json({ category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all menu items
router.get('/menu-items', authenticateToken, async (req, res) => {
  try {
    const { category_id, type, available } = req.query;
    
    let query = supabase
      .from('menu_items')
      .select('*, menu_categories(name, type)');

    if (category_id) query = query.eq('category_id', category_id);
    if (type) query = query.eq('menu_categories.type', type);
    if (available !== undefined) query = query.eq('is_available', available === 'true');

    const { data: menuItems, error } = await query.order('name');

    if (error) throw error;
    res.json({ menuItems });
  } catch (error) {
    console.error('Get menu items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create menu item
router.post('/menu-items', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, category_id, description, price, preparation_time, image_url, ingredients } = req.body;
    
    const { data: menuItem, error } = await supabase
      .from('menu_items')
      .insert({
        name,
        category_id,
        description,
        price,
        preparation_time: preparation_time || 15,
        image_url,
        ingredients: ingredients || []
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'menu', `Created menu item: ${name}`, req);
    res.status(201).json({ menuItem });
  } catch (error) {
    console.error('Create menu item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update menu item
router.put('/menu-items/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, description, price, preparation_time, is_available, image_url, ingredients } = req.body;
    
    const updates = {};
    if (name) updates.name = name;
    if (category_id) updates.category_id = category_id;
    if (description !== undefined) updates.description = description;
    if (price) updates.price = price;
    if (preparation_time) updates.preparation_time = preparation_time;
    if (is_available !== undefined) updates.is_available = is_available;
    if (image_url !== undefined) updates.image_url = image_url;
    if (ingredients) updates.ingredients = ingredients;
    updates.updated_at = new Date().toISOString();

    const { data: menuItem, error } = await supabase
      .from('menu_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!menuItem) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'menu', `Updated menu item: ${id}`, req);
    res.json({ menuItem });
  } catch (error) {
    console.error('Update menu item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all tables
router.get('/tables', authenticateToken, async (req, res) => {
  try {
    const { data: tables, error } = await supabase
      .from('tables')
      .select('*')
      .order('table_number');

    if (error) throw error;
    res.json({ tables });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create table
router.post('/tables', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { table_number, capacity } = req.body;
    
    const { data: table, error } = await supabase
      .from('tables')
      .insert({ table_number, capacity: capacity || 4 })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ table });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate order number
const generateOrderNumber = async () => {
  const date = new Date();
  const prefix = 'ORD';
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', date.toISOString().slice(0, 10));
  
  const orderCount = (count || 0) + 1;
  return `${prefix}${dateStr}${orderCount.toString().padStart(4, '0')}`;
};

// Create order
router.post('/orders', authenticateToken, async (req, res) => {
  try {
    const { order_type, table_id, room_booking_id, items, notes, discount = 0 } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    const orderNumber = await generateOrderNumber();

    // Calculate totals and get menu item details
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const { data: menuItems, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('id', item.menu_item_id);

      if (error || !menuItems || menuItems.length === 0) {
        throw new Error(`Menu item not found: ${item.menu_item_id}`);
      }

      const menuItem = menuItems[0];
      const itemTotal = menuItem.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        unit_price: menuItem.price,
        total_price: itemTotal,
        notes: item.notes
      });
    }

    const taxRate = parseFloat(process.env.TAX_RATE || 16) / 100;
    const taxAmount = subtotal * taxRate;
    const discountAmount = subtotal * (discount / 100);
    const totalAmount = subtotal + taxAmount - discountAmount;

    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        order_type: order_type || 'dine_in',
        table_id,
        room_booking_id,
        subtotal,
        tax_amount: taxAmount,
        discount_amount: discountAmount,
        total_amount: totalAmount,
        notes,
        created_by: req.user.id
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Create order items
    const orderItemsData = orderItems.map(item => ({
      ...item,
      order_id: order.id
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItemsData);

    if (itemsError) throw itemsError;

    // Update table status if dine-in
    if (table_id) {
      await supabase
        .from('tables')
        .update({ status: 'occupied' })
        .eq('id', table_id);
    }

    await logActivity(req.user.id, 'CREATE', 'orders', `Created order: ${orderNumber}`, req);

    // Get full order with items
    const { data: fullOrder } = await supabase
      .from('orders')
      .select('*, tables(table_number), users!orders_created_by_fkey(full_name)')
      .eq('id', order.id)
      .single();

    const { data: orderItemsResult } = await supabase
      .from('order_items')
      .select('*, menu_items(name, category_id)')
      .eq('order_id', order.id);

    res.status(201).json({
      order: fullOrder,
      items: orderItemsResult
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get orders
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const { status, order_type, date, limit = 50, offset = 0 } = req.query;
    
    let query = supabase
      .from('orders')
      .select('*, tables(table_number), users!orders_created_by_fkey(full_name)')
      .gte('created_at', new Date().toISOString().slice(0, 10));

    if (status) query = query.eq('status', status);
    if (order_type) query = query.eq('order_type', order_type);
    if (date) query = query.eq('created_at', date);

    const { data: orders, error } = await query
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;

    // Get items for each order
    for (let order of orders) {
      const { data: items } = await supabase
        .from('order_items')
        .select('*, menu_items(name, category_id)')
        .eq('order_id', order.id);
      order.items = items || [];
    }

    res.json({ orders });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single order
router.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*, tables(table_number), users!orders_created_by_fkey(full_name)')
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('*, menu_items(name, category_id, menu_categories(type))')
      .eq('order_id', id);

    res.json({
      order,
      items: items || []
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status
router.patch('/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get current order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update order status
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) throw updateError;

    // If completed, update table status
    if (status === 'completed' && order.table_id) {
      await supabase
        .from('tables')
        .update({ status: 'available' })
        .eq('id', order.table_id);
    }

    // If cancelled, update table status
    if (status === 'cancelled' && order.table_id) {
      await supabase
        .from('tables')
        .update({ status: 'available' })
        .eq('id', order.table_id);
    }

    await logActivity(req.user.id, 'UPDATE', 'orders', `Updated order ${id} status to ${status}`, req);

    res.json({ message: 'Order status updated', status });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process payment
router.post('/orders/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_method, amount, reference_number, mpesa_receipt, mpesa_phone, notes } = req.body;

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const paymentAmount = amount || order.total_amount;

    // Create payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        order_id: id,
        amount: paymentAmount,
        payment_method,
        reference_number,
        mpesa_receipt,
        mpesa_phone,
        processed_by: req.user.id,
        notes,
        status: 'completed'
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    // If fully paid, update order status to completed
    if (paymentAmount >= order.total_amount) {
      await supabase
        .from('orders')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', id);

      // Update table to available
      if (order.table_id) {
        await supabase
          .from('tables')
          .update({ status: 'available' })
          .eq('id', order.table_id);
      }
    }

    await logActivity(req.user.id, 'PAYMENT', 'orders', `Payment for order ${order.order_number}`, req);

    res.status(201).json({ 
      message: 'Payment processed successfully',
      payment,
      order_status: paymentAmount >= order.total_amount ? 'completed' : order.status
    });
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
