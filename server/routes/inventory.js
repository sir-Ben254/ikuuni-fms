const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get inventory categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM inventory_categories ORDER BY name`
    );
    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create inventory category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    const result = await pool.query(
      `INSERT INTO inventory_categories (name, type, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, type, description]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get suppliers
router.get('/suppliers', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, ic.name as category_name
       FROM suppliers s
       LEFT JOIN inventory_categories s.category_id = ic.id
       WHERE s.is_active = true
       ORDER BY s.name`
    );
    res.json({ suppliers: result.rows });
  } catch (error) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create supplier
router.post('/suppliers', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, contact_person, email, phone, address, category_id } = req.body;
    const result = await pool.query(
      `INSERT INTO suppliers (name, contact_person, email, phone, address, category_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, contact_person, email, phone, address, category_id]
    );
    await logActivity(req.user.id, 'CREATE', 'inventory', `Created supplier: ${name}`, req);
    res.status(201).json({ supplier: result.rows[0] });
  } catch (error) {
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get inventory items
router.get('/items', authenticateToken, async (req, res) => {
  try {
    const { category_id, type, low_stock } = req.query;
    
    let query = `
      SELECT ii.*, ic.name as category_name, ic.type as category_type, s.name as supplier_name
      FROM inventory_items ii
      LEFT JOIN inventory_categories ic ON ii.category_id = ic.id
      LEFT JOIN suppliers s ON ii.supplier_id = s.id
      WHERE ii.is_active = true
    `;
    const values = [];
    let paramCount = 1;

    if (category_id) {
      query += ` AND ii.category_id = $${paramCount++}`;
      values.push(category_id);
    }
    if (type) {
      query += ` AND ic.type = $${paramCount++}`;
      values.push(type);
    }
    if (low_stock === 'true') {
      query += ` AND ii.current_stock <= ii.minimum_stock`;
    }

    query += ` ORDER BY ii.name`;

    const result = await pool.query(query, values);
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Get inventory items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create inventory item
router.post('/items', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, category_id, unit, current_stock, minimum_stock, cost_per_unit, supplier_id, expiry_date, location } = req.body;
    const result = await pool.query(
      `INSERT INTO inventory_items (name, category_id, unit, current_stock, minimum_stock, cost_per_unit, supplier_id, expiry_date, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, category_id, unit, current_stock || 0, minimum_stock || 10, cost_per_unit, supplier_id, expiry_date, location]
    );
    await logActivity(req.user.id, 'CREATE', 'inventory', `Created inventory item: ${name}`, req);
    res.status(201).json({ item: result.rows[0] });
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
    
    const result = await pool.query(
      `UPDATE inventory_items 
       SET name = COALESCE($1, name), category_id = COALESCE($2, category_id),
           unit = COALESCE($3, unit), current_stock = COALESCE($4, current_stock),
           minimum_stock = COALESCE($5, minimum_stock), cost_per_unit = COALESCE($6, cost_per_unit),
           supplier_id = COALESCE($7, supplier_id), expiry_date = COALESCE($8, expiry_date),
           location = COALESCE($9, location), is_active = COALESCE($10, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 RETURNING *`,
      [name, category_id, unit, current_stock, minimum_stock, cost_per_unit, supplier_id, expiry_date, location, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'inventory', `Updated inventory item: ${id}`, req);
    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Update inventory item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get low stock alerts
router.get('/alerts', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ii.*, ic.name as category_name
       FROM inventory_items ii
       LEFT JOIN inventory_categories ic ON ii.category_id = ic.id
       WHERE ii.is_active = true AND ii.current_stock <= ii.minimum_stock
       ORDER BY (ii.current_stock::float / ii.minimum_stock) ASC`
    );
    res.json({ alerts: result.rows });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get inventory transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { item_id, type, from_date, to_date, limit = 100 } = req.query;
    
    let query = `
      SELECT it.*, ii.name as item_name, u.full_name as created_by_name
      FROM inventory_transactions it
      LEFT JOIN inventory_items ii ON it.item_id = ii.id
      LEFT JOIN users u ON it.created_by = u.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (item_id) {
      query += ` AND it.item_id = $${paramCount++}`;
      values.push(item_id);
    }
    if (type) {
      query += ` AND it.transaction_type = $${paramCount++}`;
      values.push(type);
    }
    if (from_date) {
      query += ` AND it.created_at >= $${paramCount++}`;
      values.push(from_date);
    }
    if (to_date) {
      query += ` AND it.created_at <= $${paramCount++}`;
      values.push(to_date);
    }

    query += ` ORDER BY it.created_at DESC LIMIT $${paramCount++}`;
    values.push(parseInt(limit));

    const result = await pool.query(query, values);
    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create purchase order
router.post('/purchase-orders', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { supplier_id, items, notes, expected_date } = req.body;

    // Generate order number
    const countResult = await client.query(
      `SELECT COUNT(*) FROM purchase_orders WHERE created_at::date = CURRENT_DATE`
    );
    const orderNumber = `PO${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${(parseInt(countResult.rows[0].count) + 1).toString().padStart(4, '0')}`;

    let totalAmount = 0;
    for (const item of items) {
      totalAmount += item.quantity * item.unit_cost;
    }

    const poResult = await client.query(
      `INSERT INTO purchase_orders (order_number, supplier_id, total_amount, notes, expected_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [orderNumber, supplier_id, totalAmount, notes, expected_date, req.user.id]
    );

    const po = poResult.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, item_id, quantity, unit_cost, total_cost)
         VALUES ($1, $2, $3, $4, $5)`,
        [po.id, item.item_id, item.quantity, item.unit_cost, item.quantity * item.unit_cost]
      );
    }

    await client.query('COMMIT');

    await logActivity(req.user.id, 'CREATE', 'inventory', `Created purchase order: ${orderNumber}`, req);
    res.status(201).json({ purchaseOrder: po });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get purchase orders
router.get('/purchase-orders', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = `
      SELECT po.*, s.name as supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
    `;
    const values = [];
    let paramCount = 1;

    if (status) {
      query += ` WHERE po.status = $${paramCount++}`;
      values.push(status);
    }

    query += ` ORDER BY po.created_at DESC`;

    const result = await pool.query(query, values);
    res.json({ purchaseOrders: result.rows });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Receive purchase order
router.post('/purchase-orders/:id/receive', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Get purchase order items
    const poItemsResult = await client.query(
      `SELECT poi.*, ii.name as item_name
       FROM purchase_order_items poi
       JOIN inventory_items ii ON poi.item_id = ii.id
       WHERE poi.purchase_order_id = $1`,
      [id]
    );

    for (const item of poItemsResult.rows) {
      // Update inventory
      const newStock = parseFloat(item.received_quantity) + parseFloat(item.quantity);
      await client.query(
        `UPDATE inventory_items SET current_stock = current_stock + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [item.quantity, item.item_id]
      );

      // Log transaction
      await client.query(
        `INSERT INTO inventory_transactions (item_id, transaction_type, quantity, unit_cost, total_cost, reference_id, reference_type, created_by)
         VALUES ($1, 'purchase', $2, $3, $4, $5, 'purchase_order', $6)`,
        [item.item_id, item.quantity, item.unit_cost, item.total_cost, id, req.user.id]
      );
    }

    // Update purchase order status
    await client.query(
      `UPDATE purchase_orders SET status = 'received', received_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    await logActivity(req.user.id, 'RECEIVE', 'inventory', `Received purchase order: ${id}`, req);
    res.json({ message: 'Purchase order received successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Receive purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Adjust inventory (for waste/adjustment)
router.post('/adjust', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { item_id, quantity, transaction_type, notes } = req.body;

    const itemResult = await client.query(
      `SELECT * FROM inventory_items WHERE id = $1`,
      [item_id]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemResult.rows[0];
    let newStock;

    if (transaction_type === 'adjustment') {
      newStock = parseFloat(quantity);
    } else if (transaction_type === 'waste') {
      newStock = parseFloat(item.current_stock) - parseFloat(quantity);
    } else {
      return res.status(400).json({ error: 'Invalid transaction type' });
    }

    await client.query(
      `UPDATE inventory_items SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newStock, item_id]
    );

    // Log transaction
    await client.query(
      `INSERT INTO inventory_transactions (item_id, transaction_type, quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [item_id, transaction_type, transaction_type === 'waste' ? -quantity : quantity, item.cost_per_unit, 
       (transaction_type === 'waste' ? -quantity : quantity) * item.cost_per_unit, notes, req.user.id]
    );

    await client.query('COMMIT');

    await logActivity(req.user.id, 'ADJUST', 'inventory', `${transaction_type} for item: ${item.name}`, req);
    res.json({ message: 'Inventory adjusted successfully', newStock });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Adjust inventory error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get inventory statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total_items,
        COUNT(*) FILTER (WHERE current_stock <= minimum_stock) as low_stock_items,
        COALESCE(SUM(current_stock * cost_per_unit), 0) as total_value
       FROM inventory_items WHERE is_active = true`
    );

    const categoryStats = await pool.query(
      `SELECT ic.name, COALESCE(SUM(ii.current_stock * ii.cost_per_unit), 0) as value
       FROM inventory_categories ic
       LEFT JOIN inventory_items ii ON ic.id = ii.category_id AND ii.is_active = true
       GROUP BY ic.id, ic.name
       ORDER BY value DESC`
    );

    res.json({
      stats: stats.rows[0],
      byCategory: categoryStats.rows
    });
  } catch (error) {
    console.error('Get inventory stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
