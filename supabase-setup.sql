-- New Ikuuni Financial Management System - Database Setup
-- Run this SQL in Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'accountant', 'kitchen', 'waiter', 'waitress')),
  phone VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rooms Table
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_number VARCHAR(10) UNIQUE NOT NULL,
  room_type VARCHAR(50) NOT NULL CHECK (room_type IN ('standard', 'deluxe', 'suite', 'family')),
  price_per_night DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'reserved')),
  amenities TEXT[],
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Guests Table
CREATE TABLE IF NOT EXISTS guests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  phone VARCHAR(20) NOT NULL,
  id_number VARCHAR(20),
  address TEXT,
  nationality VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Room Bookings Table
CREATE TABLE IF NOT EXISTS room_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Menu Categories Table
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'drinks')),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Menu Items Table
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Restaurant Tables
CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_number VARCHAR(10) UNIQUE NOT NULL,
  capacity INTEGER DEFAULT 4,
  status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'served')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id),
  room_booking_id UUID REFERENCES room_bookings(id),
  amount DECIMAL(10, 2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'mpesa', 'card', 'transfer')),
  reference_number VARCHAR(50),
  mpesa_receipt VARCHAR(50),
  mpesa_phone VARCHAR(20),
  status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  processed_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Catering Events Table
CREATE TABLE IF NOT EXISTS catering_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name VARCHAR(100) NOT NULL,
  client_name VARCHAR(100) NOT NULL,
  client_phone VARCHAR(20) NOT NULL,
  client_email VARCHAR(100),
  event_date DATE NOT NULL,
  event_type VARCHAR(50),
  venue VARCHAR(100),
  number_of_guests INTEGER NOT NULL,
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
);

-- Menu Packages Table
CREATE TABLE IF NOT EXISTS menu_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_per_person DECIMAL(10, 2) NOT NULL,
  menu_items JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Categories Table
CREATE TABLE IF NOT EXISTS inventory_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'drinks', 'supplies', 'equipment')),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers Table
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  contact_person VARCHAR(100),
  email VARCHAR(100),
  phone VARCHAR(20) NOT NULL,
  address TEXT,
  category_id UUID REFERENCES inventory_categories(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory Items Table
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Inventory Transactions Table
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Purchase Orders Table
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Purchase Order Items Table
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  item_id UUID REFERENCES inventory_items(id),
  quantity DECIMAL(10, 2) NOT NULL,
  unit_cost DECIMAL(10, 2) NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  received_quantity DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Expense Categories Table
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'alcohol', 'salaries', 'utilities', 'maintenance', 'transport', 'other')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Staff Salaries Table
CREATE TABLE IF NOT EXISTS staff_salaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  module VARCHAR(50) NOT NULL,
  description TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily Reports Table
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- M-Pesa Transactions Table
CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
);

-- Enable Row Level Security (optional)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_room_bookings_dates ON room_bookings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);

-- Insert default admin user (password: admin123)
-- Note: In production, use a proper hashed password
INSERT INTO users (username, email, password_hash, full_name, role, phone)
VALUES ('admin', 'admin@newikuuni.com', '$2a$10$rBVcJWGLmE7vKjN7xJ5G5O0Z5fY5fY5fY5fY5fY5fY5fY5fY5fY5fY5fY', 'System Administrator', 'admin', '+254700000000')
ON CONFLICT (username) DO NOTHING;

-- Insert sample menu categories
INSERT INTO menu_categories (name, type, description) VALUES 
('Main Dishes', 'food', 'Main course meals'),
('Drinks', 'drinks', 'Beverages and cocktails'),
('Desserts', 'food', 'Sweet treats'),
('Snacks', 'food', 'Light bites')
ON CONFLICT DO NOTHING;

-- Insert sample rooms
INSERT INTO rooms (room_number, room_type, price_per_night, status) VALUES 
('101', 'standard', 3000, 'available'),
('102', 'standard', 3000, 'available'),
('201', 'deluxe', 5000, 'available'),
('202', 'deluxe', 5000, 'available'),
('301', 'suite', 8000, 'available')
ON CONFLICT (room_number) DO NOTHING;

-- Insert sample restaurant tables
INSERT INTO tables (table_number, capacity, status) VALUES 
('T1', 4, 'available'),
('T2', 4, 'available'),
('T3', 6, 'available'),
('T4', 2, 'available'),
('T5', 8, 'available')
ON CONFLICT (table_number) DO NOTHING;

-- Insert expense categories
INSERT INTO expense_categories (name, type) VALUES 
('Food Supplies', 'food'),
('Alcohol Purchases', 'alcohol'),
('Staff Salaries', 'salaries'),
('Utilities', 'utilities'),
('Maintenance', 'maintenance'),
('Transport', 'transport')
ON CONFLICT DO NOTHING;

-- Insert inventory categories
INSERT INTO inventory_categories (name, type) VALUES 
('Food Ingredients', 'food'),
('Beverages', 'drinks'),
('Cleaning Supplies', 'supplies'),
('Kitchen Equipment', 'equipment')
ON CONFLICT DO NOTHING;

SELECT 'Database setup completed successfully!' as message;
