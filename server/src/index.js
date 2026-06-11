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
const materialPoolRoutes = require('./routes/materialPool.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const paymentRequestRoutes = require('./routes/paymentRequest.routes');
const qcInspectionRoutes = require('./routes/qcInspection.routes');
const gatePassRoutes = require('./routes/gatepass.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const driverRoutes = require('./routes/driver.routes');
const vehicleTripRoutes = require('./routes/vehicleTrip.routes');
const ionRoutes = require('./routes/ion.routes');
const inventoryTransferRoutes = require('./routes/inventoryTransfer.routes');
const supplierRoutes = require('./routes/supplier.routes');
const workOrderRoutes = require('./routes/workOrder.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const calibrationRoutes = require('./routes/calibration.routes');
const machineryRoutes = require('./routes/machinery.routes');
const fireExtinguisherRoutes = require('./routes/fireExtinguisher.routes');
const employeeRoutes = require('./routes/employee.routes');
const skillMatrixRoutes = require('./routes/skillMatrix.routes');
const trainingPlanRoutes = require('./routes/trainingPlan.routes');
const trainingSessionRoutes = require('./routes/trainingSession.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const kpiQmsRoutes = require('./routes/kpiQms.routes');
const messageRoutes = require('./routes/message.routes');
const calendarRoutes = require('./routes/calendar.routes');

const app = express();
const PORT = process.env.PORT || 5001;

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // @react-pdf/renderer compiles a Yoga WASM module at runtime,
      // fetches the .wasm bytes as a data: URI, and runs in a blob: worker.
      'script-src': ["'self'", "'wasm-unsafe-eval'"],
      'worker-src': ["'self'", 'blob:'],
      'connect-src': ["'self'", 'data:', 'blob:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    },
  },
}));
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

// Static — uploaded files (material specs, quotation PDFs, QC docs)
const uploadsDir = path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d', etag: true }));

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
app.use('/api/material-pools', materialPoolRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/payment-requests', paymentRequestRoutes);
app.use('/api/qc-inspections', qcInspectionRoutes);
app.use('/api/gatepasses', gatePassRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/vehicle-trips', vehicleTripRoutes);
app.use('/api/ion', ionRoutes);
app.use('/api/inventory-transfers', inventoryTransferRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/work-orders', workOrderRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/calibration', calibrationRoutes);
app.use('/api/machinery', machineryRoutes);
app.use('/api/fire-extinguishers', fireExtinguisherRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/skill-matrix', skillMatrixRoutes);
app.use('/api/training-plans', trainingPlanRoutes);
app.use('/api/training-sessions', trainingSessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/kpi-qms', kpiQmsRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calendar', calendarRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve React SPA (production only) ─────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  // Vite emits content-hashed filenames under /assets/* — safe to cache forever.
  app.use('/assets', express.static(path.join(clientDist, 'assets'), { maxAge: '1y', immutable: true }));
  // Top-level files (index.html, sw.js, manifest, logo PNGs) keep stable URLs across
  // deploys, so they must NOT be marked immutable or browsers serve stale copies.
  app.use(express.static(clientDist, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
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
  const { startSchedulers: startClosureSla } = require('./jobs/closureSla');
  prisma.$queryRaw`SELECT 1`
    .then(() => {
      app.listen(PORT, () => {
        console.log(`RAPS ERP Server running on port ${PORT}`);
        startClosureSla();
      });
    })
    .catch((err) => {
      console.error('Database connection failed:', err.message);
      process.exit(1);
    });
}

module.exports = app;