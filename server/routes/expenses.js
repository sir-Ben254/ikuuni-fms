const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get expense categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM expense_categories WHERE is_active = true ORDER BY name`
    );
    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expense category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    const result = await pool.query(
      `INSERT INTO expense_categories (name, type, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, type, description]
    );
    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get expenses
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category_id, type, from_date, to_date, status, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT e.*, ec.name as category_name, ec.type as category_type,
             u.full_name as created_by_name, au.full_name as approved_by_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users au ON e.approved_by = au.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (category_id) {
      query += ` AND e.category_id = $${paramCount++}`;
      values.push(category_id);
    }
    if (type) {
      query += ` AND ec.type = $${paramCount++}`;
      values.push(type);
    }
    if (from_date) {
      query += ` AND e.expense_date >= $${paramCount++}`;
      values.push(from_date);
    }
    if (to_date) {
      query += ` AND e.expense_date <= $${paramCount++}`;
      values.push(to_date);
    }
    if (status) {
      query += ` AND e.status = $${paramCount++}`;
      values.push(status);
    }

    query += ` ORDER BY e.expense_date DESC, e.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    values.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, values);
    res.json({ expenses: result.rows });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expense
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { category_id, description, amount, payment_method, reference_number, receipt_number, expense_date, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO expenses (category_id, description, amount, payment_method, reference_number, receipt_number, expense_date, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [category_id, description, amount, payment_method, reference_number, receipt_number, expense_date || new Date().toISOString().split('T')[0], req.user.id, notes]
    );

    await logActivity(req.user.id, 'CREATE', 'expenses', `Created expense: ${description} - ${amount}`, req);
    res.status(201).json({ expense: result.rows[0] });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update expense
router.put('/:id', authenticateToken, authorize('admin', 'manager', 'accountant'), async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, description, amount, payment_method, reference_number, receipt_number, expense_date, notes } = req.body;

    const result = await pool.query(
      `UPDATE expenses 
       SET category_id = COALESCE($1, category_id), description = COALESCE($2, description),
           amount = COALESCE($3, amount), payment_method = COALESCE($4, payment_method),
           reference_number = COALESCE($5, reference_number), receipt_number = COALESCE($6, receipt_number),
           expense_date = COALESCE($7, expense_date), notes = COALESCE($8, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [category_id, description, amount, payment_method, reference_number, receipt_number, expense_date, notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'expenses', `Updated expense: ${id}`, req);
    res.json({ expense: result.rows[0] });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve expense
router.post('/:id/approve', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE expenses SET status = 'approved', approved_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await logActivity(req.user.id, 'APPROVE', 'expenses', `Approved expense: ${id}`, req);
    res.json({ expense: result.rows[0] });
  } catch (error) {
    console.error('Approve expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject expense
router.post('/:id/reject', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await pool.query(
      `UPDATE expenses SET status = 'rejected', notes = COALESCE($1, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [reason, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await logActivity(req.user.id, 'REJECT', 'expenses', `Rejected expense: ${id}`, req);
    res.json({ expense: result.rows[0] });
  } catch (error) {
    console.error('Reject expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get expense summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    let dateFilter = '';
    const values = [];

    if (from_date && to_date) {
      dateFilter = `WHERE expense_date BETWEEN $1 AND $2`;
      values.push(from_date, to_date);
    } else {
      dateFilter = `WHERE expense_date = CURRENT_DATE`;
    }

    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses ${dateFilter} AND status != 'rejected'`,
      values
    );

    const byCategory = await pool.query(
      `SELECT ec.name, ec.type, COALESCE(SUM(e.amount), 0) as total
       FROM expenses e
       JOIN expense_categories ec ON e.category_id = ec.id
       ${dateFilter} AND e.status != 'rejected'
       GROUP BY ec.id, ec.name, ec.type
       ORDER BY total DESC`,
      values
    );

    res.json({
      total: totalResult.rows[0].total,
      byCategory: byCategory.rows
    });
  } catch (error) {
    console.error('Get expense summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get today's expenses
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM expenses 
       WHERE expense_date = CURRENT_DATE AND status != 'rejected'`
    );

    res.json({ summary: result.rows[0] });
  } catch (error) {
    console.error('Get today expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
