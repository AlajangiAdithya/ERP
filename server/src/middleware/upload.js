const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Size limits — env-overridable; defaults preserve historical values.
const MB = 1024 * 1024;
const SIZE_PDF = (parseInt(process.env.UPLOAD_MAX_PDF_MB, 10) || 10) * MB;
const SIZE_QC  = (parseInt(process.env.UPLOAD_MAX_QC_MB,  10) || 15) * MB;
const SIZE_DOC = (parseInt(process.env.UPLOAD_MAX_DOC_MB, 10) || 15) * MB;

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

const pdfOrImage = (_req, file, cb) => {
  const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  if (ok.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only PDF, PNG, or JPG files are allowed'), false);
};

// Work Order closure docs: PDF, images, DWG, DOC/DOCX. DWG mime varies wildly
// across browsers/OSes — we accept a broad mime list plus an extension fallback
// (browsers commonly send 'application/octet-stream' for unknown types).
const closureMimeAllowList = (_req, file, cb) => {
  const ok = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/jpg',
    'application/acad', 'image/vnd.dwg', 'application/dwg', 'application/x-dwg', 'drawing/dwg',
    'application/octet-stream',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  const extOk = /\.(pdf|png|jpe?g|dwg|docx?)$/i.test(file.originalname || '');
  if (extOk || ok.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type. Allowed: PDF, PNG, JPG, DWG, DOC, DOCX'), false);
};

const prSpecsUpload = multer({
  storage: makeStorage('pr-specs'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

const quotationUpload = multer({
  storage: makeStorage('quotations'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

const qcDocsUpload = multer({
  storage: makeStorage('qc-docs'),
  fileFilter: pdfOrImage,
  limits: { fileSize: SIZE_QC },
});

// Signed/scanned PO PDF uploaded by Purchase Officer when sending the QC request.
// QC consumes this in place of the auto-generated PO so they see the actually-issued document.
const poDocumentUpload = multer({
  storage: makeStorage('po-docs'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Invoice PDF uploaded by Purchase Officer per delivered lot.
// Surfaced to QC alongside PR specs + PO annexure for that lot's inspection.
const invoiceUpload = multer({
  storage: makeStorage('invoices'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Supplier lot report PDF (test report / COA / COC / mill cert) uploaded by
// Purchase Officer alongside the invoice at goods-arrived.
const lotReportUpload = multer({
  storage: makeStorage('lot-reports'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Combined uploader for the goods-arrived form: invoice (required) + optional
// lot report. Both written into their respective subdirectories.
const goodsArrivedUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      const subdir = file.fieldname === 'lotReportFile' ? 'lot-reports' : 'invoices';
      const dir = path.join(UPLOAD_ROOT, subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      const id = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${id}${ext}`);
    },
  }),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// One-time Vendor Evaluation PDF tied to a Supplier (never expires).
const vendorEvaluationUpload = multer({
  storage: makeStorage('vendor-evaluations'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Annual Supplier Assessment PDF tied to a Supplier (one per FY).
const supplierAssessmentUpload = multer({
  storage: makeStorage('supplier-assessments'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Customer's INWARD gate-pass PDF (FIM document — original or duplicate copy
// the customer hands over with the material).
const fimGpUpload = multer({
  storage: makeStorage('fim-gp'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Calibration certificate PDF (one per fiscal-year record on a calibration item).
// Every viewer of the metrology register is allowed to download these.
const calibrationCertUpload = multer({
  storage: makeStorage('calibration-certs'),
  fileFilter: pdfOnly,
  limits: { fileSize: SIZE_PDF },
});

// Work Order closure documents — uploaded by unit heads (reports/drawings/
// photos), QC (certificate), Finance (bill/hold-checklist) and Accounts.
// Mixed file types: pdf, png/jpg/jpeg, dwg, doc/docx. 15 MB cap.
const closureDocUpload = multer({
  storage: makeStorage('wo-closure'),
  fileFilter: closureMimeAllowList,
  limits: { fileSize: SIZE_DOC },
});

// AMC contracts / fire-extinguisher service slips attached to the Machinery
// register. PDFs or scanned images — Safety uploads originals; everyone reads.
const amcDocUpload = multer({
  storage: makeStorage('amc-docs'),
  fileFilter: pdfOrImage,
  limits: { fileSize: SIZE_PDF },
});

// Training-session notes, evaluation sheets, attendee sign images, HoD signs
// on the skill matrix. PDFs or scanned images.
const trainingDocUpload = multer({
  storage: makeStorage('training-docs'),
  fileFilter: pdfOrImage,
  limits: { fileSize: SIZE_PDF },
});

// Company certification documents (ISO etc.) on the KPI-QMS dashboard panel.
// Unit-5 uploads originals; everyone views.
const qmsCertUpload = multer({
  storage: makeStorage('qms-certs'),
  fileFilter: pdfOrImage,
  limits: { fileSize: SIZE_PDF },
});

// QMS document library (SOPs + Work Instructions). Unit-5 uploads; everyone views.
const qmsDocUpload = multer({
  storage: makeStorage('qms-docs'),
  fileFilter: pdfOrImage,
  limits: { fileSize: SIZE_DOC },
});

const publicUrlFor = (subdir, filename) => `/uploads/${subdir}/${filename}`;

module.exports = {
  prSpecsUpload,
  quotationUpload,
  qcDocsUpload,
  poDocumentUpload,
  invoiceUpload,
  lotReportUpload,
  goodsArrivedUpload,
  vendorEvaluationUpload,
  supplierAssessmentUpload,
  fimGpUpload,
  calibrationCertUpload,
  closureDocUpload,
  amcDocUpload,
  trainingDocUpload,
  qmsCertUpload,
  qmsDocUpload,
  publicUrlFor,
  UPLOAD_ROOT,
};
