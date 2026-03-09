const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
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

    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, email, password_hash, full_name, role, is_active')
      .or(`username.eq.${username},email.eq.${username}`);

    if (error) throw error;

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];

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
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`);

    if (existingUser && existingUser.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await hashPassword(password);

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        username,
        email,
        password_hash: passwordHash,
        full_name,
        role,
        phone
      })
      .select('id, username, email, full_name, role, phone, created_at')
      .single();

    if (insertError) throw insertError;

    await logActivity(req.user.id, 'CREATE_USER', 'auth', `Created user: ${username}`, req);

    res.status(201).json({
      message: 'User created successfully',
      user: newUser
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Current User
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, full_name, role, phone, is_active, created_at')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get All Users (Admin/Manager)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, email, full_name, role, phone, is_active, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ users });
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

    const updates = {};
    if (email) updates.email = email;
    if (full_name) updates.full_name = full_name;
    if (phone) updates.phone = phone;
    if (role && req.user.role === 'admin') updates.role = role;
    if (is_active !== undefined && req.user.role === 'admin') updates.is_active = is_active;
    updates.updated_at = new Date().toISOString();

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, username, email, full_name, role, phone, is_active')
      .single();

    if (error) throw error;

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logActivity(req.user.id, 'UPDATE_USER', 'auth', `Updated user: ${id}`, req);

    res.json({ user: updatedUser, message: 'User updated successfully' });
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

    const { data: user, error } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    const isValid = await comparePassword(current_password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await hashPassword(new_password);

    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    if (updateError) throw updateError;

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
    const limitNum = parseInt(limit) || 50;
    const offsetNum = parseInt(offset) || 0;

    const { data: logs, error } = await supabase
      .from('activity_logs')
      .select('*, users(username, full_name)')
      .order('created_at', { ascending: false })
      .range(offsetNum, offsetNum + limitNum - 1);

    if (error) throw error;

    // Transform to add username manually since nested select doesn't work well
    const { data: users } = await supabase
      .from('users')
      .select('id, username, full_name');

    const logsWithUser = logs.map(log => {
      const user = users.find(u => u.id === log.user_id);
      return {
        ...log,
        username: user?.username,
        full_name: user?.full_name
      };
    });

    res.json({ logs: logsWithUser });
  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
