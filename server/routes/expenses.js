const express = require('express');
const router = express.Router();
const { supabase, db } = require('../config/database');
const { authenticateToken, authorize, logActivity } = require('../middleware/auth');

// Get expense categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('expense_categories')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    res.json({ categories });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expense category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, type, description } = req.body;
    
    const { data: category, error } = await supabase
      .from('expense_categories')
      .insert({ name, type, description })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ category });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get expenses
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category_id, type, from_date, to_date, status, limit = 100, offset = 0 } = req.query;
    
    let query = supabase
      .from('expenses')
      .select('*, expense_categories(name, type), users!expenses_created_by_fkey(full_name), users!expenses_approved_by_fkey(full_name)')
      .order('expense_date', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (category_id) query = query.eq('category_id', category_id);
    if (status) query = query.eq('status', status);
    if (from_date) query = query.gte('expense_date', from_date);
    if (to_date) query = query.lte('expense_date', to_date);

    const { data: expenses, error } = await query;

    if (error) throw error;

    // Filter by type manually for more control
    let filteredExpenses = expenses;
    if (type) {
      filteredExpenses = expenses.filter(e => e.expense_categories?.type === type);
    }

    res.json({ expenses: filteredExpenses });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create expense
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { category_id, description, amount, payment_method, reference_number, receipt_number, expense_date, notes } = req.body;

    const { data: expense, error } = await supabase
      .from('expenses')
      .insert({
        category_id,
        description,
        amount,
        payment_method,
        reference_number,
        receipt_number,
        expense_date: expense_date || new Date().toISOString().split('T')[0],
        created_by: req.user.id,
        notes,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    await logActivity(req.user.id, 'CREATE', 'expenses', `Created expense: ${description} - ${amount}`, req);
    res.status(201).json({ expense });
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

    const updates = {};
    if (category_id) updates.category_id = category_id;
    if (description !== undefined) updates.description = description;
    if (amount) updates.amount = amount;
    if (payment_method) updates.payment_method = payment_method;
    if (reference_number !== undefined) updates.reference_number = reference_number;
    if (receipt_number !== undefined) updates.receipt_number = receipt_number;
    if (expense_date) updates.expense_date = expense_date;
    if (notes !== undefined) updates.notes = notes;
    updates.updated_at = new Date().toISOString();

    const { data: expense, error } = await supabase
      .from('expenses')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await logActivity(req.user.id, 'UPDATE', 'expenses', `Updated expense: ${id}`, req);
    res.json({ expense });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve expense
router.post('/:id/approve', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: expense, error } = await supabase
      .from('expenses')
      .update({ 
        status: 'approved', 
        approved_by: req.user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await logActivity(req.user.id, 'APPROVE', 'expenses', `Approved expense: ${id}`, req);
    res.json({ expense });
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

    const { data: expense, error } = await supabase
      .from('expenses')
      .update({ 
        status: 'rejected', 
        notes: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await logActivity(req.user.id, 'REJECT', 'expenses', `Rejected expense: ${id}`, req);
    res.json({ expense });
  } catch (error) {
    console.error('Reject expense error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get expense summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    let query = supabase
      .from('expenses')
      .select('amount, expense_date, expense_categories(name, type)')
      .neq('status', 'rejected');

    if (from_date) query = query.gte('expense_date', from_date);
    if (to_date) query = query.lte('expense_date', to_date);

    const { data: expenses, error } = await query;

    if (error) throw error;

    const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    // Group by category
    const byCategory = {};
    for (const expense of expenses) {
      const catName = expense.expense_categories?.name || 'Unknown';
      const catType = expense.expense_categories?.type || 'other';
      if (!byCategory[catName]) {
        byCategory[catName] = { name: catName, type: catType, total: 0 };
      }
      byCategory[catName].total += parseFloat(expense.amount || 0);
    }

    res.json({
      total,
      byCategory: Object.values(byCategory)
    });
  } catch (error) {
    console.error('Get expense summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get today's expenses
router.get('/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    
    const { data: expenses, error } = await supabase
      .from('expenses')
      .select('amount')
      .eq('expense_date', today)
      .neq('status', 'rejected');

    if (error) throw error;

    const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

    res.json({ 
      summary: { 
        total, 
        count: expenses.length 
      } 
    });
  } catch (error) {
    console.error('Get today expenses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
