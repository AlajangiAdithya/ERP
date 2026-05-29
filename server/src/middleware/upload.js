const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

function makeStorage(subdir) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      const id = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${id}${ext}`);
    },
  });
}

const pdfOnly = (_req, file, cb) => {
  if (file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('Only PDF files are allowed'), false);
};

const prSpecsUpload = multer({
  storage: makeStorage('pr-specs'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const quotationUpload = multer({
  storage: makeStorage('quotations'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const qcDocsUpload = multer({
  storage: makeStorage('qc-docs'),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Signed/scanned PO PDF uploaded by Purchase Officer when sending the QC request.
// QC consumes this in place of the auto-generated PO so they see the actually-issued document.
const poDocumentUpload = multer({
  storage: makeStorage('po-docs'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Invoice PDF uploaded by Purchase Officer per delivered lot.
// Surfaced to QC alongside PR specs + PO annexure for that lot's inspection.
const invoiceUpload = multer({
  storage: makeStorage('invoices'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// One-time Vendor Evaluation PDF tied to a Supplier (never expires).
const vendorEvaluationUpload = multer({
  storage: makeStorage('vendor-evaluations'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Annual Supplier Assessment PDF tied to a Supplier (one per FY).
const supplierAssessmentUpload = multer({
  storage: makeStorage('supplier-assessments'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Customer's INWARD gate-pass PDF (FIM document — original or duplicate copy
// the customer hands over with the material).
const fimGpUpload = multer({
  storage: makeStorage('fim-gp'),
  fileFilter: pdfOnly,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const publicUrlFor = (subdir, filename) => `/uploads/${subdir}/${filename}`;

module.exports = {
  prSpecsUpload,
  quotationUpload,
  qcDocsUpload,
  poDocumentUpload,
  invoiceUpload,
  vendorEvaluationUpload,
  supplierAssessmentUpload,
  fimGpUpload,
  publicUrlFor,
  UPLOAD_ROOT,
};
