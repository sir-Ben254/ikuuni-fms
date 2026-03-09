const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get all menu categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM menu_categories ORDER BY name`
    );
    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create menu category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    
    const result = await pool.query(
      `INSERT INTO menu_categories (name, type, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, type, description]
    );

    await logActivity(req.user.id, 'CREATE', 'menu', `Created category: ${name}`, req);
    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all menu items
router.get('/menu-items', authenticateToken, async (req, res) => {
  try {
    const { category_id, type, available } = req.query;
    
    let query = `
      SELECT mi.*, mc.name as category_name, mc.type as category_type
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (category_id) {
      query += ` AND mi.category_id = $${paramCount++}`;
      values.push(category_id);
    }
    if (type) {
      query += ` AND mc.type = $${paramCount++}`;
      values.push(type);
    }
    if (available !== undefined) {
      query += ` AND mi.is_available = $${paramCount++}`;
      values.push(available === 'true');
    }

    query += ` ORDER BY mi.name`;

    const result = await pool.query(query, values);
    res.json({ menuItems: result.rows });
  } catch (error) {
    console.error('Get menu items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create menu item
router.post('/menu-items', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, category_id, description, price, preparation_time, image_url, ingredients } = req.body;
    
    const result = await pool.query(
      `INSERT INTO menu_items (name, category_id, description, price, preparation_time, image_url, ingredients)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, category_id, description, price, preparation_time, image_url, JSON.stringify(ingredients || [])]
    );

    await logActivity(req.user.id, 'CREATE', 'menu', `Created menu item: ${name}`, req);
    res.status(201).json({ menuItem: result.rows[0] });
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
    
    const result = await pool.query(
      `UPDATE menu_items 
       SET name = COALESCE($1, name), category_id = COALESCE($2, category_id), 
           description = COALESCE($3, description), price = COALESCE($4, price),
           preparation_time = COALESCE($5, preparation_time), is_available = COALESCE($6, is_available),
           image_url = COALESCE($7, image_url), ingredients = COALESCE($8, ingredients),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [name, category_id, description, price, preparation_time, is_available, image_url, ingredients ? JSON.stringify(ingredients) : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'menu', `Updated menu item: ${id}`, req);
    res.json({ menuItem: result.rows[0] });
  } catch (error) {
    console.error('Update menu item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all tables
router.get('/tables', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM tables ORDER BY table_number`
    );
    res.json({ tables: result.rows });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create table
router.post('/tables', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { table_number, capacity } = req.body;
    
    const result = await pool.query(
      `INSERT INTO tables (table_number, capacity)
       VALUES ($1, $2) RETURNING *`,
      [table_number, capacity || 4]
    );

    res.status(201).json({ table: result.rows[0] });
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
  
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM orders WHERE created_at::date = CURRENT_DATE`
  );
  
  const count = parseInt(result.rows[0].count) + 1;
  return `${prefix}${dateStr}${count.toString().padStart(4, '0')}`;
};

// Create order
router.post('/orders', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { order_type, table_id, room_booking_id, items, notes, discount = 0 } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Order items are required' });
    }

    const orderNumber = await generateOrderNumber();

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const menuResult = await client.query(
        `SELECT * FROM menu_items WHERE id = $1`,
        [item.menu_item_id]
      );

      if (menuResult.rows.length === 0) {
        throw new Error(`Menu item not found: ${item.menu_item_id}`);
      }

      const menuItem = menuResult.rows[0];
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
    const orderResult = await client.query(
      `INSERT INTO orders (order_number, order_type, table_id, room_booking_id, subtotal, tax_amount, discount_amount, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [orderNumber, order_type, table_id, room_booking_id, subtotal, taxAmount, discountAmount, totalAmount, notes, req.user.id]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, total_price, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.menu_item_id, item.quantity, item.unit_price, item.total_price, item.notes]
      );
    }

    // Update table status if dine-in
    if (table_id) {
      await client.query(
        `UPDATE tables SET status = 'occupied' WHERE id = $1`,
        [table_id]
      );
    }

    await client.query('COMMIT');

    await logActivity(req.user.id, 'CREATE', 'orders', `Created order: ${orderNumber}`, req);

    // Get full order with items
    const fullOrder = await pool.query(
      `SELECT o.*, t.table_number, u.full_name as created_by_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN users u ON o.created_by = u.id
       WHERE o.id = $1`,
      [order.id]
    );

    const orderItemsResult = await pool.query(
      `SELECT oi.*, mi.name, mi.category_id, mc.type as category_type
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
         JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    res.status(201).json({
      order: fullOrder.rows[0],
      items: orderItemsResult.rows
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get orders
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const { status, order_type, date, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT o.*, t.table_number, u.full_name as created_by_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (status) {
      query += ` AND o.status = $${paramCount++}`;
      values.push(status);
    }
    if (order_type) {
      query += ` AND o.order_type = $${paramCount++}`;
      values.push(order_type);
    }
    if (date) {
      query += ` AND o.created_at::date = $${paramCount++}`;
      values.push(date);
    } else {
      query += ` AND o.created_at::date = CURRENT_DATE`;
    }

    query += ` ORDER BY o.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    values.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, values);

    // Get items for each order
    for (let order of result.rows) {
      const itemsResult = await pool.query(
        `SELECT oi.*, mi.name, mi.category_id
         FROM order_items oi
         JOIN menu_items mi ON oi.menu_item_id = mi.id
         WHERE oi.order_id = $1`,
        [order.id]
      );
      order.items = itemsResult.rows;
    }

    res.json({ orders: result.rows });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single order
