const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get dashboard data
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Today's sales
    const { data: todayOrders } = await supabase
      .from('orders')
      .select('total_amount, status')
      .gte('created_at', today)
      .neq('status', 'cancelled');

    const totalSales = todayOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    const ordersCount = todayOrders.length;

    // Rooms occupied
    const { count: roomsOccupied } = await supabase
      .from('rooms')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'occupied');

    // Today's catering events
    const { count: cateringToday } = await supabase
      .from('catering_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_date', today);

    // Low stock alerts
    const { count: lowStock } = await supabase
      .from('inventory_items')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .lte('current_stock', 'minimum_stock');

    // Today's expenses
    const { data: todayExpenses } = await supabase
      .from('expenses')
      .select('amount')
      .eq('expense_date', today)
      .neq('status', 'rejected');

    const totalExpenses = todayExpenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    // Top selling items today
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('quantity, total_price, menu_items(name)')
      .gte('created_at', today);

    const itemSales = {};
    for (const item of orderItems) {
      const name = item.menu_items?.name || 'Unknown';
      if (!itemSales[name]) {
        itemSales[name] = { name, quantity: 0, revenue: 0 };
      }
      itemSales[name].quantity += item.quantity;
      itemSales[name].revenue += parseFloat(item.total_price || 0);
    }
    const topItems = Object.values(itemSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    // Calculate profit
    const profit = totalSales - totalExpenses;

    res.json({
      todaySales: totalSales,
      ordersCount: ordersCount || 0,
      roomsOccupied: roomsOccupied || 0,
      cateringToday: cateringToday || 0,
      lowStockAlerts: lowStock || 0,
      todayExpenses: totalExpenses,
      profitToday: profit,
      topSellingItems: topItems,
      salesByCategory: []
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
    const reportDate = date || new Date().toISOString().slice(0, 10);

    // Restaurant/Bar sales
    const { data: orders } = await supabase
      .from('orders')
      .select('total_amount')
      .gte('created_at', reportDate)
      .neq('status', 'cancelled');

    const totalSales = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    const ordersCount = orders.length;

    // Room sales
    const { data: roomBookings } = await supabase
      .from('room_bookings')
      .select('total_amount')
      .lte('check_in', reportDate)
      .gte('check_out', reportDate)
      .eq('payment_status', 'paid');

    const roomSales = roomBookings.reduce((sum, b) => sum + parseFloat(b.total_amount || 0), 0);

    // Catering
    const { data: cateringEvents } = await supabase
      .from('catering_events')
      .select('total_amount')
      .eq('event_date', reportDate)
      .eq('status', 'completed');

    const cateringSales = cateringEvents.reduce((sum, e) => sum + parseFloat(e.total_amount || 0), 0);

    // Expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount')
      .eq('expense_date', reportDate)
      .neq('status', 'rejected');

    const totalExpenses = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    res.json({
      date: reportDate,
      totalSales,
      ordersCount,
      restaurantSales: totalSales,
      barSales: 0,
      roomSales,
      cateringSales,
      totalExpenses,
      netProfit: totalSales + roomSales + cateringSales - totalExpenses,
      topSellingItems: []
    });
  } catch (error) {
    console.error('Get daily report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get weekly report
router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    const { data: orders } = await supabase
      .from('orders')
      .select('total_amount, created_at')
      .gte('created_at', sevenDaysAgoStr)
      .neq('status', 'cancelled');

    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, expense_date')
      .gte('expense_date', sevenDaysAgoStr)
      .neq('status', 'rejected');

    // Group by date
    const salesByDate = {};
    const expensesByDate = {};

    for (const order of orders) {
      const date = order.created_at.split('T')[0];
      salesByDate[date] = (salesByDate[date] || 0) + parseFloat(order.total_amount || 0);
    }

    for (const expense of expenses) {
      const date = expense.expense_date;
      expensesByDate[date] = (expensesByDate[date] || 0) + parseFloat(expense.amount || 0);
    }

    res.json({
      salesByDate: Object.entries(salesByDate).map(([date, sales]) => ({ date, sales, orders: 0 })),
      expensesByDate: Object.entries(expensesByDate).map(([date, expenses]) => ({ date, expenses }))
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
    const endDate = new Date(targetYear, targetMonth, 0).toISOString().slice(0, 10);

    // Sales
    const { data: orders } = await supabase
      .from('orders')
      .select('total_amount')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59')
      .neq('status', 'cancelled');

    const totalSales = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    const ordersCount = orders.length;

    // Room revenue
    const { data: roomBookings } = await supabase
      .from('room_bookings')
      .select('total_amount')
      .lte('check_in', endDate)
      .gte('check_out', startDate)
      .eq('payment_status', 'paid');

    const roomSales = roomBookings.reduce((sum, b) => sum + parseFloat(b.total_amount || 0), 0);

    // Catering revenue
    const { data: cateringEvents } = await supabase
      .from('catering_events')
      .select('total_amount')
      .gte('event_date', startDate)
      .lte('event_date', endDate)
      .eq('status', 'completed');

    const cateringSales = cateringEvents.reduce((sum, e) => sum + parseFloat(e.total_amount || 0), 0);

    // Expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount')
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)
      .neq('status', 'rejected');

    const totalExpenses = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    const grossRevenue = totalSales + roomSales + cateringSales;
    const netProfit = grossRevenue - totalExpenses;

    res.json({
      period: { year: targetYear, month: targetMonth },
      totalSales,
      ordersCount,
      roomSales,
      cateringSales,
      grossRevenue,
      totalExpenses,
      netProfit,
      salesByCategory: [],
      topSellingItems: []
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

    const startDate = `${targetYear}-01-01`;
    const endDate = `${targetYear}-12-31`;

    const { data: orders } = await supabase
      .from('orders')
      .select('total_amount, created_at')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59')
      .neq('status', 'cancelled');

    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount, expense_date')
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)
      .neq('status', 'rejected');

    // Group by month
    const monthlySales = {};
    const monthlyExpenses = {};

    for (const order of orders) {
      const month = new Date(order.created_at).getMonth() + 1;
      monthlySales[month] = (monthlySales[month] || 0) + parseFloat(order.total_amount || 0);
    }

    for (const expense of expenses) {
      const month = new Date(expense.expense_date).getMonth() + 1;
      monthlyExpenses[month] = (monthlyExpenses[month] || 0) + parseFloat(expense.amount || 0);
    }

    res.json({
      year: targetYear,
      monthlySales: Object.entries(monthlySales).map(([month, sales]) => ({ month: parseInt(month), sales })),
      monthlyExpenses: Object.entries(monthlyExpenses).map(([month, expenses]) => ({ month: parseInt(month), expenses }))
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
    
    // For simplicity, we'll return JSON data that can be downloaded
    // In production, you'd use ExcelJS here
    
    let data = [];

    if (type === 'daily') {
      const { data: orders } = await supabase
        .from('orders')
        .select('order_number, created_at, total_amount, status')
        .gte('created_at', from_date)
        .lte('created_at', to_date + 'T23:59:59')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      data = orders.map(o => ({
        order_number: o.order_number,
        created_at: new Date(o.created_at).toLocaleString(),
        total_amount: o.total_amount,
        status: o.status
      }));
    } else if (type === 'expenses') {
      const { data: expenses } = await supabase
        .from('expenses')
        .select('expense_date, description, amount, payment_method, expense_categories(name)')
        .gte('expense_date', from_date)
        .lte('expense_date', to_date)
        .neq('status', 'rejected')
        .order('expense_date', { ascending: false });

      data = expenses.map(e => ({
        expense_date: e.expense_date,
        description: e.description,
        category: e.expense_categories?.name || 'Unknown',
        amount: e.amount,
        payment_method: e.payment_method
      }));
    }

    res.json({
      message: 'Excel export data ready',
      data,
      filename: `report_${type}_${from_date}_${to_date}.xlsx`
    });
  } catch (error) {
    console.error('Export Excel error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export to PDF
router.get('/export/pdf', authenticateToken, async (req, res) => {
  try {
    const { type, from_date, to_date } = req.query;

    // Return data for PDF generation
    let data = [];
    let total = 0;

    if (type === 'daily') {
      const { data: orders } = await supabase
        .from('orders')
        .select('order_number, created_at, total_amount, status')
        .gte('created_at', from_date)
        .lte('created_at', to_date + 'T23:59:59')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(50);

      data = orders;
      total = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
    }

    res.json({
      message: 'PDF export data ready',
      reportType: type,
      period: { from_date, to_date },
      data,
      total,
      filename: `report_${type}_${from_date}_${to_date}.pdf`
    });
  } catch (error) {
    console.error('Export PDF error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
