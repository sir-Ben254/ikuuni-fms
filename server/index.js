require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');

// Import configurations
const { pool, initDatabase } = require('./config/database');

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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Automated Daily Report Generation (Midnight)
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily report generation...');
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const salesResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE created_at::date = $1 AND status != 'cancelled'`,
      [dateStr]
    );

    const restaurantResult = await pool.query(
      `SELECT COALESCE(SUM(oi.total_price), 0) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.status != 'cancelled' AND mc.type = 'food'`,
      [dateStr]
    );

    const barResult = await pool.query(
      `SELECT COALESCE(SUM(oi.total_price), 0) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.status != 'cancelled' AND mc.type = 'drinks'`,
      [dateStr]
    );

    const roomResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM room_bookings WHERE check_in <= $1 AND check_out >= $1 AND payment_status = 'paid'`,
      [dateStr]
    );

    const cateringResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM catering_events WHERE event_date = $1 AND status = 'completed'`,
      [dateStr]
    );

    const expenseResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date = $1 AND status != 'rejected'`,
      [dateStr]
    );

    const ordersCount = await pool.query(
      `SELECT COUNT(*) as count FROM orders WHERE created_at::date = $1 AND status != 'cancelled'`,
      [dateStr]
    );

    const roomsOccupied = await pool.query(
      `SELECT COUNT(*) as count FROM rooms WHERE status = 'occupied'`
    );

    const totalSales = parseFloat(salesResult.rows[0].total) + parseFloat(roomResult.rows[0].total) + parseFloat(cateringResult.rows[0].total);
    const totalExpenses = parseFloat(expenseResult.rows[0].total);
    const netProfit = totalSales - totalExpenses;

    await pool.query(
      `INSERT INTO daily_reports (report_date, total_sales, restaurant_sales, bar_sales, room_sales, catering_sales, total_expenses, net_profit, orders_count, rooms_occupied)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (report_date) DO UPDATE SET
         total_sales = $2, restaurant_sales = $3, bar_sales = $4, room_sales = $5,
         catering_sales = $6, total_expenses = $7, net_profit = $8, orders_count = $9, rooms_occupied = $10,
         updated_at = CURRENT_TIMESTAMP`,
      [dateStr, totalSales, restaurantResult.rows[0].total, barResult.rows[0].total, roomResult.rows[0].total,
       cateringResult.rows[0].total, totalExpenses, netProfit, ordersCount.rows[0].count, roomsOccupied.rows[0].count]
    );

    console.log(`Daily report generated for ${dateStr}`);
  } catch (error) {
    console.error('Error generating daily report:', error);
  }
});

// Low stock alert check (Every hour)
cron.schedule('0 * * * *', async () => {
  console.log('Checking low stock alerts...');
  try {
    const lowStockItems = await pool.query(
      `SELECT name, current_stock, minimum_stock FROM inventory_items 
       WHERE is_active = true AND current_stock <= minimum_stock`
    );

    if (lowStockItems.rows.length > 0) {
      console.log(`Low stock alert: ${lowStockItems.rows.length} items need restocking`);
      // In production, send notification to manager
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
    console.log('Database initialized');

    // Create default admin user if not exists
    const adminExists = await pool.query(
      `SELECT id FROM users WHERE username = 'admin'`
    );

    if (adminExists.rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash('admin123', 10);
      
      await pool.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, phone)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['admin', 'admin@newikuuni.com', passwordHash, 'System Administrator', 'admin', '+254700000000']
      );
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
