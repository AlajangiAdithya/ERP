require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const unitRoutes = require('./routes/unit.routes');
const productRoutes = require('./routes/product.routes');
const requestRoutes = require('./routes/request.routes');
const purchaseRequestRoutes = require('./routes/purchaseRequest.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const reportRoutes = require('./routes/report.routes');
const alertRoutes = require('./routes/alert.routes');
const quotationRoutes = require('./routes/quotation.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const paymentRequestRoutes = require('./routes/paymentRequest.routes');
const qcInspectionRoutes = require('./routes/qcInspection.routes');
const gatePassRoutes = require('./routes/gatepass.routes');
const ionRoutes = require('./routes/ion.routes');
const inventoryTransferRoutes = require('./routes/inventoryTransfer.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));

// Rate limiting on auth routes
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
});

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/products', productRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/purchase-requests', purchaseRequestRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/payment-requests', paymentRequestRoutes);
app.use('/api/qc-inspections', qcInspectionRoutes);
app.use('/api/gatepasses', gatePassRoutes);
app.use('/api/ion', ionRoutes);
app.use('/api/inventory-transfers', inventoryTransferRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve React SPA (production only) ─────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist, { maxAge: '1y', immutable: true }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const prisma = require('./config/db');
  prisma.$queryRaw`SELECT 1`
    .then(() => {
      app.listen(PORT, () => {
        console.log(`RAPS ERP Server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Database connection failed:', err.message);
      process.exit(1);
    });
}

module.exports = app;