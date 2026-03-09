const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/database');

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Role-based Access Control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied. Insufficient permissions.',
        required: roles,
        current: req.user.role
      });
    }
    next();
  };
};

// Hash Password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

// Compare Password
const comparePassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};

// Generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username, 
      role: user.role,
      full_name: user.full_name 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
};

// Log Activity
const logActivity = async (userId, action, module, description, req) => {
  try {
    await supabase
      .from('activity_logs')
      .insert({
        user_id: userId,
        action,
        module,
        description,
        ip_address: req?.ip || req?.connection?.remoteAddress || 'unknown',
        user_agent: req?.get('User-Agent') || 'unknown'
      });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
};

// Check Module Permissions
const checkPermission = (module, action) => {
  const permissions = {
    admin: ['*'],
    manager: ['read', 'write', 'approve'],
    accountant: ['read', 'write', 'reports'],
    cashier: ['read', 'write', 'pos'],
    kitchen: ['read', 'kitchen'],
    waiter: ['read', 'orders'],
    waitress: ['read', 'orders']
  };

  return (req, res, next) => {
    const userPermissions = permissions[req.user.role] || [];
    
    if (userPermissions.includes('*')) {
      return next();
    }

    if (!userPermissions.includes(action) && !userPermissions.includes('read')) {
      return res.status(403).json({ error: 'Permission denied for this action' });
    }

    next();
  };
};

// Request Validation
const validateRequest = (schema) => {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      if (rules.required && !value) {
        errors.push(`${field} is required`);
        continue;
      }
      
      if (value && rules.type) {
        if (rules.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${field} must be a valid email`);
        }
        if (rules.type === 'phone' && !/^\+?[\d\s-]{10,}$/.test(value)) {
          errors.push(`${field} must be a valid phone number`);
        }
        if (rules.type === 'number' && isNaN(value)) {
          errors.push(`${field} must be a number`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authorize,
  hashPassword,
  comparePassword,
  generateToken,
  logActivity,
  checkPermission,
  validateRequest
};
