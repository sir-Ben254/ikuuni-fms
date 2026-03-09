const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'new_ikuuni_fms',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;

// Database Schema Initialization
const initDatabase = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'accountant', 'kitchen', 'waiter', 'waitress')),
        phone VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Rooms Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_number VARCHAR(10) UNIQUE NOT NULL,
        room_type VARCHAR(50) NOT NULL CHECK (room_type IN ('standard', 'deluxe', 'suite', 'family')),
        price_per_night DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved')),
        amenities TEXT[],
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Guests Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS guests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(100),
        phone VARCHAR(20) NOT NULL,
        id_number VARCHAR(20),
        address TEXT,
        nationality VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Room Bookings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_bookings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID REFERENCES rooms(id),
        guest_id UUID REFERENCES guests(id),
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        number_of_guests INTEGER DEFAULT 1,
        total_amount DECIMAL(10, 2) NOT NULL,
        paid_amount DECIMAL(10, 2) DEFAULT 0,
        payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'cancelled')),
        payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'mpesa', 'card', 'transfer')),
        mpesa_receipt VARCHAR(50),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Menu Categories Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'drinks')),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Menu Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        category_id UUID REFERENCES menu_categories(id),
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        preparation_time INTEGER DEFAULT 15,
        is_available BOOLEAN DEFAULT true,
        image_url VARCHAR(255),
        ingredients JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Tables (Restaurant Tables)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_number VARCHAR(10) UNIQUE NOT NULL,
        capacity INTEGER DEFAULT 4,
        status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Orders Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(20) UNIQUE NOT NULL,
        order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'room_service')),
        table_id UUID REFERENCES tables(id),
        room_booking_id UUID REFERENCES room_bookings(id),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'served', 'completed', 'cancelled')),
        subtotal DECIMAL(10, 2) NOT NULL,
        tax_amount DECIMAL(10, 2) DEFAULT 0,
        discount_amount DECIMAL(10, 2) DEFAULT 0,
        total_amount DECIMAL(10, 2) NOT NULL,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Order Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id UUID REFERENCES menu_items(id),
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(10, 2) NOT NULL,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'served')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Payments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id),
        room_booking_id UUID REFERENCES room_bookings(id),
        catering_event_id UUID REFERENCES catering_events(id),
        amount DECIMAL(10, 2) NOT NULL,
        payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'mpesa', 'card', 'transfer')),
        reference_number VARCHAR(50),
        mpesa_receipt VARCHAR(50),
        mpesa_phone VARCHAR(20),
        status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
        processed_by UUID REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Catering Events Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS catering_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_name VARCHAR(100) NOT NULL,
        client_name VARCHAR(100) NOT NULL,
        client_phone VARCHAR(20) NOT NULL,
        client_email VARCHAR(100),
        event_date DATE NOT NULL,
        event_type VARCHAR(50),
        venue VARCHAR(100),
        number_of_guests INTEGER NOT NULL,
        menu_package_id UUID REFERENCES menu_packages(id),
        price_per_person DECIMAL(10, 2) NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        transport_cost DECIMAL(10, 2) DEFAULT 0,
        staff_cost DECIMAL(10, 2) DEFAULT 0,
        total_cost DECIMAL(10, 2) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        deposit_amount DECIMAL(10, 2) DEFAULT 0,
        paid_amount DECIMAL(10, 2) DEFAULT 0,
        payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'cancelled')),
        status VARCHAR(20) DEFAULT 'booked' CHECK (status IN ('booked', 'confirmed', 'completed', 'cancelled')),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Catering Staff Assignments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS catering_staff (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID REFERENCES catering_events(id),
        user_id UUID REFERENCES users(id),
        role VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Menu Packages Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_packages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price_per_person DECIMAL(10, 2) NOT NULL,
        menu_items JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Inventory Categories Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'drinks', 'supplies', 'equipment')),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Suppliers Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        contact_person VARCHAR(100),
        email VARCHAR(100),
        phone VARCHAR(20) NOT NULL,
        address TEXT,
        category_id UUID REFERENCES inventory_categories(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Inventory Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        category_id UUID REFERENCES inventory_categories(id),
        unit VARCHAR(20) NOT NULL,
        current_stock DECIMAL(10, 2) DEFAULT 0,
        minimum_stock DECIMAL(10, 2) DEFAULT 10,
        cost_per_unit DECIMAL(10, 2) DEFAULT 0,
        supplier_id UUID REFERENCES suppliers(id),
        expiry_date DATE,
        location VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Inventory Transactions Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id UUID REFERENCES inventory_items(id),
        transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('purchase', 'sale', 'adjustment', 'waste', 'transfer')),
        quantity DECIMAL(10, 2) NOT NULL,
        unit_cost DECIMAL(10, 2),
        total_cost DECIMAL(10, 2),
        reference_id UUID,
        reference_type VARCHAR(50),
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Purchase Orders Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(20) UNIQUE NOT NULL,
        supplier_id UUID REFERENCES suppliers(id),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
        total_amount DECIMAL(10, 2) DEFAULT 0,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        expected_date DATE,
        received_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Purchase Order Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id UUID REFERENCES purchase_orders(id),
        item_id UUID REFERENCES inventory_items(id),
        quantity DECIMAL(10, 2) NOT NULL,
        unit_cost DECIMAL(10, 2) NOT NULL,
        total_cost DECIMAL(10, 2) NOT NULL,
        received_quantity DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Expense Categories Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(50) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'alcohol', 'salaries', 'utilities', 'maintenance', 'transport', 'other')),
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Expenses Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id UUID REFERENCES expense_categories(id),
        description TEXT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'mpesa', 'card', 'transfer')),
        reference_number VARCHAR(50),
        receipt_number VARCHAR(50),
        expense_date DATE NOT NULL,
        created_by UUID REFERENCES users(id),
        approved_by UUID REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Staff Salaries Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_salaries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        year INTEGER NOT NULL,
        basic_salary DECIMAL(10, 2) NOT NULL,
        deductions DECIMAL(10, 2) DEFAULT 0,
        bonuses DECIMAL(10, 2) DEFAULT 0,
        net_salary DECIMAL(10, 2) NOT NULL,
        payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'paid', 'rejected')),
        payment_method VARCHAR(20),
        payment_date DATE,
        approved_by UUID REFERENCES users(id),
        created_by UUID REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Activity Logs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        module VARCHAR(50) NOT NULL,
        description TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Daily Reports Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_date DATE UNIQUE NOT NULL,
        total_sales DECIMAL(10, 2) DEFAULT 0,
        restaurant_sales DECIMAL(10, 2) DEFAULT 0,
        bar_sales DECIMAL(10, 2) DEFAULT 0,
        room_sales DECIMAL(10, 2) DEFAULT 0,
        catering_sales DECIMAL(10, 2) DEFAULT 0,
        total_expenses DECIMAL(10, 2) DEFAULT 0,
        net_profit DECIMAL(10, 2) DEFAULT 0,
        orders_count INTEGER DEFAULT 0,
        rooms_occupied INTEGER DEFAULT 0,
        guest_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create M-Pesa Transactions Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mpesa_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_type VARCHAR(20) NOT NULL,
        transaction_id VARCHAR(50) UNIQUE NOT NULL,
        transaction_time TIMESTAMP NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        invoice_id UUID,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'failed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Indexes for Performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_room_bookings_dates ON room_bookings(check_in, check_out)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at)`);

    await client.query('COMMIT');
    console.log('Database schema initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, initDatabase };
