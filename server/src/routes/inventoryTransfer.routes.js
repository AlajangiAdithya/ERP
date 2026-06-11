const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  generateSequentialNumber, paginate, applyDateFilter,
  deptForRole, DEPT_BY_ROLE, OWNER_DEPTS,
} = require('../utils/helpers');

const router = express.Router();

// An "owner" of stock is EITHER a unit OR a department. Transfers move a reserved
// quantity from one owner's ledger (ProductUnitStock / ProductDeptStock) to
// another. The destination owner raises the request; the source owner (or an
// admin) approves the release.
const OWNER_DEPT_ROLES = Object.keys(DEPT_BY_ROLE); // QC, DESIGNS, SAFETY, LAB, METROLOGY, NDT, PLANNING
// Roles that may touch transfers at all (route guard). Monitors (LOGISTICS) get
// read-only oversight; ownership is enforced per-action below.
const TRANSFER_ROLES = ['MANAGER', 'ADMIN', 'LOGISTICS', ...OWNER_DEPT_ROLES];
// Monitors see every transfer (read-only oversight), like the old unit behaviour.
const MONITOR_ROLES = ['ADMIN', 'SAFETY', 'LOGISTICS'];

const TRANSFER_INCLUDE = {
  fromUnit: { select: { id: true, name: true, code: true } },
  toUnit: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
};

// ─── Owner-side helpers ───────────────────────────────────────────────
// A "side" is { unitId, dept } where exactly one is set. We carry the loaded
// unit relation along for labelling.
const fromSide = (t) => ({ unitId: t.fromUnitId || null, dept: t.fromDept || null, unit: t.fromUnit || null });
const toSide = (t) => ({ unitId: t.toUnitId || null, dept: t.toDept || null, unit: t.toUnit || null });
const sameSide = (a, b) => (!!a.unitId && a.unitId === b.unitId) || (!!a.dept && a.dept === b.dept);
const sideLabel = (s) => (s.unitId ? (s.unit?.name || s.unit?.code || 'Unit') : (s.dept ? `${s.dept} (dept)` : 'Unknown'));
const sideCode = (s) => (s.unitId ? (s.unit?.code || s.unitId) : (s.dept || ''));

// Does this user own/represent the given side? Admin always; a unit side → the
// MANAGER of that unit; a dept side → a user whose role maps to that department.
function userOwnsSide(user, side) {
  if (user.role === 'ADMIN') return true;
  if (side.unitId) return user.role === 'MANAGER' && user.unitId === side.unitId;
  if (side.dept) return deptForRole(user.role) === side.dept;
  return false;
}

// The owner side the current user represents (for scoping/creation), or null.
function userOwnSide(user) {
  if (user.role === 'MANAGER' && user.unitId) return { unitId: user.unitId, dept: null };
  const dept = deptForRole(user.role);
  if (dept) return { unitId: null, dept };
  return null;
}

const readOwnerStock = (tx, productId, side) =>
  side.unitId
    ? tx.productUnitStock.findUnique({ where: { productId_unitId: { productId, unitId: side.unitId } } })
    : tx.productDeptStock.findUnique({ where: { productId_dept: { productId, dept: side.dept } } });

const decrementOwner = (tx, productId, side, qty) =>
  side.unitId
    ? tx.productUnitStock.update({ where: { productId_unitId: { productId, unitId: side.unitId } }, data: { quantity: { decrement: qty } } })
    : tx.productDeptStock.update({ where: { productId_dept: { productId, dept: side.dept } }, data: { quantity: { decrement: qty } } });

const incrementOwner = (tx, productId, side, qty) =>
  side.unitId
    ? tx.productUnitStock.upsert({ where: { productId_unitId: { productId, unitId: side.unitId } }, update: { quantity: { increment: qty } }, create: { productId, unitId: side.unitId, quantity: qty } })
    : tx.productDeptStock.upsert({ where: { productId_dept: { productId, dept: side.dept } }, update: { quantity: { increment: qty } }, create: { productId, dept: side.dept, quantity: qty } });

// Active users who represent a side (notification / approval targets).
async function ownerUserIds(side) {
  if (side.unitId) {
    return prisma.user.findMany({ where: { role: 'MANAGER', unitId: side.unitId, isActive: true }, select: { id: true } });
  }
  const roles = OWNER_DEPT_ROLES.filter((r) => DEPT_BY_ROLE[r] === side.dept);
  return prisma.user.findMany({ where: { role: { in: roles }, isActive: true }, select: { id: true } });
}

