// New Ikuuni Financial Management System - Frontend Application
const API_BASE = '/api';

// Global State
let currentUser = null;
let token = localStorage.getItem('token');
let currentOrder = [];
let menuItems = [];
let charts = {};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    validateToken();
  }
  setupEventListeners();
  updateCurrentDate();
});

// API Helper
async function apiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    showToast(error.message, 'error');
    throw error;
  }
}

// Token Validation
async function validateToken() {
  try {
    const data = await apiCall('/auth/me');
    currentUser = data.user;
    showApp();
    loadDashboard();
  } catch (error) {
    localStorage.removeItem('token');
    token = null;
  }
}

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const data = await apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    showApp();
    loadDashboard();
    showToast('Welcome back!', 'success');
  } catch (error) {
    document.getElementById('login-error').textContent = error.message;
  }
});

// Show App
function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.full_name;
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await apiCall('/auth/logout', { method: 'POST' });
  } catch (error) {}
  
  localStorage.removeItem('token');
  token = null;
  currentUser = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('login-form').reset();
});

// Setup Event Listeners
function setupEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
    });
  });

  // Mobile Menu
  document.querySelector('.menu-toggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('active');
  });

  // POS Tabs
  document.querySelectorAll('.pos-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterMenuItems(btn.dataset.category);
    });
  });

  // Discount Input
  document.getElementById('discount-input').addEventListener('input', updateOrderTotals);

  // Clear Order
  document.getElementById('clear-order').addEventListener('click', () => {
    currentOrder = [];
    renderOrderItems();
  });

  // Process Payment
  document.getElementById('process-payment').addEventListener('click', showPaymentModal);

  // Report buttons
  document.querySelectorAll('.report-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Modal close
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// Navigation
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  
  document.getElementById('page-title').textContent = page.charAt(0).toUpperCase() + page.slice(1);

  // Load page data
  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'pos': loadPOS(); break;
    case 'rooms': loadRooms(); break;
    case 'catering': loadCatering(); break;
    case 'inventory': loadInventory(); break;
    case 'expenses': loadExpenses(); break;
    case 'staff': loadStaff(); break;
    case 'reports': loadReports(); break;
    case 'mpesa': loadMpesa(); break;
    case 'settings': loadSettings(); break;
  }
}

// Dashboard
async function loadDashboard() {
  try {
    const data = await apiCall('/reports/dashboard');
    
    document.getElementById('today-sales').textContent = `KES ${parseFloat(data.todaySales).toLocaleString()}`;
    document.getElementById('today-orders').textContent = `${data.ordersCount} orders`;
    document.getElementById('rooms-occupied').textContent = data.roomsOccupied;
    document.getElementById('catering-today').textContent = data.cateringToday;
    document.getElementById('profit-today').textContent = `KES ${parseFloat(data.profitToday).toLocaleString()}`;
    document.getElementById('notification-count').textContent = data.lowStockAlerts;

    // Top items
    const topItemsHTML = data.topSellingItems.map(item => `
      <div class="item">
        <span class="item-name">${item.name}</span>
        <span class="item-revenue">KES ${parseFloat(item.revenue).toLocaleString()}</span>
      </div>
    `).join('');
    document.getElementById('top-items-list').innerHTML = topItemsHTML || '<div class="empty-state">No sales today</div>';

    // Low stock alerts
    const lowStockHTML = data.lowStockAlerts > 0 ? `
      <div class="alert-item">
        <span class="item-name">${data.lowStockAlerts} items need restocking</span>
        <span class="stock-info">Click to view</span>
      </div>
    ` : '<div class="empty-state">All items in stock</div>';
    document.getElementById('low-stock-list').innerHTML = lowStockHTML;

    // Sales chart
    renderSalesChart(data.salesByCategory);
  } catch (error) {
    console.error('Dashboard error:', error);
  }
}