router.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const orderResult = await pool.query(
      `SELECT o.*, t.table_number, u.full_name as created_by_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN users u ON o.created_by = u.id
       WHERE o.id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const itemsResult = await pool.query(
      `SELECT oi.*, mi.name, mi.category_id, mc.type as category_type
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       WHERE oi.order_id = $1`,
      [id]
    );

    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status
router.patch('/orders/:id/status', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get current order
    const orderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Update order status
    await client.query(
      `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, id]
    );

    // If completed, update table status and deduct inventory
    if (status === 'completed') {
      // Update table to available
      if (order.table_id) {
        await client.query(
          `UPDATE tables SET status = 'available' WHERE id = $1`,
          [order.table_id]
        );
      }

      // Deduct inventory
      const itemsResult = await client.query(
        `SELECT oi.*, mi.ingredients
         FROM order_items oi
         JOIN menu_items mi ON oi.menu_item_id = mi.id
         WHERE oi.order_id = $1`,
        [id]
      );

      for (const item of itemsResult.rows) {
        if (item.ingredients && Array.isArray(item.ingredients)) {
          for (const ingredient of item.ingredients) {
            const inventoryResult = await client.query(
              `SELECT * FROM inventory_items WHERE name ILIKE $1`,
              [ingredient.name]
            );

            if (inventoryResult.rows.length > 0) {
              const newStock = inventoryResult.rows[0].current_stock - (ingredient.quantity * item.quantity);
              await client.query(
                `UPDATE inventory_items SET current_stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [newStock, inventoryResult.rows[0].id]
              );

              // Log transaction
              await client.query(
                `INSERT INTO inventory_transactions (item_id, transaction_type, quantity, total_cost, reference_id, reference_type, created_by)
                 VALUES ($1, 'sale', $2, $3, $4, 'order', $5)`,
                [inventoryResult.rows[0].id, -(ingredient.quantity * item.quantity), 
                 (ingredient.quantity * item.quantity) * inventoryResult.rows[0].cost_per_unit,
                 id, req.user.id]
              );
            }
          }
        }
      }
    }

    // If cancelled, update table status
    if (status === 'cancelled' && order.table_id) {
      await client.query(
        `UPDATE tables SET status = 'available' WHERE id = $1`,
        [order.table_id]
      );
    }

    await client.query('COMMIT');

    await logActivity(req.user.id, 'UPDATE', 'orders', `Updated order ${id} status to ${status}`, req);

    res.json({ message: 'Order status updated', status });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update order status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Process payment
router.post('/orders/:id/payment', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { payment_method, amount, reference_number, mpesa_receipt, mpesa_phone, notes } = req.body;

    // Get order
    const orderResult = await client.query(
      `SELECT * FROM orders WHERE id = $1`,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Create payment record
    const paymentResult = await client.query(
      `INSERT INTO payments (order_id, amount, payment_method, reference_number, mpesa_receipt, mpesa_phone, processed_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, amount || order.total_amount, payment_method, reference_number, mpesa_receipt, mpesa_phone, req.user.id, notes]
    );

    // Update order status to completed if fully paid
    if (amount >= order.total_amount) {
      await client.query(
        `UPDATE orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id]
      );

      // Update table status
      if (order.table_id) {
        await client.query(
          `UPDATE tables SET status = 'available' WHERE id = $1`,
          [order.table_id]
        );
      }
    }

    await client.query('COMMIT');

    await logActivity(req.user.id, 'PAYMENT', 'orders', `Payment for order ${order.order_number}`, req);

    res.status(201).json({
      message: 'Payment processed successfully',
      payment: paymentResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Process payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get today's sales summary
router.get('/sales/today', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_orders,
        COALESCE(SUM(total_amount), 0) as total_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'mpesa' THEN total_amount ELSE 0 END), 0) as mpesa_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total_amount ELSE 0 END), 0) as card_sales
       FROM orders 
       WHERE created_at::date = CURRENT_DATE AND status != 'cancelled'`
    );

    const categoryResult = await pool.query(
      `SELECT mc.type, SUM(oi.total_price) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = CURRENT_DATE AND o.status != 'cancelled'
       GROUP BY mc.type`
    );

    res.json({
      summary: result.rows[0],
      byCategory: categoryResult.rows
    });
  } catch (error) {
    console.error('Get today sales error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
