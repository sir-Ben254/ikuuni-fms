const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get staff salaries
router.get('/salaries', authenticateToken, async (req, res) => {
  try {
    const { month, year, status } = req.query;
    
    let query = supabase
      .from('staff_salaries')
      .select('*, users!staff_salaries_user_id_fkey(full_name, role)')
      .order('created_at', { ascending: false });

    if (month) query = query.eq('month', parseInt(month));
    if (year) query = query.eq('year', parseInt(year));
    if (status) query = query.eq('payment_status', status);

    const { data: salaries, error } = await query;

    if (error) throw error;
    res.json({ salaries });
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

    const { data: salary, error } = await supabase
      .from('staff_salaries')
      .insert({
        user_id,
        month: parseInt(month),
        year: parseInt(year),
        basic_salary,
        deductions: deductions || 0,
        bonuses: bonuses || 0,
        net_salary: netSalary,
        created_by: req.user.id,
        notes,
        payment_status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'salary', `Created salary for user: ${user_id}, ${month}/${year}`, req);
    res.status(201).json({ salary });
  } catch (error) {
    console.error('Create salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve salary (Admin only)
router.post('/salaries/:id/approve', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: salary, error } = await supabase
      .from('staff_salaries')
      .update({ 
        payment_status: 'approved', 
        approved_by: req.user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!salary) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    await logActivity(req.user.id, 'APPROVE', 'salary', `Approved salary: ${id}`, req);
    res.json({ salary });
  } catch (error) {
    console.error('Approve salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pay salary (Manager initiates, Admin approved)
router.post('/salaries/:id/pay', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_method, mpesa_phone, notes } = req.body;

    // Get salary record with user info
    const { data: salary, error: salaryError } = await supabase
      .from('staff_salaries')
      .select('*, users!staff_salaries_user_id_fkey(full_name, role)')
      .eq('id', id)
      .single();

    if (salaryError || !salary) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    // Check if approved (Admin can pay without approval, Manager needs approval)
    if (salary.payment_status !== 'approved' && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Salary must be approved before payment' });
    }

    // Update salary payment
    await supabase
      .from('staff_salaries')
      .update({ 
        payment_status: 'paid', 
        payment_method,
        payment_date: new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    // Create expense record for the salary payment
    const { data: category } = await supabase
      .from('expense_categories')
      .select('id')
      .eq('type', 'salaries')
      .limit(1)
      .single();

    if (category) {
      await supabase
        .from('expenses')
        .insert({
          category_id: category.id,
          description: `Salary payment for ${salary.users?.full_name} - ${salary.month}/${salary.year}`,
          amount: salary.net_salary,
          payment_method,
          expense_date: new Date().toISOString().split('T')[0],
          created_by: req.user.id,
          notes,
          status: 'approved'
        });
    }

    await logActivity(req.user.id, 'PAY', 'salary', `Paid salary to ${salary.users?.full_name}: ${salary.net_salary}`, req);

    res.json({ 
      message: 'Salary paid successfully',
      salary: { 
        ...salary, 
        payment_status: 'paid', 
        payment_method, 
        payment_date: new Date().toISOString().split('T')[0] 
      }
    });
  } catch (error) {
    console.error('Pay salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject salary
router.post('/salaries/:id/reject', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: salary, error } = await supabase
      .from('staff_salaries')
      .update({ 
        payment_status: 'rejected', 
        notes: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!salary) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    await logActivity(req.user.id, 'REJECT', 'salary', `Rejected salary: ${id}`, req);
    res.json({ salary });
  } catch (error) {
    console.error('Reject salary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending salaries for approval
router.get('/salaries/pending', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { data: salaries, error } = await supabase
      .from('staff_salaries')
      .select('*, users!staff_salaries_user_id_fkey(full_name, role)')
      .eq('payment_status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ salaries });
  } catch (error) {
    console.error('Get pending salaries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get salary statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    const { data: salaries, error } = await supabase
      .from('staff_salaries')
      .select('payment_status, net_salary')
      .eq('month', currentMonth)
      .eq('year', currentYear);

    if (error) throw error;

    const pending = salaries.filter(s => s.payment_status === 'pending').length;
    const approved = salaries.filter(s => s.payment_status === 'approved').length;
    const paid = salaries.filter(s => s.payment_status === 'paid').length;
    const totalPaid = salaries
      .filter(s => s.payment_status === 'paid')
      .reduce((sum, s) => sum + parseFloat(s.net_salary || 0), 0);
    const totalPending = salaries
      .filter(s => s.payment_status === 'pending')
      .reduce((sum, s) => sum + parseFloat(s.net_salary || 0), 0);

    res.json({
      stats: {
        pending,
        approved,
        paid,
        total_paid: totalPaid,
        total_pending: totalPending
      }
    });
  } catch (error) {
    console.error('Get salary stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get staff (non-admin users)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const { data: staff, error } = await supabase
      .from('users')
      .select('id, username, full_name, role, phone, is_active')
      .neq('role', 'admin')
      .eq('is_active', true)
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    if (error) throw error;
    res.json({ staff });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
