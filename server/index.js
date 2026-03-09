require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const path = require('path');

const { db, supabase, initDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const authRoutes = require('./routes/auth');
const posRoutes = require('./routes/pos');
const roomRoutes = require('./routes/rooms');
const cateringRoutes = require('./routes/catering');
const inventoryRoutes = require('./routes/inventory');
const expenseRoutes = require('./routes/expenses');
const staffRoutes = require('./routes/staff');
const reportRoutes = require('./routes/reports');
const mpesaRoutes = require('./routes/mpesa');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/catering', cateringRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/mpesa', mpesaRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from docs folder
app.use(express.static(path.join(__dirname, '../docs')));

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../docs/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler - only for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Automated Daily Report Generation (Midnight)
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily report generation...');
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    // Get sales data
    const { data: sales } = await supabase
      .from('orders')
      .select('id, total_amount')
      .gte('created_at', dateStr);

    // Simplified - in production, calculate properly
    console.log(`Daily report generated for ${dateStr}, orders: ${sales?.length || 0}`);
  } catch (error) {
    console.error('Error generating daily report:', error);
  }
});

// Low stock alert check (Every hour)
cron.schedule('0 * * * *', async () => {
  console.log('Checking low stock alerts...');
  try {
    const { data: lowStockItems } = await supabase
      .from('inventory_items')
      .select('name, current_stock, minimum_stock')
      .eq('is_active', true)
      .lte('current_stock', 'minimum_stock');

    if (lowStockItems && lowStockItems.length > 0) {
      console.log(`Low stock alert: ${lowStockItems.length} items need restocking`);
    }
  } catch (error) {
    console.error('Error checking low stock:', error);
  }
});

// Start server
const startServer = async () => {
  try {
    // Initialize database
    await initDatabase();
    console.log('Supabase connection ready');

    // Check if admin user exists
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id')
      .eq('username', 'admin')
      .single();

    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      
      await db.insert('users', {
        username: 'admin',
        email: 'admin@newikuuni.com',
        password_hash: passwordHash,
        full_name: 'System Administrator',
        role: 'admin',
        phone: '+254700000000'
      });
      console.log('Default admin user created (admin/admin123)');
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
