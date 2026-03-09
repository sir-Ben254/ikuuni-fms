const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get staff salaries
router.get('/salaries', authenticateToken, async (req, res) => {
  try {
    const { month, year, status } = req.query;
    
    let query = `
      SELECT ss.*, u.full_name as employee_name, u.role
      FROM staff_salaries ss
      JOIN users u ON ss.user_id = u.id
      WHERE 1=1
    `;
    const values = [];
    let paramCount = 1;

    if (month) {
      query += ` AND ss.month = $${paramCount++}`;
      values.push(parseInt(month));
    }
    if (year) {
      query += ` AND ss.year = $${paramCount++}`;
      values.push(parseInt(year));
    }
    if (status) {
      query += ` AND ss.payment_status = $${paramCount++}`;
      values.push(status);
    }

    query += ` ORDER BY ss.year DESC, ss.month DESC`;

    const result = await pool.query(query, values);
    res.json({ salaries: result.rows });
  } catch (error) {
    console.error('Get salaries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create salary record (Manager creates, Admin approves)
router.post('/salaries', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { user_id, month, year, basic_salary, deductions, bonuses, notes } = req.body;

    const netSalary = parseFloat(basic_salary) + parseFloat(bonuses || 0) - parseFloat(deductions || 0);

    const result = await pool.query(
      `INSERT INTO staff_salaries (user_id, month, year, basic_salary, deductions, bonuses, net_salary, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [user_id, month, year, basic_salary, deductions || 0, bonuses || 0, netSalary, req.user.id, notes]
    );

    await logActivity(req.user.id, 'CREATE', 'salary', `Created salary for user: ${user_id}, ${month}/${year}`, req);
    res.status(201).json({ salary: result.rows[0] });
  } catch (error) {
    console.error('Create salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve salary (Admin only)
router.post('/salaries/:id/approve', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE staff_salaries SET payment_status = 'approved', approved_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    await logActivity(req.user.id, 'APPROVE', 'salary', `Approved salary: ${id}`, req);
    res.json({ salary: result.rows[0] });
  } catch (error) {
    console.error('Approve salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pay salary (Manager initiates, Admin approved)
router.post('/salaries/:id/pay', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const { payment_method, mpesa_phone, notes } = req.body;

    // Get salary record
    const salaryResult = await client.query(
      `SELECT ss.*, u.full_name, u.role
       FROM staff_salaries ss
       JOIN users u ON ss.user_id = u.id
       WHERE ss.id = $1`,
      [id]
    );

    if (salaryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    const salary = salaryResult.rows[0];

    // Check if approved
    if (salary.payment_status !== 'approved' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Salary must be approved before payment' });
    }

    // Update salary payment
    await client.query(
      `UPDATE staff_salaries 
       SET payment_status = 'paid', payment_method = $1, payment_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [payment_method, id]
    );

    // Create expense record for the salary payment
    const categoryResult = await client.query(
      `SELECT id FROM expense_categories WHERE type = 'salaries' LIMIT 1`
    );

    if (categoryResult.rows.length > 0) {
      await client.query(
        `INSERT INTO expenses (category_id, description, amount, payment_method, expense_date, created_by, notes, status)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, 'approved')`,
        [categoryResult.rows[0].id, `Salary payment for ${salary.full_name} - ${salary.month}/${salary.year}`, 
         salary.net_salary, payment_method, req.user.id, notes]
      );
    }

    await client.query('COMMIT');

    await logActivity(req.user.id, 'PAY', 'salary', `Paid salary to ${salary.full_name}: ${salary.net_salary}`, req);

    res.json({ 
      message: 'Salary paid successfully',
      salary: { ...salary, payment_status: 'paid', payment_method, payment_date: new Date().toISOString().split('T')[0] }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Pay salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Reject salary
router.post('/salaries/:id/reject', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await pool.query(
      `UPDATE staff_salaries SET payment_status = 'rejected', notes = COALESCE($1, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [reason, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    await logActivity(req.user.id, 'REJECT', 'salary', `Rejected salary: ${id}`, req);
    res.json({ salary: result.rows[0] });
  } catch (error) {
    console.error('Reject salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending salaries for approval
router.get('/salaries/pending', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ss.*, u.full_name as employee_name, u.role
       FROM staff_salaries ss
       JOIN users u ON ss.user_id = u.id
       WHERE ss.payment_status = 'pending'
       ORDER BY ss.created_at DESC`
    );

    res.json({ salaries: result.rows });
  } catch (error) {
    console.error('Get pending salaries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get salary statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE payment_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE payment_status = 'approved') as approved,
        COUNT(*) FILTER (WHERE payment_status = 'paid') as paid,
        COALESCE(SUM(net_salary) FILTER (WHERE payment_status = 'paid'), 0) as total_paid,
        COALESCE(SUM(net_salary) FILTER (WHERE payment_status = 'pending'), 0) as total_pending
       FROM staff_salaries
       WHERE month = EXTRACT(MONTH FROM CURRENT_DATE) AND year = EXTRACT(YEAR FROM CURRENT_DATE)`
    );

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    console.error('Get salary stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get staff (non-admin users)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, role, phone, is_active
       FROM users 
       WHERE role != 'admin' AND is_active = true
       ORDER BY role, full_name`
    );

    res.json({ staff: result.rows });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
