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
- Real-time sales tracking

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
- Cost of goods sold (COGS)

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
- **Database**: PostgreSQL
- **Frontend**: HTML, CSS, JavaScript
- **Charts**: Chart.js
- **Reports**: PDFKit, ExcelJS

## Installation

### Prerequisites
- Node.js (v14+)
- PostgreSQL (v12+)

### Setup

1. **Clone the repository**
   ```bash
   cd "project biz 2026/ai/hotel fms"
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd client && npm install
   ```

3. **Configure database**
   - Create a PostgreSQL database named `new_ikuuni_fms`
   - Update `.env` file with your database credentials:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=new_ikuuni_fms
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Start the frontend** (in a new terminal)
   ```bash
   cd client
   npm start
   ```

6. **Access the application**
   - Open http://localhost:3001 in your browser
   - Login with default credentials:
     - Username: `admin`
     - Password: `admin123`

## Default User Roles

| Role | Description |
|------|-------------|
| Admin | Full system access, can approve payments |
| Manager | Manage all operations, approve expenses |
| Cashier | Process payments, create orders |
| Accountant | View reports, manage expenses |
| Kitchen | View kitchen orders |
| Waiter/Waitress | Create orders |

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - Create user (admin)
- `GET /api/auth/me` - Get current user

### POS
- `GET /api/pos/menu-items` - Get menu items
- `POST /api/pos/orders` - Create order
- `POST /api/pos/orders/:id/payment` - Process payment
- `GET /api/pos/sales/today` - Today's sales

### Rooms
- `GET /api/rooms` - Get all rooms
- `POST /api/rooms/bookings` - Create booking
- `POST /api/rooms/bookings/:id/check-in` - Check in guest
- `POST /api/rooms/bookings/:id/check-out` - Check out guest

### Catering
- `GET /api/catering/events` - Get events
- `POST /api/catering/events` - Create event
- `POST /api/catering/events/:id/payment` - Record payment

### Inventory
- `GET /api/inventory/items` - Get inventory
- `POST /api/inventory/purchase-orders` - Create PO
- `GET /api/inventory/alerts` - Low stock alerts

### Expenses
- `GET /api/expenses` - Get expenses
- `POST /api/expenses` - Create expense
- `POST /api/expenses/:id/approve` - Approve expense

### Staff
- `GET /api/staff/salaries` - Get salaries
- `POST /api/staff/salaries` - Create salary
- `POST /api/staff/salaries/:id/approve` - Approve salary
- `POST /api/staff/salaries/:id/pay` - Pay salary

### Reports
- `GET /api/reports/dashboard` - Dashboard data
- `GET /api/reports/daily` - Daily report
- `GET /api/reports/monthly` - Monthly report
- `GET /api/reports/export/pdf` - Export PDF
- `GET /api/reports/export/excel` - Export Excel

### M-Pesa
- `POST /api/mpesa/stk-push` - STK Push
- `GET /api/mpesa/transactions` - Get transactions
- `POST /api/mpesa/record-payment` - Record payment

## Project Structure

```
hotel fms/
├── package.json              # Main dependencies
├── .env                      # Environment variables
├── server/
│   ├── index.js              # Main server file
│   ├── config/
│   │   └── database.js       # Database configuration
│   ├── middleware/
│   │   └── auth.js           # Authentication middleware
│   └── routes/
│       ├── auth.js           # Auth routes
│       ├── pos.js            # POS routes
│       ├── rooms.js          # Room routes
│       ├── catering.js       # Catering routes
│       ├── inventory.js      # Inventory routes
│       ├── expenses.js       # Expense routes
│       ├── staff.js          # Staff routes
│       ├── reports.js        # Report routes
│       └── mpesa.js         # M-Pesa routes
└── client/
    ├── package.json
    └── public/
        ├── index.html        # Main HTML
        ├── styles.css       # CSS styles
        └── app.js          # Frontend JavaScript
```

## Automation

The system includes automatic:
- Daily report generation at midnight
- Low stock alerts every hour
- Inventory deduction on order completion

## Security

- JWT token authentication
- Password hashing with bcrypt
- Role-based access control
- Activity logging

## License

MIT License - New Ikuuni 2026
