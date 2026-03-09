const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get inventory categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('inventory_categories')
      .select('*')
      .order('name');

    if (error) throw error;
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create inventory category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    
    const { data: category, error } = await supabase
      .from('inventory_categories')
      .insert({ name, type, description })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get suppliers
router.get('/suppliers', authenticateToken, async (req, res) => {
  try {
    const { data: suppliers, error } = await supabase
      .from('suppliers')
      .select('*, inventory_categories(name)')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json({ suppliers });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create supplier
router.post('/suppliers', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, category_id } = req.body;
    
    const { data: supplier, error } = await supabase
      .from('suppliers')
      .insert({ name, contact_person, email, phone, address, category_id })
      .select()
      .single();

    if (error) throw error;
    await logActivity(req.user.id, 'CREATE', 'inventory', `Created supplier: ${name}`, req);
    res.status(201).json({ supplier });
  } catch (error) {
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get inventory items
router.get('/items', authenticateToken, async (req, res) => {
  try {
    const { category_id, type, low_stock } = req.query;
    
    let query = supabase
      .from('inventory_items')
      .select('*, inventory_categories(name, type), suppliers(name)')
      .eq('is_active', true);

    if (category_id) query = query.eq('category_id', category_id);
    if (low_stock === 'true') query = query.lte('current_stock', 'minimum_stock');

    const { data: items, error } = await query.order('name');

    if (error) throw error;
    
    // Filter by type manually since nested filter is complex
    let filteredItems = items;
    if (type) {
      filteredItems = items.filter(item => item.inventory_categories?.type === type);
    }
    if (low_stock === 'true') {
      filteredItems = filteredItems.filter(item => parseFloat(item.current_stock) <= parseFloat(item.minimum_stock));
    }

    res.json({ items: filteredItems });
  } catch (error) {
    console.error('Get inventory items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create inventory item
router.post('/items', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, category_id, unit, current_stock, minimum_stock, cost_per_unit, supplier_id, expiry_date, location } = req.body;
    
    const { data: item, error } = await supabase
      .from('inventory_items')
      .insert({
        name,
        category_id,
        unit,
        current_stock: current_stock || 0,
        minimum_stock: minimum_stock || 10,
        cost_per_unit,
        supplier_id,
        expiry_date,
        location,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;
    await logActivity(req.user.id, 'CREATE', 'inventory', `Created inventory item: ${name}`, req);
    res.status(201).json({ item });
  } catch (error) {
    console.error('Create inventory item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update inventory item
router.put('/items/:id', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, unit, current_stock, minimum_stock, cost_per_unit, supplier_id, expiry_date, location, is_active } = req.body;
    
    const updates = {};
    if (name) updates.name = name;
    if (category_id) updates.category_id = category_id;
    if (unit) updates.unit = unit;
    if (current_stock !== undefined) updates.current_stock = current_stock;
    if (minimum_stock !== undefined) updates.minimum_stock = minimum_stock;
    if (cost_per_unit !== undefined) updates.cost_per_unit = cost_per_unit;
    if (supplier_id) updates.supplier_id = supplier_id;
    if (expiry_date) updates.expiry_date = expiry_date;
    if (location) updates.location = location;
    if (is_active !== undefined) updates.is_active = is_active;
    updates.updated_at = new Date().toISOString();

    const { data: item, error } = await supabase
      .from('inventory_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'inventory', `Updated inventory item: ${id}`, req);
    res.json({ item });
  } catch (error) {
    console.error('Update inventory item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get low stock alerts
router.get('/alerts', authenticateToken, async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('inventory_items')
      .select('*, inventory_categories(name)')
      .eq('is_active', true)
      .lte('current_stock', 'minimum_stock')
      .order('current_stock', { ascending: true });

    if (error) throw error;
    res.json({ alerts: items });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get inventory transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { item_id, type, from_date, to_date, limit = 100 } = req.query;
    
    let query = supabase
      .from('inventory_transactions')
      .select('*, inventory_items(name), users!inventory_transactions_created_by_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (item_id) query = query.eq('item_id', item_id);
    if (type) query = query.eq('transaction_type', type);
    if (from_date) query = query.gte('created_at', from_date);
    if (to_date) query = query.lte('created_at', to_date);

    const { data: transactions, error } = await query;

    if (error) throw error;
    res.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create purchase order
router.post('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const { supplier_id, items, notes, expected_date } = req.body;

    // Generate order number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const { count } = await supabase
      .from('purchase_orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date().toISOString().slice(0, 10));
    
    const orderNumber = `PO${dateStr}${((count || 0) + 1).toString().padStart(4, '0')}`;

    let totalAmount = 0;
    for (const item of items) {
      totalAmount += item.quantity * item.unit_cost;
    }

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        order_number: orderNumber,
        supplier_id,
        total_amount: totalAmount,
        notes,
        expected_date,
        created_by: req.user.id
      })
      .select()
      .single();

    if (poError) throw poError;

    // Create PO items
    const poItems = items.map(item => ({
      purchase_order_id: po.id,
      item_id: item.item_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      total_cost: item.quantity * item.unit_cost
    }));

    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(poItems);

    if (itemsError) throw itemsError;

    await logActivity(req.user.id, 'CREATE', 'inventory', `Created purchase order: ${orderNumber}`, req);
    res.status(201).json({ purchaseOrder: po });
  } catch (error) {
    console.error('Create purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get purchase orders
router.get('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = supabase
      .from('purchase_orders')
      .select('*, suppliers(name)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data: purchaseOrders, error } = await query;

    if (error) throw error;
    res.json({ purchaseOrders });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Receive purchase order
router.post('/purchase-orders/:id/receive', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { received_items } = req.body;

    // Get PO items
    const { data: poItems, error: poItemsError } = await supabase
      .from('purchase_order_items')
      .select('*, inventory_items(name)')
      .eq('purchase_order_id', id);

    if (poItemsError) throw poItemsError;

    for (const item of poItems) {
      // Update inventory
      const { data: currentItem } = await supabase
        .from('inventory_items')
        .select('current_stock')
        .eq('id', item.item_id)
        .single();

      const newStock = parseFloat(currentItem?.current_stock || 0) + parseFloat(item.quantity);

      await supabase
        .from('inventory_items')
        .update({ 
          current_stock: newStock, 
          updated_at: new Date().toISOString() 
        })
        .eq('id', item.item_id);

      // Log transaction
      await supabase
        .from('inventory_transactions')
        .insert({
          item_id: item.item_id,
          transaction_type: 'purchase',
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          total_cost: item.total_cost,
          reference_id: id,
          reference_type: 'purchase_order',
          created_by: req.user.id
        });
    }

    // Update purchase order status
    await supabase
      .from('purchase_orders')
      .update({ 
        status: 'received', 
        received_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString() 
      })
      .eq('id', id);

    await logActivity(req.user.id, 'RECEIVE', 'inventory', `Received purchase order: ${id}`, req);
    res.json({ message: 'Purchase order received successfully' });
  } catch (error) {
    console.error('Receive purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Adjust inventory
router.post('/adjust', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { item_id, quantity, transaction_type, notes } = req.body;

    const { data: item, error: itemError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', item_id)
      .single();

    if (itemError || !item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    let newStock;
    if (transaction_type === 'adjustment') {
      newStock = parseFloat(quantity);
    } else if (transaction_type === 'waste') {
      newStock = parseFloat(item.current_stock) - parseFloat(quantity);
    } else {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    await supabase
      .from('inventory_items')
      .update({ 
        current_stock: newStock, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', item_id);

    // Log transaction
    const qty = transaction_type === 'waste' ? -Math.abs(parseFloat(quantity)) : parseFloat(quantity);
    await supabase
      .from('inventory_transactions')
      .insert({
        item_id,
        transaction_type,
        quantity: qty,
        unit_cost: item.cost_per_unit,
        total_cost: qty * parseFloat(item.cost_per_unit || 0),
        notes,
        created_by: req.user.id
      });

    await logActivity(req.user.id, 'ADJUST', 'inventory', `${transaction_type} for item: ${item.name}`, req);
    res.json({ message: 'Inventory adjusted successfully', newStock });
  } catch (error) {
    console.error('Adjust inventory error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get inventory statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { data: items } = await supabase
      .from('inventory_items')
      .select('current_stock, cost_per_unit, minimum_stock')
      .eq('is_active', true);

    const totalItems = items.length;
    const lowStockItems = items.filter(i => parseFloat(i.current_stock) <= parseFloat(i.minimum_stock)).length;
    const totalValue = items.reduce((sum, i) => sum + (parseFloat(i.current_stock) || 0) * (parseFloat(i.cost_per_unit) || 0), 0);

    res.json({
      stats: {
        total_items: totalItems,
        low_stock_items: lowStockItems,
        total_value: totalValue
      }
    });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
