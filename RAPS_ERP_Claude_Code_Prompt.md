# RAPS ERP System — Claude Code Build Prompt

> Copy-paste this entire prompt into Claude Code to build the full system.

---

## PROMPT START — COPY BELOW THIS LINE

---

Build a full-stack ERP system for **RAPS** — a company that operates across Manufacturing, Trading/Distribution, and Services. The system must be minimalistic, simple, and modern in design.

Use the RAPS logo located at: `./rapslogo6.png`  
Brand colors: **Navy Blue (#1B3A6B)**, **Red (#E63329)**, **White (#FFFFFF)**, **Light Gray (#F5F6FA)**

---

## TECH STACK

**Frontend:** React 18 + Vite + Tailwind CSS + Lucide React icons + Recharts (for dashboard charts)  
**Backend:** Node.js + Express.js  
**Database:** PostgreSQL (use Prisma ORM)  
**Auth:** JWT (access + refresh tokens), bcrypt for password hashing  
**File Uploads:** Multer (for PDF test reports)  
**PDF Viewing:** react-pdf or iframe embed  

---

## DESIGN SYSTEM — MINIMALISTIC & MODERN

Follow these design rules strictly:

1. **Clean white backgrounds** with subtle gray (#F5F6FA) section separators
2. **Navy Blue (#1B3A6B)** for primary actions, sidebar, headers
3. **Red (#E63329)** only for alerts, warnings, and the logo accent
4. **Typography:** Use "DM Sans" from Google Fonts — clean, geometric, modern
5. **Spacing:** Generous whitespace. No clutter. Every element breathes.
6. **Cards:** White cards with very subtle shadow (`shadow-sm`), rounded-lg corners, no borders
7. **Sidebar:** Fixed left sidebar, navy blue background, white icons + text, collapsible
8. **Tables:** Clean minimal tables with alternating row backgrounds (#F5F6FA), no heavy borders
9. **Buttons:** Rounded-md, navy blue primary, ghost/outline secondary. No gradients.
10. **Inputs:** Simple bordered inputs with focus ring in navy blue
11. **Animations:** Subtle fade-in on page load. No flashy animations.
12. **Mobile:** Fully responsive. Sidebar collapses to hamburger on mobile.

---

## DATABASE SCHEMA (PostgreSQL + Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ──── USERS & AUTH ────
model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String
  name          String
  role          Role      @default(STAFF)
  department    String?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  auditLogs     AuditLog[]
}

model Session {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  refreshToken String   @unique
  expiresAt    DateTime
  createdAt    DateTime @default(now())
}

enum Role {
  ADMIN
  MANAGER
  STAFF
  VIEWER
}

// ──── AUDIT LOG ────
model AuditLog {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  action     String   // CREATE, UPDATE, DELETE, LOGIN, LOGOUT
  entity     String   // Product, Invoice, PurchaseOrder, etc.
  entityId   String?
  details    Json?
  ipAddress  String?
  createdAt  DateTime @default(now())
}

// ──── SUPPLIERS ────
model Supplier {
  id            String    @id @default(uuid())
  name          String
  contactPerson String?
  email         String?
  phone         String?
  address       String?
  gstNumber     String?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  products      Product[]
  purchaseOrders PurchaseOrder[]
}

// ──── PRODUCTS / INVENTORY ────
model Product {
  id              String    @id @default(uuid())
  name            String
  sku             String    @unique
  description     String?
  category        String?
  unit            String    @default("pcs") // pcs, kg, litre, meter, etc.
  hsnCode         String?   // for GST
  currentStock    Float     @default(0)
  minStockLevel   Float     @default(0)
  maxStockLevel   Float?
  costPrice       Float     @default(0)
  sellingPrice    Float     @default(0)
  supplierId      String?
  supplier        Supplier? @relation(fields: [supplierId], references: [id])
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  stockMovements  StockMovement[]
  testReports     TestReport[]
  purchaseItems   PurchaseItem[]
  saleItems       SaleItem[]
}

// ──── TEST REPORTS (PDF uploads when product arrives) ────
model TestReport {
  id            String   @id @default(uuid())
  productId     String
  product       Product  @relation(fields: [productId], references: [id])
  fileName      String
  filePath      String   // stored on server filesystem
  fileSize      Int
  batchNumber   String?
  reportDate    DateTime?
  uploadedBy    String   // userId
  notes         String?
  createdAt     DateTime @default(now())
}

// ──── STOCK MOVEMENTS ────
model StockMovement {
  id            String        @id @default(uuid())
  productId     String
  product       Product       @relation(fields: [productId], references: [id])
  type          MovementType
  quantity      Float
  referenceType String?       // PurchaseOrder, SaleOrder, Adjustment
  referenceId   String?
  batchNumber   String?
  notes         String?
  createdAt     DateTime      @default(now())
}

enum MovementType {
  IN
  OUT
  ADJUSTMENT
}

// ──── PURCHASE ORDERS ────
model PurchaseOrder {
  id              String        @id @default(uuid())
  orderNumber     String        @unique
  supplierId      String
  supplier        Supplier      @relation(fields: [supplierId], references: [id])
  status          POStatus      @default(DRAFT)
  orderDate       DateTime      @default(now())
  expectedDate    DateTime?
  receivedDate    DateTime?
  subtotal        Float         @default(0)
  taxAmount       Float         @default(0)
  totalAmount     Float         @default(0)
  notes           String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  items           PurchaseItem[]
}

enum POStatus {
  DRAFT
  SENT
  PARTIALLY_RECEIVED
  RECEIVED
  CANCELLED
}

model PurchaseItem {
  id              String        @id @default(uuid())
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id])
  productId       String
  product         Product       @relation(fields: [productId], references: [id])
  quantity        Float
  receivedQty     Float         @default(0)
  unitPrice       Float
  taxPercent      Float         @default(0)
  totalPrice      Float
}

// ──── CUSTOMERS ────
model Customer {
  id            String    @id @default(uuid())
  name          String
  contactPerson String?
  email         String?
  phone         String?
  address       String?
  gstNumber     String?
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  saleOrders    SaleOrder[]
}

// ──── SALE ORDERS & INVOICING ────
model SaleOrder {
  id              String      @id @default(uuid())
  orderNumber     String      @unique
  customerId      String
  customer        Customer    @relation(fields: [customerId], references: [id])
  status          SOStatus    @default(DRAFT)
  orderDate       DateTime    @default(now())
  subtotal        Float       @default(0)
  taxAmount       Float       @default(0)
  totalAmount     Float       @default(0)
  notes           String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  items           SaleItem[]
  invoice         Invoice?
}

enum SOStatus {
  DRAFT
  CONFIRMED
  DISPATCHED
  DELIVERED
  CANCELLED
}

model SaleItem {
  id            String    @id @default(uuid())
  saleOrderId   String
  saleOrder     SaleOrder @relation(fields: [saleOrderId], references: [id])
  productId     String
  product       Product   @relation(fields: [productId], references: [id])
  quantity      Float
  unitPrice     Float
  taxPercent    Float     @default(0)
  totalPrice    Float
}

model Invoice {
  id            String        @id @default(uuid())
  invoiceNumber String        @unique
  saleOrderId   String        @unique
  saleOrder     SaleOrder     @relation(fields: [saleOrderId], references: [id])
  status        InvoiceStatus @default(UNPAID)
  issueDate     DateTime      @default(now())
  dueDate       DateTime
  subtotal      Float
  taxAmount     Float
  totalAmount   Float
  paidAmount    Float         @default(0)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

enum InvoiceStatus {
  UNPAID
  PARTIALLY_PAID
  PAID
  OVERDUE
  CANCELLED
}
```

---

## BACKEND API STRUCTURE

```
server/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.js              # Express app entry
│   ├── config/
│   │   └── db.js             # Prisma client
│   ├── middleware/
│   │   ├── auth.js           # JWT verification middleware
│   │   ├── rbac.js           # Role-based access middleware
│   │   ├── audit.js          # Audit logging middleware
│   │   └── upload.js         # Multer config for PDF uploads
│   ├── routes/
│   │   ├── auth.routes.js    # Login, Register, Refresh, Logout
│   │   ├── user.routes.js    # User CRUD (admin only)
│   │   ├── product.routes.js # Products CRUD + stock
│   │   ├── supplier.routes.js
│   │   ├── customer.routes.js
│   │   ├── purchase.routes.js  # Purchase Orders
│   │   ├── sale.routes.js      # Sale Orders
│   │   ├── invoice.routes.js   # Invoices
│   │   ├── inventory.routes.js # Stock movements, test reports
│   │   ├── report.routes.js    # Dashboard data / analytics
│   │   └── upload.routes.js    # PDF test report upload/download
│   ├── controllers/          # Business logic per route
│   ├── services/             # Reusable business logic
│   └── utils/
│       ├── jwt.js
│       └── helpers.js
├── uploads/                  # PDF test reports stored here
├── .env
└── package.json
```

### Key API Endpoints:

**Auth:**
- `POST /api/auth/login` — email + password → returns JWT access + refresh token
- `POST /api/auth/refresh` — refresh token → new access token
- `POST /api/auth/logout` — invalidate session

**Products:**
- `GET /api/products` — list all (with search, filter, pagination)
- `POST /api/products` — create product
- `GET /api/products/:id` — get single product with stock history + test reports
- `PUT /api/products/:id` — update
- `DELETE /api/products/:id` — soft delete

**Inward Entry (Product Arrival — THE CORE FLOW):**
- `POST /api/inventory/inward` — Record product arriving at premises:
  - Select product or create new
  - Enter quantity, batch number, supplier
  - Upload PDF test report (required)
  - Auto-updates stock (StockMovement type=IN)
  - Links test report to product
- `GET /api/inventory/test-reports/:productId` — List all test reports for a product
- `GET /api/uploads/:filename` — Serve/download the PDF file

**Purchase Orders:**
- Full CRUD + status transitions (Draft → Sent → Received)
- `POST /api/purchase/:id/receive` — Mark items received, auto-creates inward entry

**Sales & Invoicing:**
- Full CRUD for sale orders
- `POST /api/sales/:id/invoice` — Generate invoice from sale order
- `PUT /api/invoices/:id/payment` — Record payment

**Dashboard:**
- `GET /api/reports/dashboard` — Returns:
  - Total products, low stock alerts
  - Monthly purchase vs sales totals
  - Recent inward entries
  - Pending invoices / overdue payments
  - Revenue trend (last 6 months)

---

## FRONTEND STRUCTURE

```
client/
├── public/
│   └── rapslogo6.png
├── src/
│   ├── main.jsx
│   ├── App.jsx               # Router setup
│   ├── api/
│   │   └── axios.js          # Axios instance with interceptors
│   ├── context/
│   │   └── AuthContext.jsx   # Auth state management
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx       # Collapsible navy sidebar
│   │   │   ├── Header.jsx        # Top bar with user menu
│   │   │   └── MainLayout.jsx    # Sidebar + Header + content area
│   │   ├── ui/
│   │   │   ├── Button.jsx
│   │   │   ├── Input.jsx
│   │   │   ├── Modal.jsx
│   │   │   ├── Table.jsx
│   │   │   ├── Card.jsx
│   │   │   ├── Badge.jsx
│   │   │   ├── Dropdown.jsx
│   │   │   └── FileUpload.jsx    # Drag-drop PDF upload
│   │   └── shared/
│   │       ├── SearchBar.jsx
│   │       ├── Pagination.jsx
│   │       └── StatsCard.jsx
│   ├── pages/
│   │   ├── Login.jsx             # Clean centered login card
│   │   ├── Dashboard.jsx         # Stats + charts + recent activity
│   │   ├── Products.jsx          # Product list + CRUD
│   │   ├── ProductDetail.jsx     # Single product: info, stock, test reports
│   │   ├── InwardEntry.jsx       # ⭐ THE KEY PAGE: product arrival + PDF upload
│   │   ├── Suppliers.jsx
│   │   ├── Customers.jsx
│   │   ├── PurchaseOrders.jsx
│   │   ├── PurchaseOrderForm.jsx
│   │   ├── SaleOrders.jsx
│   │   ├── SaleOrderForm.jsx
│   │   ├── Invoices.jsx
│   │   ├── InvoiceDetail.jsx
│   │   ├── StockMovements.jsx
│   │   └── Settings.jsx         # User profile, change password
│   ├── hooks/
│   │   ├── useAuth.js
│   │   └── useFetch.js
│   └── utils/
│       └── formatters.js        # Date, currency, number formatters
├── tailwind.config.js
├── .env
└── package.json
```

---

## PAGE-BY-PAGE SPECS

### 1. LOGIN PAGE
- Centered card on a white/light-gray background
- RAPS logo at top
- Email + Password fields
- "Sign In" button (navy blue, full width)
- Error messages in red text below inputs
- No registration — admin creates users

### 2. DASHBOARD
- **Top row:** 4 stat cards — Total Products, Low Stock Alerts (red badge), Monthly Revenue, Pending Invoices
- **Middle row:** 
  - Left: Line chart (Recharts) — Revenue trend last 6 months
  - Right: Bar chart — Purchase vs Sales comparison
- **Bottom row:**
  - Recent Inward Entries table (last 10)
  - Overdue Invoices table

### 3. INWARD ENTRY PAGE (⭐ Most Important)
This is the core workflow when a product arrives at the premises:

**Step-by-step form:**
1. **Select or search product** (autocomplete dropdown)
2. **Supplier** (dropdown)
3. **Quantity** received
4. **Batch Number** (text input)
5. **Upload Test Report PDF** (drag-and-drop zone, accepts only PDF, max 10MB)
6. **Notes** (optional textarea)
7. **Submit** → Creates StockMovement (IN) + saves TestReport + updates product stock

**After submit:** Show success toast, display link to view uploaded PDF, option to add another entry.

**Test Report viewer:** When clicking a test report, open PDF in a modal or side panel using an iframe.

### 4. PRODUCTS PAGE
- Search bar + category filter
- Table: SKU, Name, Category, Stock, Cost Price, Selling Price, Status
- Low stock items highlighted with red badge
- Click row → Product Detail page
- "Add Product" button → modal form

### 5. PRODUCT DETAIL PAGE
- Product info card at top
- Tabs below:
  - **Stock History** — table of all movements (in/out/adjustments)
  - **Test Reports** — list of uploaded PDFs with view/download buttons
  - **Purchase History** — linked purchase orders
  - **Sales History** — linked sale orders

### 6. PURCHASE ORDERS
- Table: PO Number, Supplier, Date, Status (badge), Total Amount
- Create PO form: select supplier, add line items (product + qty + price), auto-calculate totals
- Receive PO → triggers inward entry flow

### 7. SALE ORDERS & INVOICES
- Sale order CRUD with line items
- Generate invoice from confirmed sale order
- Invoice page: shows invoice details, payment status, record payment button

---

## SECURITY REQUIREMENTS

1. **JWT tokens:** Access token (15 min expiry), Refresh token (7 days, stored in httpOnly cookie)
2. **Password hashing:** bcrypt with salt rounds = 12
3. **RBAC middleware:** Admin > Manager > Staff > Viewer
4. **Audit logging:** Log every CREATE, UPDATE, DELETE action with user ID, timestamp, IP
5. **File upload security:** 
   - Only accept `.pdf` MIME type
   - Max file size: 10MB
   - Store outside public directory
   - Serve via authenticated API route
6. **Input validation:** Use Joi or Zod on all API inputs
7. **Rate limiting:** 100 requests/min per IP on auth routes
8. **CORS:** Restrict to frontend origin only
9. **Helmet.js:** Security headers
10. **SQL Injection:** Handled by Prisma ORM (parameterized queries)

---

## SEED DATA

Create a seed script (`prisma/seed.js`) with:
- 1 Admin user: `admin@raps.com` / `Admin@123`
- 1 Manager user: `manager@raps.com` / `Manager@123`
- 5 sample suppliers
- 10 sample products with realistic names and SKUs
- 3 sample purchase orders
- 3 sample sale orders with invoices

---

## RUN INSTRUCTIONS

The final project should be runnable with:

```bash
# Setup
cp .env.example .env
# Edit DATABASE_URL in .env

# Backend
cd server
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev

# Frontend
cd client
npm install
npm run dev
```

---

## SUMMARY

Build this complete, working ERP system. Start with the backend (schema + auth + APIs), then the frontend (login → dashboard → inward entry → all other pages). Every page should be functional, connected to the backend, and follow the minimalistic navy-blue + white design system. The **Inward Entry** workflow with PDF test report upload is the most critical feature — make it bulletproof.

---

## PROMPT END