// ─── Validation ───────────────────────────────────────────────────────
const ownerInput = {
  fromUnitId: z.string().uuid().optional().nullable(),
  fromDept: z.string().optional().nullable(),
  toUnitId: z.string().uuid().optional().nullable(),
  toDept: z.string().optional().nullable(),
};
const createSchema = z.object({
  ...ownerInput,
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

// Resolve a validated side from raw input, or an error string.
function resolveSide(unitId, dept) {
  const hasUnit = !!unitId;
  const hasDept = !!dept;
  if (hasUnit === hasDept) return { error: 'Each side must be exactly one of a unit or a department' };
  if (hasDept && !OWNER_DEPTS.includes(dept)) return { error: `Unknown department "${dept}"` };
  return { side: { unitId: unitId || null, dept: dept || null } };
}

// ─── Routes ─────────────────────────────────────────────────────────────

// GET /api/inventory-transfers — list (monitors see all; owners see their own in/out)
router.get('/', authenticate, authorize(...TRANSFER_ROLES), async (req, res) => {
  try {
    const { status, direction, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'TRANSFERRED'].includes(status)) {
      where.status = status;
    }

    const isMonitor = MONITOR_ROLES.includes(req.user.role);
    if (!isMonitor) {
      const mine = userOwnSide(req.user);
      if (!mine) return res.json({ transfers: [], total: 0, page: 1, totalPages: 0 });
      const incoming = mine.unitId ? { toUnitId: mine.unitId } : { toDept: mine.dept };
      const outgoing = mine.unitId ? { fromUnitId: mine.unitId } : { fromDept: mine.dept };
      if (direction === 'incoming') Object.assign(where, incoming);
      else if (direction === 'outgoing') Object.assign(where, outgoing);
      else where.OR = [incoming, outgoing];
    }

    const [transfers, total] = await Promise.all([
      prisma.inventoryTransferRequest.findMany({
        where,
        include: TRANSFER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.inventoryTransferRequest.count({ where }),
    ]);

    res.json({ transfers, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('List transfers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory-transfers/:id
router.get('/:id', authenticate, authorize(...TRANSFER_ROLES), async (req, res) => {
  try {
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });

    const isMonitor = MONITOR_ROLES.includes(req.user.role);
    if (!isMonitor && !userOwnsSide(req.user, fromSide(t)) && !userOwnsSide(req.user, toSide(t))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(t);
  } catch (error) {
    console.error('Get transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory-transfers — the DESTINATION owner requests the stock.
router.post('/', authenticate, authorize('MANAGER', ...OWNER_DEPT_ROLES), async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    const src = resolveSide(data.fromUnitId, data.fromDept);
    const dst = resolveSide(data.toUnitId, data.toDept);
    if (src.error) return res.status(400).json({ error: src.error });
    if (dst.error) return res.status(400).json({ error: dst.error });
    if (sameSide(src.side, dst.side)) {
      return res.status(400).json({ error: 'Source and destination must be different' });
    }

    // You may only request stock INTO your own unit/department.
    if (!userOwnsSide(req.user, dst.side)) {
      return res.status(403).json({ error: 'You can only request transfers into your own unit or department' });
    }

    // Validate references exist.
    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) return res.status(400).json({ error: 'Invalid product reference' });
    for (const side of [src.side, dst.side]) {
      if (side.unitId) {
        const u = await prisma.unit.findUnique({ where: { id: side.unitId }, select: { id: true } });
        if (!u) return res.status(400).json({ error: 'Invalid unit reference' });
      }
    }

    const transferNumber = await generateSequentialNumber(prisma, 'TRF');
    const created = await prisma.inventoryTransferRequest.create({
      data: {
        transferNumber,
        fromUnitId: src.side.unitId,
        fromDept: src.side.dept,
        toUnitId: dst.side.unitId,
        toDept: dst.side.dept,
        productId: data.productId,
        quantity: data.quantity,
        reason: data.reason || null,
        notes: data.notes || null,
        requestedById: req.user.id,
      },
      include: TRANSFER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'InventoryTransferRequest',
        entityId: created.id,
        details: {
          transferNumber,
          from: sideCode(fromSide(created)),
          to: sideCode(toSide(created)),
          product: product.name,
          quantity: data.quantity,
        },
        ipAddress: req.ip,
      },
    });

    // Notify the source owner(s) that a release has been requested.
    const sourceOwners = await ownerUserIds(src.side);
    if (sourceOwners.length) {
      await prisma.notification.createMany({
        data: sourceOwners.map((m) => ({
          type: 'TRANSFER_REQUEST',
          title: `Transfer Request: ${transferNumber}`,
          message: `${sideLabel(toSide(created))} is requesting ${data.quantity} ${product.unit} of ${product.name} from ${sideLabel(fromSide(created))}.`,
          productId: product.id,
          targetUserId: m.id,
          sentById: req.user.id,
        })),
      });
    }

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory-transfers/:id/approve — the SOURCE owner (or admin) releases.
router.put('/:id/approve', authenticate, authorize('MANAGER', 'ADMIN', ...OWNER_DEPT_ROLES), async (req, res) => {
  try {
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });
    if (t.status !== 'PENDING') return res.status(400).json({ error: 'Only pending transfers can be approved' });

    const src = fromSide(t);
    const dst = toSide(t);
    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && !userOwnsSide(req.user, src)) {
      return res.status(403).json({ error: 'Only the source unit/department owner or an admin can approve a transfer' });
    }

    await prisma.$transaction(async (tx) => {
      const stock = await readOwnerStock(tx, t.productId, src);
      if (!stock || stock.quantity < t.quantity - 0.001) {
        throw new Error(`${sideLabel(src)} no longer holds ${t.quantity} ${t.product.unit} of ${t.product.name}`);
      }
      await decrementOwner(tx, t.productId, src, t.quantity);
      await incrementOwner(tx, t.productId, dst, t.quantity);

      await tx.stockMovement.create({
        data: {
          productId: t.productId,
          type: 'OUT',
          quantity: t.quantity,
          referenceType: 'InventoryTransfer',
          referenceId: t.id,
          notes: `Transfer: ${sideCode(src)} → ${sideCode(dst)} (${t.transferNumber})`,
          performedBy: req.user.id,
          unitId: src.unitId,
        },
      });
      await tx.stockMovement.create({
        data: {
          productId: t.productId,
          type: 'IN',
          quantity: t.quantity,
          referenceType: 'InventoryTransfer',
          referenceId: t.id,
          notes: `Transfer received: ${sideCode(src)} → ${sideCode(dst)} (${t.transferNumber})`,
          performedBy: req.user.id,
          unitId: dst.unitId,
        },
      });

      await tx.inventoryTransferRequest.update({
        where: { id: t.id },
        data: {
          status: 'TRANSFERRED',
          approvedById: req.user.id,
          approvedAt: new Date(),
          completedAt: new Date(),
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'APPROVE',
        entity: 'InventoryTransferRequest',
        entityId: t.id,
        details: {
          transferNumber: t.transferNumber,
          from: sideCode(src),
          to: sideCode(dst),
          product: t.product.name,
          quantity: t.quantity,
          adminOverride: isAdmin && !userOwnsSide(req.user, src),
        },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'TRANSFER_APPROVED',
        title: `Transfer ${t.transferNumber} Approved`,
        message: `${sideLabel(src)} → ${sideLabel(dst)}: ${t.quantity} ${t.product.unit} of ${t.product.name} have been transferred.`,
        targetUserId: t.requestedById,
        sentById: req.user.id,
      },
    });

    const updated = await prisma.inventoryTransferRequest.findUnique({
      where: { id: t.id },
      include: TRANSFER_INCLUDE,
    });
    res.json(updated);
  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/inventory-transfers/:id/reject — source owner or admin
router.put('/:id/reject', authenticate, authorize('MANAGER', 'ADMIN', ...OWNER_DEPT_ROLES), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });
    if (t.status !== 'PENDING') return res.status(400).json({ error: 'Only pending transfers can be rejected' });

    const src = fromSide(t);
    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && !userOwnsSide(req.user, src)) {
      return res.status(403).json({ error: 'Only the source unit/department owner or an admin can reject a transfer' });
    }

    const updated = await prisma.inventoryTransferRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user.id,
        approvedAt: new Date(),
        rejectionReason: reason || null,
      },
      include: TRANSFER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REJECT',
        entity: 'InventoryTransferRequest',
        entityId: t.id,
        details: { transferNumber: t.transferNumber, reason: reason || null },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'TRANSFER_REJECTED',
        title: `Transfer ${t.transferNumber} Rejected`,
        message: `${sideLabel(fromSide(t))} rejected the transfer request. Reason: ${reason || 'Not specified'}`,
        targetUserId: t.requestedById,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Reject transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