function renderSalesChart(data) {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;

  if (charts.sales) charts.sales.destroy();

  const chartData = data || [];
  charts.sales = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: chartData.map(d => d.type === 'food' ? 'Restaurant' : 'Bar'),
      datasets: [{
        data: chartData.map(d => parseFloat(d.total) || 0),
        backgroundColor: ['#3498db', '#e74c3c']
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

// POS
async function loadPOS() {
  try {
    const data = await apiCall('/pos/menu-items?available=true');
    menuItems = data.menuItems;
    filterMenuItems('food');

    const tablesData = await apiCall('/pos/tables');
    const tableSelect = document.getElementById('table-select');
    tableSelect.innerHTML = tablesData.tables.map(t => 
      `<option value="${t.id}">Table ${t.table_number}</option>`
    ).join('');
  } catch (error) {
    console.error('POS load error:', error);
  }
}

function filterMenuItems(category) {
  const filtered = menuItems.filter(item => {
    const cat = item.category_type || (item.category_name ? 
      (item.category_name.toLowerCase().includes('food') ? 'food' : 'drinks') : 'food');
    return cat === category;
  });

  document.getElementById('menu-items-grid').innerHTML = filtered.map(item => `
    <div class="menu-item" onclick="addToOrder('${item.id}', '${item.name}', ${item.price})">
      <div class="name">${item.name}</div>
      <div class="price">KES ${parseFloat(item.price).toLocaleString()}</div>
    </div>
  `).join('');
}

function addToOrder(id, name, price) {
  const existing = currentOrder.find(item => item.menu_item_id === id);
  if (existing) {
    existing.quantity++;
  } else {
    currentOrder.push({ menu_item_id: id, name, price, quantity: 1 });
  }
  renderOrderItems();
}

function updateQuantity(index, delta) {
  currentOrder[index].quantity += delta;
  if (currentOrder[index].quantity <= 0) {
    currentOrder.splice(index, 1);
  }
  renderOrderItems();
}

function renderOrderItems() {
  document.getElementById('order-items').innerHTML = currentOrder.map((item, index) => `
    <div class="order-item">
      <div class="order-item-info">
        <div class="order-item-name">${item.name}</div>
        <div class="order-item-qty">KES ${parseFloat(item.price).toLocaleString()} each</div>
      </div>
      <div class="order-item-controls">
        <button class="qty-btn" onclick="updateQuantity(${index}, -1)">-</button>
        <span>${item.quantity}</span>
        <button class="qty-btn" onclick="updateQuantity(${index}, 1)">+</button>
      </div>
      <div class="order-item-price">KES ${(item.price * item.quantity).toLocaleString()}</div>
    </div>
  `).join('') || '<div class="empty-state">Add items to order</div>';

  updateOrderTotals();
}

function updateOrderTotals() {
  const subtotal = currentOrder.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discount = parseFloat(document.getElementById('discount-input').value) || 0;
  const discountAmount = subtotal * (discount / 100);
  const tax = (subtotal - discountAmount) * 0.16;
  const total = subtotal - discountAmount + tax;

  document.getElementById('order-subtotal').textContent = `KES ${subtotal.toLocaleString()}`;
  document.getElementById('order-tax').textContent = `KES ${tax.toLocaleString()}`;
  document.getElementById('order-total').textContent = `KES ${total.toLocaleString()}`;
}

function showPaymentModal() {
  if (currentOrder.length === 0) {
    showToast('Add items to order first', 'warning');
    return;
  }

  const subtotal = currentOrder.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discount = parseFloat(document.getElementById('discount-input').value) || 0;
  const discountAmount = subtotal * (discount / 100);
  const tax = (subtotal - discountAmount) * 0.16;
  const total = subtotal - discountAmount + tax;

  showModal('Process Payment', `
    <div class="form-group">
      <label>Total Amount</label>
      <input type="text" value="KES ${total.toLocaleString()}" readonly>
    </div>
    <div class="form-group">
      <label>Payment Method</label>
      <select id="payment-method">
        <option value="cash">Cash</option>
        <option value="mpesa">M-Pesa</option>
        <option value="card">Card</option>
      </select>
    </div>
    <div class="form-group">
      <label>Reference (Optional)</label>
      <input type="text" id="payment-ref" placeholder="Transaction number">
    </div>
  `, [
    { text: 'Cancel', class: 'btn-secondary', action: closeModal },
    { text: 'Process Payment', class: 'btn-primary', action: () => processPayment(total) }
  ]);
}

async function processPayment(total) {
  try {
    const orderType = document.getElementById('order-type').value;
    const tableId = document.getElementById('table-select').value;
    const paymentMethod = document.getElementById('payment-method').value;
    const reference = document.getElementById('payment-ref').value;
    const discount = parseFloat(document.getElementById('discount-input').value) || 0;

    const orderData = await apiCall('/pos/orders', {
      method: 'POST',
      body: JSON.stringify({
        order_type: orderType,
        table_id: orderType === 'dine_in' ? tableId : null,
        items: currentOrder.map(item => ({ menu_item_id: item.menu_item_id, quantity: item.quantity })),
        discount
      })
    });

    // Process payment
    await apiCall(`/pos/orders/${orderData.order.id}/payment`, {
      method: 'POST',
      body: JSON.stringify({
        payment_method: paymentMethod,
        amount: total,
        reference_number: reference
      })
    });

    showToast('Order completed successfully!', 'success');
    currentOrder = [];
    document.getElementById('discount-input').value = 0;
    renderOrderItems();
    closeModal();
  } catch (error) {
    console.error('Payment error:', error);
  }
}

// Rooms
async function loadRooms() {
  try {
    const [roomsData, bookingsData] = await Promise.all([
      apiCall('/rooms'),
      apiCall('/rooms/bookings')
    ]);

    // Render room cards
    document.getElementById('rooms-grid').innerHTML = roomsData.rooms.map(room => `
      <div class="room-card ${room.status}" onclick="showBookingModal('${room.id}', '${room.room_number}')">
        <div class="room-number">${room.room_number}</div>
        <div class="room-type">${room.room_type}</div>
        <div class="room-price">KES ${parseFloat(room.price_per_night).toLocaleString()}/night</div>
      </div>
    `).join('');

    // Render bookings table
    document.getElementById('bookings-tbody').innerHTML = bookingsData.bookings.map(booking => `
      <tr>
        <td>${booking.room_number}</td>
        <td>${booking.guest_name}</td>
        <td>${new Date(booking.check_in).toLocaleDateString()}</td>
        <td>${new Date(booking.check_out).toLocaleDateString()}</td>
        <td>KES ${parseFloat(booking.total_amount).toLocaleString()}</td>
        <td><span class="status-badge ${booking.payment_status}">${booking.payment_status}</span></td>
        <td>
          ${booking.payment_status === 'pending' ? `<button class="btn-success" onclick="checkIn('${booking.id}')">Check In</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Rooms load error:', error);
  }
}

async function checkIn(bookingId) {
  try {
    await apiCall(`/rooms/bookings/${bookingId}/check-in`, { method: 'POST' });
    showToast('Guest checked in successfully', 'success');
    loadRooms();
  } catch (error) {}
}

// Catering
async function loadCatering() {
  try {
    const [eventsData, statsData] = await Promise.all([
      apiCall('/catering/events'),
      apiCall('/catering/stats')
    ]);

    document.getElementById('catering-booked').textContent = statsData.stats.booked_events;
    document.getElementById('catering-completed').textContent = statsData.stats.completed_events;
    document.getElementById('catering-revenue').textContent = `KES ${parseFloat(statsData.stats.total_revenue).toLocaleString()}`;

    document.getElementById('events-tbody').innerHTML = eventsData.events.map(event => `
      <tr>
        <td>${event.event_name}</td>
        <td>${event.client_name}</td>
        <td>${new Date(event.event_date).toLocaleDateString()}</td>
        <td>${event.number_of_guests}</td>
        <td>KES ${parseFloat(event.total_amount).toLocaleString()}</td>
        <td>KES ${parseFloat(event.paid_amount).toLocaleString()}</td>
        <td><span class="status-badge ${event.status}">${event.status}</span></td>
        <td>
          <button class="btn-secondary" onclick="viewEvent('${event.id}')">View</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Catering load error:', error);
  }
}

// Inventory
async function loadInventory() {
  try {
    const [itemsData, statsData] = await Promise.all([
      apiCall('/inventory/items'),
      apiCall('/inventory/stats')
    ]);

    document.getElementById('inv-total-items').textContent = statsData.stats.total_items;
    document.getElementById('inv-low-stock').textContent = statsData.stats.low_stock_items;
    document.getElementById('inv-total-value').textContent = `KES ${parseFloat(statsData.stats.total_value).toLocaleString()}`;

    document.getElementById('inventory-tbody').innerHTML = itemsData.items.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.category_name}</td>
        <td>${item.unit}</td>
        <td style="color: ${item.current_stock <= item.minimum_stock ? 'red' : 'inherit'}">${item.current_stock}</td>
        <td>${item.minimum_stock}</td>
        <td>KES ${parseFloat(item.cost_per_unit).toLocaleString()}</td>
        <td>KES ${(item.current_stock * item.cost_per_unit).toLocaleString()}</td>
        <td>
          <button class="btn-secondary" onclick="editItem('${item.id}')">Edit</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Inventory load error:', error);
  }
}

// Expenses
async function loadExpenses() {
  try {
    const fromDate = document.getElementById('expense-from-date').value || new Date().toISOString().split('T')[0];
    const toDate = document.getElementById('expense-to-date').value || new Date().toISOString().split('T')[0];

    const [expensesData, summaryData] = await Promise.all([
      apiCall(`/expenses?from_date=${fromDate}&to_date=${toDate}`),
      apiCall(`/expenses/summary?from_date=${fromDate}&to_date=${toDate}`)
    ]);

    document.getElementById('expense-total').textContent = `KES ${parseFloat(summaryData.total).toLocaleString()}`;

    const categoryHTML = summaryData.byCategory.map(cat => `
      <div class="category-row">
        <span>${cat.name}</span>
        <span>KES ${parseFloat(cat.total).toLocaleString()}</span>
      </div>
    `).join('');
    document.getElementById('expense-by-category').innerHTML = categoryHTML || 'No expenses';

    document.getElementById('expenses-tbody').innerHTML = expensesData.expenses.map(expense => `
      <tr>
        <td>${new Date(expense.expense_date).toLocaleDateString()}</td>
        <td>${expense.description}</td>
        <td>${expense.category_name}</td>
        <td>KES ${parseFloat(expense.amount).toLocaleString()}</td>
        <td>${expense.payment_method || '-'}</td>
        <td><span class="status-badge ${expense.status}">${expense.status}</span></td>
        <td>
          ${expense.status === 'pending' ? `
            <button class="btn-success" onclick="approveExpense('${expense.id}')">Approve</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Expenses load error:', error);
  }
}

async function approveExpense(id) {
  try {
    await apiCall(`/expenses/${id}/approve`, { method: 'POST' });
    showToast('Expense approved', 'success');
    loadExpenses();
  } catch (error) {}
}

// Staff & Payroll
async function loadStaff() {
  try {
    const [staffData, salariesData, statsData] = await Promise.all([
      apiCall('/staff/users'),
      apiCall('/staff/salaries'),
      apiCall('/staff/stats')
    ]);

    document.getElementById('salary-pending').textContent = statsData.stats.pending;
    document.getElementById('salary-approved').textContent = statsData.stats.approved;
    document.getElementById('salary-paid').textContent = `KES ${parseFloat(statsData.stats.total_paid).toLocaleString()}`;

    document.getElementById('staff-list').innerHTML = staffData.staff.map(s => `
      <div class="staff-member">
        <div class="staff-avatar">${s.full_name.charAt(0)}</div>
        <div class="staff-info">
          <div class="staff-name">${s.full_name}</div>
          <div class="staff-role">${s.role}</div>
        </div>
      </div>
    `).join('');

    document.getElementById('salaries-tbody').innerHTML = salariesData.salaries.map(salary => `
      <tr>
        <td>${salary.employee_name}</td>
        <td>${salary.month}/${salary.year}</td>
        <td>KES ${parseFloat(salary.net_salary).toLocaleString()}</td>
        <td><span class="status-badge ${salary.payment_status}">${salary.payment_status}</span></td>
        <td>
          ${salary.payment_status === 'pending' ? `
            <button class="btn-success" onclick="approveSalary('${salary.id}')">Approve</button>
          ` : salary.payment_status === 'approved' ? `
            <button class="btn-primary" onclick="paySalary('${salary.id}')">Pay</button>
          ` : ''}
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Staff load error:', error);
  }
}

async function approveSalary(id) {
  try {
    await apiCall(`/staff/salaries/${id}/approve`, { method: 'POST' });
    showToast('Salary approved', 'success');
    loadStaff();
  } catch (error) {}
}

async function paySalary(id) {
  showModal('Pay Salary', `
    <div class="form-group">
      <label>Payment Method</label>
      <select id="salary-payment-method">
        <option value="cash">Cash</option>
        <option value="mpesa">M-Pesa</option>
        <option value="bank">Bank Transfer</option>
      </select>
    </div>
    <div class="form-group">
      <label>Phone (for M-Pesa)</label>
      <input type="text" id="salary-phone" placeholder="+254...">
    </div>
  `, [
    { text: 'Cancel', class: 'btn-secondary', action: closeModal },
    { text: 'Process Payment', class: 'btn-primary', action: () => processSalaryPayment(id) }
  ]);
}

async function processSalaryPayment(id) {
  try {
    const method = document.getElementById('salary-payment-method').value;
    const phone = document.getElementById('salary-phone').value;

    await apiCall(`/staff/salaries/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ payment_method: method, mpesa_phone: phone })
    });

    showToast('Salary paid successfully', 'success');
    closeModal();
    loadStaff();
  } catch (error) {}
}

// Reports
async function loadReports() {
  try {
    const date = document.getElementById('report-date').value || new Date().toISOString().split('T')[0];
    const data = await apiCall(`/reports/daily?date=${date}`);

    document.getElementById('report-sales').textContent = `KES ${parseFloat(data.totalSales).toLocaleString()}`;
    document.getElementById('report-room').textContent = `KES ${parseFloat(data.roomSales).toLocaleString()}`;
    document.getElementById('report-catering').textContent = `KES ${parseFloat(data.cateringSales).toLocaleString()}`;
    document.getElementById('report-expenses').textContent = `KES ${parseFloat(data.totalExpenses).toLocaleString()}`;
    document.getElementById('report-profit').textContent = `KES ${parseFloat(data.netProfit).toLocaleString()}`;

    document.getElementById('report-items-tbody').innerHTML = data.topSellingItems.map(item => `
      <tr>
        <td>${item.name}</td>
        <td>${item.quantity}</td>
        <td>KES ${parseFloat(item.revenue).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Reports load error:', error);
  }
}

document.getElementById('generate-report').addEventListener('click', loadReports);

document.getElementById('export-pdf').addEventListener('click', async () => {
  const date = document.getElementById('report-date').value || new Date().toISOString().split('T')[0];
  window.open(`/api/reports/export/pdf?type=daily&from_date=${date}&to_date=${date}`, '_blank');
});

document.getElementById('export-excel').addEventListener('click', async () => {
  const date = document.getElementById('report-date').value || new Date().toISOString().split('T')[0];
  window.open(`/api/reports/export/excel?type=daily&from_date=${date}&to_date=${date}`, '_blank');
});

// M-Pesa
async function loadMpesa() {
  try {
    const [transactionsData, summaryData] = await Promise.all([
      apiCall('/mpesa/transactions'),
      apiCall('/mpesa/summary')
    ]);

    document.getElementById('mpesa-count').textContent = summaryData.summary.total_transactions;
    document.getElementById('mpesa-total').textContent = `KES ${parseFloat(summaryData.summary.total_amount).toLocaleString()}`;
    document.getElementById('mpesa-matched').textContent = summaryData.summary.matched;

    document.getElementById('mpesa-tbody').innerHTML = transactionsData.transactions.map(tx => `
      <tr>
        <td>${tx.transaction_id}</td>
        <td>${new Date(tx.transaction_time).toLocaleString()}</td>
        <td>${tx.phone_number}</td>
        <td>KES ${parseFloat(tx.amount).toLocaleString()}</td>
        <td>${tx.first_name} ${tx.last_name || ''}</td>
        <td><span class="status-badge ${tx.status}">${tx.status}</span></td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('M-Pesa load error:', error);
  }
}

// Settings
async function loadSettings() {
  try {
    const data = await apiCall('/auth/users');
    document.getElementById('users-tbody').innerHTML = data.users.map(user => `
      <tr>
        <td>${user.username}</td>
        <td>${user.full_name}</td>
        <td>${user.role}</td>
        <td><span class="status-badge ${user.is_active ? 'available' : 'cancelled'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn-secondary" onclick="editUser('${user.id}')">Edit</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Settings load error:', error);
  }
}

// Modal Functions
function showModal(title, content, buttons = []) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  
  const footer = document.getElementById('modal-footer');
  footer.innerHTML = buttons.map(btn => 
    `<button class="${btn.class}" onclick="${btn.action}">${btn.text}</button>`
  ).join('');

  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.querySelector('.toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// Utility Functions
function updateCurrentDate() {
  const now = new Date();
  document.getElementById('current-date').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Make functions globally available
window.addToOrder = addToOrder;
window.updateQuantity = updateQuantity;
window.checkIn = checkIn;
window.approveExpense = approveExpense;
window.approveSalary = approveSalary;
window.paySalary = paySalary;
window.viewEvent = (id) => showToast('View event: ' + id, 'info');
window.editItem = (id) => showToast('Edit item: ' + id, 'info');
window.editUser = (id) => showToast('Edit user: ' + id, 'info');
