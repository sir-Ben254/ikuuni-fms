const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Get dashboard data
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    // Today's sales
    const todaySales = await pool.query(
      `SELECT 
        COALESCE(SUM(total_amount), 0) as total_sales,
        COUNT(*) as orders_count
       FROM orders 
       WHERE created_at::date = CURRENT_DATE AND status != 'cancelled'`
    );

    // Rooms occupied
    const roomsOccupied = await pool.query(
      `SELECT COUNT(*) as count FROM rooms WHERE status = 'occupied'`
    );

    // Today's catering events
    const cateringToday = await pool.query(
      `SELECT COUNT(*) as count FROM catering_events WHERE event_date = CURRENT_DATE`
    );

    // Low stock alerts
    const lowStock = await pool.query(
      `SELECT COUNT(*) as count FROM inventory_items WHERE is_active = true AND current_stock <= minimum_stock`
    );

    // Today's expenses
    const todayExpenses = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date = CURRENT_DATE AND status != 'rejected'`
    );

    // Top selling items today
    const topItems = await pool.query(
      `SELECT mi.name, SUM(oi.quantity) as quantity, SUM(oi.total_price) as revenue
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = CURRENT_DATE AND o.status != 'cancelled'
       GROUP BY mi.id, mi.name
       ORDER BY revenue DESC
       LIMIT 5`
    );

    // Sales by category
    const salesByCategory = await pool.query(
      `SELECT mc.type, SUM(oi.total_price) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = CURRENT_DATE AND o.status != 'cancelled'
       GROUP BY mc.type`
    );

    // Calculate today's profit
    const totalSales = parseFloat(todaySales.rows[0].total_sales);
    const totalExpenses = parseFloat(todayExpenses.rows[0].total);
    const profit = totalSales - totalExpenses;

    res.json({
      todaySales: totalSales,
      ordersCount: parseInt(todaySales.rows[0].orders_count),
      roomsOccupied: parseInt(roomsOccupied.rows[0].count),
      cateringToday: parseInt(cateringToday.rows[0].count),
      lowStockAlerts: parseInt(lowStock.rows[0].count),
      todayExpenses: totalExpenses,
      profitToday: profit,
      topSellingItems: topItems.rows,
      salesByCategory: salesByCategory.rows
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get daily report
router.get('/daily', authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;
    const reportDate = date || new Date().toISOString().split('T')[0];

    // Restaurant/Bar sales
    const salesResult = await pool.query(
      `SELECT 
        COALESCE(SUM(total_amount), 0) as total,
        COUNT(*) as orders_count
       FROM orders 
       WHERE created_at::date = $1 AND status != 'cancelled'`,
      [reportDate]
    );

    // Sales by category
    const categoryResult = await pool.query(
      `SELECT mc.type, SUM(oi.total_price) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.status != 'cancelled'
       GROUP BY mc.type`,
      [reportDate]
    );

    // Room sales
    const roomResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM room_bookings 
       WHERE check_in <= $1 AND check_out >= $1 AND payment_status != 'cancelled'`,
      [reportDate]
    );

    // Catering
    const cateringResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM catering_events 
       WHERE event_date = $1 AND status != 'cancelled'`,
      [reportDate]
    );

    // Expenses
    const expensesResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expenses 
       WHERE expense_date = $1 AND status != 'rejected'`,
      [reportDate]
    );

    // Top items
    const topItems = await pool.query(
      `SELECT mi.name, SUM(oi.quantity) as quantity, SUM(oi.total_price) as revenue
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.status != 'cancelled'
       GROUP BY mi.id, mi.name
       ORDER BY revenue DESC
       LIMIT 10`,
      [reportDate]
    );

    const totalSales = parseFloat(salesResult.rows[0].total);
    const totalExpenses = parseFloat(expensesResult.rows[0].total);
    const roomSales = parseFloat(roomResult.rows[0].total);
    const cateringSales = parseFloat(cateringResult.rows[0].total);

    res.json({
      date: reportDate,
      totalSales,
      ordersCount: parseInt(salesResult.rows[0].orders_count),
      restaurantSales: categoryResult.rows.find(c => c.type === 'food')?.total || 0,
      barSales: categoryResult.rows.find(c => c.type === 'drinks')?.total || 0,
      roomSales,
      cateringSales,
      totalExpenses,
      netProfit: totalSales + roomSales + cateringSales - totalExpenses,
      topSellingItems: topItems.rows
    });
  } catch (error) {
    console.error('Get daily report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get weekly report
router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        created_at::date as date,
        COALESCE(SUM(total_amount), 0) as sales,
        COUNT(*) as orders
       FROM orders 
       WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' AND status != 'cancelled'
       GROUP BY created_at::date
       ORDER BY date`
    );

    const expenseResult = await pool.query(
      `SELECT 
        expense_date as date,
        COALESCE(SUM(amount), 0) as expenses
       FROM expenses 
       WHERE expense_date >= CURRENT_DATE - INTERVAL '7 days' AND status != 'rejected'
       GROUP BY expense_date
       ORDER BY date`
    );

    res.json({
      salesByDate: result.rows,
      expensesByDate: expenseResult.rows
    });
  } catch (error) {
    console.error('Get weekly report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get monthly report
router.get('/monthly', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();
    const targetMonth = parseInt(month) || new Date().getMonth() + 1;

    const startDate = `${targetYear}-${targetMonth.toString().padStart(2, '0')}-01`;
    const endDate = new Date(targetYear, targetMonth, 0).toISOString().split('T')[0];

    // Sales
    const salesResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as orders
       FROM orders 
       WHERE created_at::date BETWEEN $1 AND $2 AND status != 'cancelled'`,
      [startDate, endDate]
    );

    // Room revenue
    const roomResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM room_bookings 
       WHERE check_in <= $2 AND check_out >= $1 AND payment_status = 'paid'`,
      [startDate, endDate]
    );

    // Catering revenue
    const cateringResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM catering_events 
       WHERE event_date BETWEEN $1 AND $2 AND status = 'completed'`,
      [startDate, endDate]
    );

    // Expenses
    const expenseResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expenses 
       WHERE expense_date BETWEEN $1 AND $2 AND status != 'rejected'`,
      [startDate, endDate]
    );

    // Sales by category
    const categoryResult = await pool.query(
      `SELECT mc.type, SUM(oi.total_price) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date BETWEEN $1 AND $2 AND o.status != 'cancelled'
       GROUP BY mc.type`,
      [startDate, endDate]
    );

    // Top items
    const topItems = await pool.query(
      `SELECT mi.name, SUM(oi.quantity) as quantity, SUM(oi.total_price) as revenue
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date BETWEEN $1 AND $2 AND o.status != 'cancelled'
       GROUP BY mi.id, mi.name
       ORDER BY revenue DESC
       LIMIT 10`,
      [startDate, endDate]
    );

    const totalSales = parseFloat(salesResult.rows[0].total);
    const roomSales = parseFloat(roomResult.rows[0].total);
    const cateringSales = parseFloat(cateringResult.rows[0].total);
    const totalExpenses = parseFloat(expenseResult.rows[0].total);
    const grossRevenue = totalSales + roomSales + cateringSales;
    const netProfit = grossRevenue - totalExpenses;

    res.json({
      period: { year: targetYear, month: targetMonth },
      totalSales,
      ordersCount: parseInt(salesResult.rows[0].orders),
      roomSales,
      cateringSales,
      grossRevenue,
      totalExpenses,
      netProfit,
      salesByCategory: categoryResult.rows,
      topSellingItems: topItems.rows
    });
  } catch (error) {
    console.error('Get monthly report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get yearly report
router.get('/yearly', authenticateToken, async (req, res) => {
  try {
    const { year } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();

    const monthlyData = await pool.query(
      `SELECT 
        EXTRACT(MONTH FROM created_at)::int as month,
        COALESCE(SUM(total_amount), 0) as sales
       FROM orders 
       WHERE EXTRACT(YEAR FROM created_at) = $1 AND status != 'cancelled'
       GROUP BY EXTRACT(MONTH FROM created_at)
       ORDER BY month`,
      [targetYear]
    );

    const monthlyExpenses = await pool.query(
      `SELECT 
        EXTRACT(MONTH FROM expense_date)::int as month,
        COALESCE(SUM(amount), 0) as expenses
       FROM expenses 
       WHERE EXTRACT(YEAR FROM expense_date) = $1 AND status != 'rejected'
       GROUP BY EXTRACT(MONTH FROM expense_date)
       ORDER BY month`,
      [targetYear]
    );

    res.json({
      year: targetYear,
      monthlySales: monthlyData.rows,
      monthlyExpenses: monthlyExpenses.rows
    });
  } catch (error) {
    console.error('Get yearly report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export to Excel
router.get('/export/excel', authenticateToken, async (req, res) => {
  try {
    const { type, from_date, to_date } = req.query;
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'New Ikuuni FMS';
    workbook.created = new Date();

    let data = [];

    if (type === 'daily') {
      const result = await pool.query(
        `SELECT o.order_number, o.created_at, o.total_amount, o.status, o.payment_method,
                u.full_name as created_by
         FROM orders o
         LEFT JOIN users u ON o.created_by = u.id
         WHERE o.created_at::date BETWEEN $1 AND $2 AND o.status != 'cancelled'
         ORDER BY o.created_at DESC`,
        [from_date, to_date]
      );

      const sheet = workbook.addWorksheet('Sales Report');
      sheet.columns = [
        { header: 'Order #', key: 'order_number', width: 15 },
        { header: 'Date', key: 'created_at', width: 20 },
        { header: 'Amount', key: 'total_amount', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Payment Method', key: 'payment_method', width: 15 },
        { header: 'Created By', key: 'created_by', width: 20 }
      ];

      for (const row of result.rows) {
        sheet.addRow({
          order_number: row.order_number,
          created_at: new Date(row.created_at).toLocaleString(),
          total_amount: row.total_amount,
          status: row.status,
          payment_method: row.payment_method || 'N/A',
          created_by: row.created_by
        });
      }
    } else if (type === 'expenses') {
      const result = await pool.query(
        `SELECT e.expense_date, e.description, e.amount, e.payment_method, 
                ec.name as category, u.full_name as created_by
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN users u ON e.created_by = u.id
         WHERE e.expense_date BETWEEN $1 AND $2 AND e.status != 'rejected'
         ORDER BY e.expense_date DESC`,
        [from_date, to_date]
      );

      const sheet = workbook.addWorksheet('Expenses Report');
      sheet.columns = [
        { header: 'Date', key: 'expense_date', width: 15 },
        { header: 'Description', key: 'description', width: 30 },
        { header: 'Category', key: 'category', width: 15 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Payment Method', key: 'payment_method', width: 15 },
        { header: 'Created By', key: 'created_by', width: 20 }
      ];

      for (const row of result.rows) {
        sheet.addRow({
          expense_date: row.expense_date,
          description: row.description,
          category: row.category,
          amount: row.amount,
          payment_method: row.payment_method,
          created_by: row.created_by
        });
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=report_${type}_${from_date}_${to_date}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export to PDF
router.get('/export/pdf', authenticateToken, async (req, res) => {
  try {
    const { type, from_date, to_date } = req.query;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report_${type}_${from_date}_${to_date}.pdf`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('NEW IKUUNI', { align: 'center' });
    doc.fontSize(14).text('Financial Management System', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text(`${type.toUpperCase()} Report`, { align: 'center' });
    doc.fontSize(12).text(`Period: ${from_date} to ${to_date}`, { align: 'center' });
    doc.moveDown(2);

    if (type === 'daily') {
      const result = await pool.query(
        `SELECT o.order_number, o.created_at, o.total_amount, o.status
         FROM orders o
         WHERE o.created_at::date BETWEEN $1 AND $2 AND o.status != 'cancelled'
         ORDER BY o.created_at DESC
         LIMIT 50`,
        [from_date, to_date]
      );

      const total = result.rows.reduce((sum, row) => sum + parseFloat(row.total_amount), 0);

      doc.fontSize(12).text('Orders:', { underline: true });
      doc.moveDown(0.5);

      let y = doc.y;
      doc.fontSize(10);
      doc.text('Order #', 50, y);
      doc.text('Date', 150, y);
      doc.text('Amount', 280, y);
      doc.text('Status', 360, y);
      doc.moveDown();

      for (const row of result.rows) {
        y = doc.y;
        doc.text(row.order_number, 50, y);
        doc.text(new Date(row.created_at).toLocaleDateString(), 150, y);
        doc.text(`KES ${parseFloat(row.total_amount).toFixed(2)}`, 280, y);
        doc.text(row.status, 360, y);
        doc.moveDown(0.5);
      }

      doc.moveDown();
      doc.fontSize(12).text(`Total: KES ${total.toFixed(2)}`, { align: 'right' });
    }

    doc.end();
  } catch (error) {
    console.error('Export PDF error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate daily report (automated)
router.post('/generate-daily', authenticateToken, async (req, res) => {
  try {
    const { date } = req.body;
    const reportDate = date || new Date().toISOString().split('T')[0];

    // Get all data for the day
    const salesResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE created_at::date = $1 AND status != 'cancelled'`,
      [reportDate]
    );

    const restaurantResult = await pool.query(
      `SELECT COALESCE(SUM(oi.total_price), 0) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.status != 'cancelled' AND mc.type = 'food'`,
      [reportDate]
    );

    const barResult = await pool.query(
      `SELECT COALESCE(SUM(oi.total_price), 0) as total
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN menu_categories mc ON mi.category_id = mc.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.status != 'cancelled' AND mc.type = 'drinks'`,
      [reportDate]
    );

    const roomResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM room_bookings WHERE check_in <= $1 AND check_out >= $1 AND payment_status = 'paid'`,
      [reportDate]
    );

    const cateringResult = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total FROM catering_events WHERE event_date = $1 AND status = 'completed'`,
      [reportDate]
    );

    const expenseResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date = $1 AND status != 'rejected'`,
      [reportDate]
    );

    const ordersCount = await pool.query(
      `SELECT COUNT(*) as count FROM orders WHERE created_at::date = $1 AND status != 'cancelled'`,
      [reportDate]
    );

    const roomsOccupied = await pool.query(
      `SELECT COUNT(*) as count FROM rooms WHERE status = 'occupied'`,
      [reportDate]
    );

    const totalSales = parseFloat(salesResult.rows[0].total) + parseFloat(roomResult.rows[0].total) + parseFloat(cateringResult.rows[0].total);
    const totalExpenses = parseFloat(expenseResult.rows[0].total);
    const netProfit = totalSales - totalExpenses;

    // Upsert daily report
    await pool.query(
      `INSERT INTO daily_reports (report_date, total_sales, restaurant_sales, bar_sales, room_sales, catering_sales, total_expenses, net_profit, orders_count, rooms_occupied)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (report_date) DO UPDATE SET
         total_sales = $2, restaurant_sales = $3, bar_sales = $4, room_sales = $5,
         catering_sales = $6, total_expenses = $7, net_profit = $8, orders_count = $9, rooms_occupied = $10,
         updated_at = CURRENT_TIMESTAMP`,
      [reportDate, totalSales, restaurantResult.rows[0].total, barResult.rows[0].total, roomResult.rows[0].total,
       cateringResult.rows[0].total, totalExpenses, netProfit, ordersCount.rows[0].count, roomsOccupied.rows[0].count]
    );

    await logActivity(req.user.id, 'GENERATE', 'reports', `Generated daily report for ${reportDate}`, req);

    res.json({ message: 'Daily report generated', date: reportDate });
  } catch (error) {
    console.error('Generate daily report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
