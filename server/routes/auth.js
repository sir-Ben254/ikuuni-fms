const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { 
  hashPassword, 
  comparePassword, 
  generateToken, 
  authenticateToken,
  logActivity 
} = require('../middleware/auth');

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash, full_name, role, is_active 
       FROM users WHERE username = $1 OR email = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    // Log activity
    await logActivity(user.id, 'LOGIN', 'auth', 'User logged in', req);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register (Admin only)
router.post('/register', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can register new users' });
    }

    const { username, email, password, full_name, role, phone } = req.body;

    if (!username || !email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'All required fields must be provided' });
    }

    const validRoles = ['admin', 'manager', 'cashier', 'accountant', 'kitchen', 'waiter', 'waitress'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if user exists
    const existingUser = await pool.query(
      `SELECT id FROM users WHERE username = $1 OR email = $2`,
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, full_name, role, phone, created_at`,
      [username, email, passwordHash, full_name, role, phone]
    );

    await logActivity(req.user.id, 'CREATE_USER', 'auth', `Created user: ${username}`, req);

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Current User
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, full_name, role, phone, is_active, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Users (Admin/Manager)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, full_name, role, phone, is_active, created_at
       FROM users ORDER BY created_at DESC`
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update User
router.put('/users/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, full_name, phone, role, is_active } = req.body;

    // Only admin can update other users, or users can update themselves
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (email) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (full_name) {
      updates.push(`full_name = $${paramCount++}`);
      values.push(full_name);
    }
    if (phone) {
      updates.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (role && req.user.role === 'admin') {
      updates.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (is_active !== undefined && req.user.role === 'admin') {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
       RETURNING id, username, email, full_name, role, phone, is_active`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logActivity(req.user.id, 'UPDATE_USER', 'auth', `Updated user: ${id}`, req);

    res.json({ user: result.rows[0], message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change Password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    const result = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );

    const isValid = await comparePassword(current_password, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await hashPassword(new_password);

    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newHash, req.user.id]
    );

    await logActivity(req.user.id, 'CHANGE_PASSWORD', 'auth', 'Password changed', req);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (just for logging purposes)
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await logActivity(req.user.id, 'LOGOUT', 'auth', 'User logged out', req);
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Activity Logs (Admin)
router.get('/activity-logs', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT al.*, u.username, u.full_name 
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ logs: result.rows });
  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
