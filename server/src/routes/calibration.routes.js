// ──────────────────────────────────────────────────────────────
// Metrology — Calibration Item registry
//
// Access model (per access-chart RAPS/QSP):
//   • Full edit: METROLOGY, QC, and any MANAGER assigned to UNIT-V.
//                (SUPERADMIN bypasses every authorize() check globally.)
//   • View + remarks + cert download:
//                ADMIN, MANAGER (all units), LAB, NDT, RND.
//   • Remarks: editable by anyone who can view the register
//                (handled by a dedicated PATCH /:id/remarks route).
// Server gates everything; the UI hides controls based on the same rules.
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { calibrationCertUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

// Unit 5 may appear as code '5', name 'Unit 5', or username 'unit 5'
// depending on which path created the account — match any of them.
const EDIT_UNIT_CODES = ['5', 'UNIT-V', 'UNIT-5'];
const EDIT_UNIT_NAMES = ['unit 5', 'unit-5', 'unit5', 'unit v'];
const BASE_EDIT_ROLES = ['METROLOGY', 'QC'];
const BASE_VIEW_ROLES = ['ADMIN', 'METROLOGY', 'QC', 'LAB', 'NDT', 'RND', 'HR'];

const unitCodeOf = (user) => (user?.unit?.code || '').toString().toUpperCase();
const unitNameOf = (user) => (user?.unit?.name || '').toString().trim().toLowerCase();
const usernameOf = (user) => (user?.username || '').toString().trim().toLowerCase();

const isUnit5Manager = (user) => {
  if (user?.role !== 'MANAGER') return false;
  if (EDIT_UNIT_CODES.includes(unitCodeOf(user))) return true;
  if (EDIT_UNIT_NAMES.includes(unitNameOf(user))) return true;
  if (EDIT_UNIT_NAMES.includes(usernameOf(user))) return true;
  return false;
};

const canWrite = (user) => {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true; // owner hatch, never appears in UI
  if (BASE_EDIT_ROLES.includes(user.role)) return true;
  if (isUnit5Manager(user)) return true;
  return false;
};

const canRead = (user) => {
  if (!user) return false;
  if (canWrite(user)) return true;
  if (BASE_VIEW_ROLES.includes(user.role)) return true;
  if (user.role === 'MANAGER') return true; // any unit manager may view
  return false;
};

const requireRead = (req, res, next) => {
  if (!canRead(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const requireWrite = (req, res, next) => {
  if (!canWrite(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const VALID_CATEGORIES = [
  'PRESSURE_GAUGE',
  'VACUUM_GAUGE',
  'WEIGHING_BALANCE',
  'TESTING_EQUIPMENT',
  'METROLOGY_INSTRUMENT',
  'MMR',
];

const VALID_MMR_SUBS = [
  'PRESSURE_GAUGES',
  'VACUUM_GAUGES',
  'METROLOGY_INSTRUMENTS',
  'LAB_TESTING_EQUIPMENT',
  'AUTOCLAVE_OVEN_THERMOCOUPLES',
  'EOT_CRANES_CHAIN_BLOCKS',
  'WEIGHING_BALANCES',
  'NDT',
  'OTHER',
];

// Per-MMR-sub-category prefix used to mint RAPSPL serials. Each bucket has
// its own running counter, so Pressure Gauges and Vacuum Gauges start over
// at 001 independently.
const MMR_SUB_PREFIX = {
  PRESSURE_GAUGES:              'PG',
  VACUUM_GAUGES:                'VG',
  METROLOGY_INSTRUMENTS:        'MI',
  LAB_TESTING_EQUIPMENT:        'LTE',
  AUTOCLAVE_OVEN_THERMOCOUPLES: 'AOT',
  EOT_CRANES_CHAIN_BLOCKS:      'EOT',
  WEIGHING_BALANCES:            'WB',
  NDT:                          'NDT',
  OTHER:                        'OTH',
};

// Build the next RAPSPL serial for a given MMR bucket by scanning the
// existing rows. Returns e.g. "RAPSPL/PG/001".
const nextRapsplSerial = async (mmrSubCategory) => {
  const subPrefix = MMR_SUB_PREFIX[mmrSubCategory] || 'OTH';
  const prefix = `RAPSPL/${subPrefix}/`;
  const rows = await prisma.calibrationItem.findMany({
    where: { rapsplSerialNo: { startsWith: prefix } },
    select: { rapsplSerialNo: true },
  });
  let max = 0;
  for (const { rapsplSerialNo: serial } of rows) {
    if (!serial) continue;
    const tail = serial.slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
};

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sanitizeItem = (body, { partial = false } = {}) => {
  const data = {};
  const set = (k, transform = (x) => x) => {
    if (body[k] !== undefined) data[k] = body[k] === null || body[k] === '' ? null : transform(body[k]);
  };

  if (!partial || body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category)) throw new Error('Invalid category');
    data.category = body.category;
  }
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) throw new Error('Name is required');
    data.name = String(body.name).trim();
  }

  if (body.mmrSubCategory !== undefined) {
    if (body.mmrSubCategory === null || body.mmrSubCategory === '') {
      data.mmrSubCategory = null;
    } else if (!VALID_MMR_SUBS.includes(body.mmrSubCategory)) {
      throw new Error('Invalid MMR sub-category');
    } else {
      data.mmrSubCategory = body.mmrSubCategory;
    }
  }

  ['mirNo', 'make', 'model', 'serialNo', 'rapsplSerialNo', 'operatingRange',
   'capacityMin', 'capacityMax', 'leastCount', 'unitLocation',
   'usedFor', 'calibrationCertificate', 'notes', 'remarks'].forEach((k) => set(k, (v) => String(v).trim()));

  ['mirDate', 'calibrationOn', 'calibrationDueDate', 'recallDueDate'].forEach((k) => set(k, parseDate));

  if (body.periodicity !== undefined) {
    data.periodicity = body.periodicity ? String(body.periodicity).trim() : 'Every One Year';
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;

  return data;
};

const sanitizeRecord = (body, { partial = false } = {}) => {
  const data = {};
  if (!partial || body.fiscalYear !== undefined) {
    const fy = body.fiscalYear ? String(body.fiscalYear).trim() : '';
    if (!fy) throw new Error('Fiscal year is required');
    data.fiscalYear = fy;
  }
  ['qcVerifiedBy', 'certificateNo', 'certificateAttachment'].forEach((k) => {
    if (body[k] !== undefined) {
      data[k] = body[k] === null || body[k] === '' ? null : String(body[k]).trim();
    }
  });
  ['verifiedOn', 'calibratedOn', 'dueDate', 'recallDate'].forEach((k) => {
    if (body[k] !== undefined) data[k] = parseDate(body[k]);
  });
  return data;
};

// ─────────────────────────────────────────────
// GET /api/calibration — list, optional ?category=&mmrSubCategory=&search=&unit=
// ─────────────────────────────────────────────
router.get('/', authenticate, requireRead, async (req, res) => {
  try {
    const { category, mmrSubCategory, search, unit } = req.query;
    const where = {};
    if (category && VALID_CATEGORIES.includes(category)) where.category = category;
    if (mmrSubCategory && VALID_MMR_SUBS.includes(mmrSubCategory)) where.mmrSubCategory = mmrSubCategory;
    if (unit) where.unitLocation = unit;
    if (search) {
      const q = String(search).trim();
      if (q) {
        where.OR = [
          { name:           { contains: q, mode: 'insensitive' } },
          { make:           { contains: q, mode: 'insensitive' } },
          { model:          { contains: q, mode: 'insensitive' } },
          { serialNo:       { contains: q, mode: 'insensitive' } },
          { rapsplSerialNo: { contains: q, mode: 'insensitive' } },
          { usedFor:        { contains: q, mode: 'insensitive' } },
          { mirNo:          { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const items = await prisma.calibrationItem.findMany({
      where,
      orderBy: [{ unitLocation: 'asc' }, { createdAt: 'asc' }],
      include: { records: { orderBy: { fiscalYear: 'asc' } } },
    });
    res.json({ items, canEdit: canWrite(req.user) });
  } catch (error) {
    console.error('List calibration items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/calibration/:id
router.get('/:id', authenticate, requireRead, async (req, res) => {
  try {
    const item = await prisma.calibrationItem.findUnique({
      where: { id: req.params.id },
      include: { records: { orderBy: { fiscalYear: 'asc' } } },
    });
    if (!item) return res.status(404).json({ error: 'Calibration item not found' });
    res.json(item);
  } catch (error) {
    console.error('Get calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/calibration — write-gated by role+unit
router.post('/', authenticate, requireRead, requireWrite, async (req, res) => {
  try {
    const data = sanitizeItem(req.body, { partial: false });
    const records = Array.isArray(req.body.records)
      ? req.body.records.map((r) => sanitizeRecord(r, { partial: false }))
      : [];

    // Auto-mint the RAPSPL serial when the user leaves it blank on MMR rows.
    // Format: RAPSPL/<sub-prefix>/<NNN>, counter scoped to the sub-category so
    // each bucket increments independently.
    if (data.category === 'MMR' && !data.rapsplSerialNo) {
      data.rapsplSerialNo = await nextRapsplSerial(data.mmrSubCategory);
    }

    const item = await prisma.calibrationItem.create({
      data: { ...data, records: records.length ? { create: records } : undefined },
      include: { records: true },
    });
    res.status(201).json(item);
  } catch (error) {
    if (['Invalid category', 'Name is required', 'Invalid MMR sub-category', 'Fiscal year is required'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/calibration/:id — write-gated
router.put('/:id', authenticate, requireRead, requireWrite, async (req, res) => {
  try {
    const existing = await prisma.calibrationItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Calibration item not found' });

    const data = sanitizeItem(req.body, { partial: true });

    // If the row is on the MMR register and the user clears the serial (or
    // the sub-category changes and the serial isn't set), mint a fresh one
    // in the new bucket.
    const effectiveCategory     = data.category        ?? existing.category;
    const effectiveSubCategory  = data.mmrSubCategory  ?? existing.mmrSubCategory;
    const serialAfter = 'rapsplSerialNo' in data ? data.rapsplSerialNo : existing.rapsplSerialNo;
    if (effectiveCategory === 'MMR' && !serialAfter) {
      data.rapsplSerialNo = await nextRapsplSerial(effectiveSubCategory);
    }

    const item = await prisma.calibrationItem.update({
      where: { id: req.params.id },
      data,
      include: { records: { orderBy: { fiscalYear: 'asc' } } },
    });
    res.json(item);
  } catch (error) {
    if (['Invalid category', 'Name is required', 'Invalid MMR sub-category'].includes(error.message)) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/calibration/:id/remarks — any viewer can edit the remarks cell
router.patch('/:id/remarks', authenticate, requireRead, async (req, res) => {
  try {
    const remarks = req.body.remarks == null || req.body.remarks === ''
      ? null
      : String(req.body.remarks);
    const item = await prisma.calibrationItem.update({
      where: { id: req.params.id },
      data: { remarks },
      include: { records: { orderBy: { fiscalYear: 'asc' } } },
    });
    res.json(item);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Calibration item not found' });
    console.error('Update calibration remarks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/calibration/:id — write-gated
router.delete('/:id', authenticate, requireRead, requireWrite, async (req, res) => {
  try {
    await prisma.calibrationItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Calibration item not found' });
    console.error('Delete calibration item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────
// Per-FY records (upsert/delete/cert upload)
// ─────────────────────────────────────────────

// PUT /api/calibration/:id/records/:fiscalYear — upsert FY record
router.put('/:id/records/:fiscalYear', authenticate, requireRead, requireWrite, async (req, res) => {
  try {
    const fyParam = decodeURIComponent(req.params.fiscalYear).trim();
    const data = sanitizeRecord({ ...req.body, fiscalYear: fyParam }, { partial: false });
    const record = await prisma.calibrationRecord.upsert({
      where: { itemId_fiscalYear: { itemId: req.params.id, fiscalYear: data.fiscalYear } },
      create: { ...data, itemId: req.params.id },
      update: { ...data },
    });
    res.json(record);
  } catch (error) {
    if (error.message === 'Fiscal year is required') return res.status(400).json({ error: error.message });
    console.error('Upsert calibration record error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/calibration/:id/records/:fiscalYear
router.delete('/:id/records/:fiscalYear', authenticate, requireRead, requireWrite, async (req, res) => {
  try {
    const fy = decodeURIComponent(req.params.fiscalYear).trim();
    await prisma.calibrationRecord.delete({
      where: { itemId_fiscalYear: { itemId: req.params.id, fiscalYear: fy } },
    });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    console.error('Delete calibration record error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/calibration/:id/records/:fiscalYear/certificate — upload PDF
router.post(
  '/:id/records/:fiscalYear/certificate',
  authenticate,
  requireRead,
  requireWrite,
  calibrationCertUpload.single('certificate'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Certificate PDF is required' });
      const fy = decodeURIComponent(req.params.fiscalYear).trim();
      const url = publicUrlFor('calibration-certs', req.file.filename);
      const record = await prisma.calibrationRecord.upsert({
        where: { itemId_fiscalYear: { itemId: req.params.id, fiscalYear: fy } },
        create: { itemId: req.params.id, fiscalYear: fy, certificateAttachment: url },
        update: { certificateAttachment: url },
      });
      res.json(record);
    } catch (error) {
      console.error('Upload calibration cert error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
