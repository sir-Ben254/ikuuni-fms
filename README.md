# New Ikuuni Financial Management System

A comprehensive hospitality management system for New Ikuuni hotel and restaurant in Machakos Town, Kenya.

## Features

### 1. User Authentication & Roles
- **Roles**: Admin, Manager, Cashier, Accountant, Kitchen Staff, Waiter, Waitress
- Secure login with JWT tokens
- Role-based access control
- Activity logging

### 2. Point of Sale (POS)
- Restaurant and bar sales
- Table management
- Food and drink menu
- Order notes
- Kitchen order tickets
- Multiple payment methods (Cash, M-Pesa, Card)
- Automatic inventory deduction

### 3. Room Management
- Room booking calendar
- Guest management
- Check-in/Check-out
- Room pricing
- Payment tracking

### 4. Catering Management
- Event booking
- Client management
- Menu packages
- Staff assignments
- Transportation costs
- Deposit tracking

### 5. Inventory Management
- Stock tracking
- Supplier management
- Purchase orders
- Low-stock alerts

### 6. Expense Tracking
- Multiple expense categories
- Approval workflow
- Daily/Monthly summaries

### 7. Financial Reports
- Daily/Weekly/Monthly/Yearly reports
- Sales by category
- Top selling items
- Export to PDF/Excel

### 8. M-Pesa Integration (Kenya)
- Payment recording
- Transaction matching
- STK Push support

### 9. Staff & Payroll
- Staff management
- Salary creation
- Manager approval
- Admin payment approval
- Payment processing

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Frontend**: HTML, CSS, JavaScript
- **Charts**: Chart.js

## Quick Start with Supabase

### Step 1: Create Supabase Project
1. Go to https://supabase.com/
2. Create a free account
3. Create a new project
4. Wait for the database to be ready

### Step 2: Get Supabase Credentials
From your Supabase dashboard:
- **Project URL**: Settings → API → Project URL
- **Anon Key**: Settings → API → Project API keys → `anon` key

### Step 3: Update Environment Variables
Edit `.env` file:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

### Step 4: Create Database Tables
In Supabase Dashboard:
1. Go to **SQL Editor**
2. Copy the SQL from `server/config/database.js` (the CREATE TABLE statements)
3. Run the SQL

### Step 5: Run the Server
```bash
npm install
npm start
```

### Step 6: Access the Application
- Open http://localhost:3000
- Login with: admin / admin123

## Deployment to Online

### Option 1: Vercel (Backend) + Supabase

1. **Deploy Backend to Vercel:**
```bash
npm install -g vercel
vercel
```

2. **Update Frontend API Base URL:**
Edit `client/public/app.js` and change:
```javascript
const API_BASE = 'https://your-vercel-backend.vercel.app/api';
```

3. **Deploy Frontend:**
```bash
cd client
npx serve public
```

Or deploy to Vercel/Netlify as a static site.

### Option 2: Railway/Render

1. Deploy to Railway or Render
2. Set environment variables in dashboard
3. Connect to Supabase

## Environment Variables

```env
# Server
PORT=3000

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# JWT
JWT_SECRET=your-secret-key

# M-Pesa (Kenya)
MPESA_CONSUMER_KEY=your_key
MPESA_CONSUMER_SECRET=your_secret
MPESA_SHORTCODE=your_shortcode
```

## Default Login

- **Username:** admin
- **Password:** admin123

## Project Structure

```
hotel fms/
├── package.json
├── .env                    # Environment variables
├── server/
│   ├── index.js           # Main server
│   ├── config/
│   │   └── database.js    # Supabase configuration
│   ├── middleware/
│   │   └── auth.js       # Authentication
│   └── routes/           # API routes
└── client/
    └── public/
        ├── index.html    # Main HTML
        ├── styles.css   # CSS
        ├── app.js       # Frontend JS
        └── supabase.js  # Supabase client
```

## Security

- JWT token authentication
- Password hashing with bcrypt
- Role-based access control
- Row Level Security (RLS) in Supabase

## License

MIT License - New Ikuuni 2026
