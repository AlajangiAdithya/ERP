const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const {
  paginate, normalizeMaterialType, MATERIAL_TYPES,
} = require('../utils/helpers');

const router = express.Router();

// Walks every batch of the given products and tacks on:
//   - mirCount:       distinct PurchaseOrder.mirNo values (one per material-inward event)
//   - earliestExpiry: soonest dateOfExpiry across batches that still have stock
// The included `batches: take 5` array on the product is recent-first and doesn't
// guarantee either of these, so we do one extra grouped query per list page.
async function annotateMirAndExpiry(products) {
  if (!products.length) return;
  const ids = products.map((p) => p.id);
  const rows = await prisma.productBatch.findMany({
    // Direct entries carry their own dateOfExpiry (no inspection) — include them.
    where: {
      productId: { in: ids },
      OR: [{ sourceQcInspectionId: { not: null } }, { dateOfExpiry: { not: null } }],
    },
    select: {
      productId: true,
      remaining: true,
      dateOfExpiry: true,
      sourceQcInspection: {
        select: {
          dateOfExpiry: true,
          purchaseOrder: { select: { mirNo: true } },
        },
      },
    },
  });
  const perProduct = new Map();
  for (const r of rows) {
    let agg = perProduct.get(r.productId);
    if (!agg) { agg = { mirs: new Set(), earliestExpiry: null }; perProduct.set(r.productId, agg); }
    const mir = r.sourceQcInspection?.purchaseOrder?.mirNo;
    if (mir) agg.mirs.add(mir);
    const exp = r.sourceQcInspection?.dateOfExpiry || r.dateOfExpiry;
    if (exp && (r.remaining ?? 0) > 0) {
      if (!agg.earliestExpiry || new Date(exp) < new Date(agg.earliestExpiry)) {
        agg.earliestExpiry = exp;
      }
    }
  }
  for (const p of products) {
    const agg = perProduct.get(p.id);
    p.mirCount = agg ? agg.mirs.size : 0;
    p.earliestExpiry = agg ? agg.earliestExpiry : null;
  }
}

// Attaches `deptStocks: [{ dept, quantity }]` to each product — the in-stock total
// held on behalf of each non-unit department (QC, Designs, Safety, Lab, …). This is
// the department counterpart to unitStocks (per-unit ownership): PRs raised by a
// non-unit role have their inward batches stamped with ProductBatch.assignedDept,
// so we sum the remaining qty per department here. Non-FIM only — FIM is its own tab.
async function annotateDeptStocks(products) {
  if (!products.length) {
    return;
  }
  const ids = products.map((p) => p.id);
  const grouped = await prisma.productBatch.groupBy({
    by: ['productId', 'assignedDept'],
    where: {
      productId: { in: ids },
      assignedDept: { not: null },
      isFim: false,
      remaining: { gt: 0 },
    },
    _sum: { remaining: true },
  });
  const perProduct = new Map();
  for (const g of grouped) {
    const qty = g._sum.remaining || 0;
    if (qty <= 0) continue;
    const list = perProduct.get(g.productId) || [];
    list.push({ dept: g.assignedDept, quantity: qty });
    perProduct.set(g.productId, list);
  }
  for (const p of products) {
    p.deptStocks = perProduct.get(p.id) || [];
  }
}

const productSchema = z.object({
  name: z.string().min(1),
  // Identification number from the Material Details register — also stored as SKU.
  materialCode: z.string().trim().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  minStockLevel: z.number().min(0).optional(),
});

// GET /api/products
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, page, limit, includeUnitStock, includeMir, sort } = req.query;

    // Sort presets — default to alphabetical by name, which is what Stores asked for.
    const sortPresets = {
      name: [{ name: 'asc' }],
      category: [{ category: 'asc' }, { name: 'asc' }],
      id: [{ materialCode: 'asc' }, { sku: 'asc' }],
    };
    const orderBy = sortPresets[sort] || sortPresets.name;

    // RAPS products list excludes FIM-only items — those belong on the FIM Status tab.
    // A product is "FIM-only" when every batch it has is isFim=true. Products with no
    // batches yet (newly created, never inwarded) stay visible so Stores can manage them.
    const where = {
      isActive: true,
      AND: [
        {
          OR: [
            { batches: { none: {} } },
            { batches: { some: { isFim: false } } },
          ],
        },
      ],
    };
    if (search) {
      where.AND.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { materialCode: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (category) where.category = category;

    const wantUnitStock = includeUnitStock === 'true' || includeUnitStock === '1';
    const wantMir = includeMir === 'true' || includeMir === '1';

    // Listing the MIRs each product has come in under requires walking the
    // ProductBatch → QCInspection → PurchaseOrder.mirNo chain. We surface
    // the most recent few so the products table stays light. dateOfExpiry
    // on the inspection feeds the "Expiry Date" column.
    const batchInclude = wantMir
      ? {
          batches: {
            where: { sourceQcInspectionId: { not: null } },
            orderBy: { receivedDate: 'desc' },
            take: 5,
            select: {
              id: true, batchNo: true, receivedDate: true, quantity: true, remaining: true,
              sourceQcInspection: {
                select: {
                  id: true, inspectionNumber: true, dateOfExpiry: true,
                  purchaseOrder: { select: { id: true, orderNumber: true, mirNo: true, inwardedAt: true } },
                },
              },
            },
          },
        }
      : null;

    const include = {
      ...(wantUnitStock ? { unitStocks: { include: { unit: { select: { id: true, name: true, code: true } } } } } : {}),
      ...(batchInclude || {}),
    };

    // Support limit=all to bypass pagination (for product selection dropdowns)
    if (limit === 'all') {
      const products = await prisma.product.findMany({
        where,
        orderBy,
        include: Object.keys(include).length ? include : undefined,
      });
      if (wantMir) await annotateMirAndExpiry(products);
      if (wantUnitStock) await annotateDeptStocks(products);
      return res.json({ products, total: products.length, page: 1, totalPages: 1 });
    }

    const { skip, take } = paginate(page, limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take,
        include: Object.keys(include).length ? include : undefined,
      }),
      prisma.product.count({ where }),
    ]);

    if (wantMir) await annotateMirAndExpiry(products);
    if (wantUnitStock) await annotateDeptStocks(products);

    res.json({ products, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/material-types — fixed dropdown values for PR/inward forms
router.get('/material-types', authenticate, (_req, res) => {
  res.json(MATERIAL_TYPES);
});

// GET /api/products/fim-status
// Lists every FIM batch (customer-owned material inwarded via INWARD gate pass)
// with its source GP, return date, unit assignment and unit-acceptance state.
// Used to power the "FIM Status" tab on the Products page.
router.get('/fim-status', authenticate, async (req, res) => {
  try {
    const { unitId, search } = req.query;
    const where = { isFim: true };
    if (unitId) where.assignedToUnitId = unitId;
    if (search) {
      where.OR = [
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { sourceInwardGatePass: { customerName: { contains: search, mode: 'insensitive' } } },
        { sourceInwardGatePass: { passNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const batches = await prisma.productBatch.findMany({
      where,
      orderBy: { receivedDate: 'desc' },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true, category: true } },
        assignedToUnit: { select: { id: true, name: true, code: true } },
        assignedBy: { select: { id: true, name: true } },
        unitAcceptedBy: { select: { id: true, name: true } },
        readyToSendOutBy: { select: { id: true, name: true } },
        sourceInwardGatePass: {
          select: {
            id: true, passNumber: true, fimNumber: true, gpRequisitionNo: true,
            customerName: true, customerGatePassNo: true, customerGatePassDate: true,
            customerGpDocType: true, customerGpPdfUrl: true, date: true,
            vehicleNo: true, driverName: true,
          },
        },
        sourceInwardGatePassItem: {
          select: {
            id: true, description: true, probableReturnDate: true, itemPassType: true,
            itemPurpose: true, dispatchedTo: true, remarks: true,
            outwardLinkedItems: {
              select: {
                id: true,
                gatePass: { select: { id: true, passNumber: true, status: true, date: true, vehicleNo: true, driverName: true, actualReturnDate: true } },
              },
              orderBy: { id: 'desc' },
            },
          },
        },
      },
    });
    res.json(batches);
  } catch (error) {
    console.error('FIM status list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/categories
router.get('/categories', authenticate, async (req, res) => {
  try {
    const categories = await prisma.product.findMany({
      where: { isActive: true, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    });
    res.json(categories.map(c => c.category).filter(Boolean));
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/low-stock
router.get('/low-stock', authenticate, async (req, res) => {
  try {
    const products = await prisma.$queryRaw`
      SELECT id, name, sku, "currentStock", "minStockLevel", category, unit
      FROM "Product"
      WHERE "isActive" = true AND "currentStock" <= "minStockLevel" AND "minStockLevel" > 0
      ORDER BY ("currentStock" / NULLIF("minStockLevel", 0)) ASC
    `;
    res.json(products);
  } catch (error) {
    console.error('Get low stock error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/:id/supplier-history
// Returns purchase history + quoted-but-not-bought history for the product, plus a summary.
// Matches by productId first, falls back to product-name (case-insensitive, trimmed).
router.get('/:id/supplier-history', authenticate, async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, unit: true },
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const nameMatch = { equals: product.name, mode: 'insensitive' };

    // ── Purchased: from PurchaseOrderItem (every PO this product appears on) ──
    const purchasedItems = await prisma.purchaseOrderItem.findMany({
      where: {
        OR: [
          { productId: product.id },
          { productName: nameMatch },
        ],
      },
      include: {
        purchaseOrder: {
          select: {
            id: true, orderNumber: true, status: true, createdAt: true,
            supplierName: true, supplierId: true,
            supplier: { select: { id: true, name: true, contact: true, address: true } },
          },
        },
        supplier: { select: { id: true, name: true, contact: true, address: true } },
      },
      orderBy: { purchaseOrder: { createdAt: 'desc' } },
    });

    const purchasedPo = purchasedItems.map(it => ({
      id: it.id,
      poId: it.purchaseOrder.id,
      poNumber: it.purchaseOrder.orderNumber,
      poStatus: it.purchaseOrder.status,
      date: it.purchaseOrder.createdAt,
      supplierId: it.supplier?.id || it.purchaseOrder.supplier?.id || it.purchaseOrder.supplierId || null,
      supplierName: it.supplier?.name || it.purchaseOrder.supplier?.name || it.purchaseOrder.supplierName,
      supplierContact: it.supplier?.contact || it.purchaseOrder.supplier?.contact || null,
      supplierAddress: it.supplier?.address || it.purchaseOrder.supplier?.address || null,
      productName: it.productName,
      productUnit: it.productUnit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
      receivedQty: it.receivedQty,
      itemStatus: it.itemStatus,
    }));

    // ── Direct / cash purchases: inward batches recorded by Stores with
    // supplier details filled in (Inward Entry → Direct Entry) ──
    const directBatches = await prisma.productBatch.findMany({
      where: { productId: product.id, supplierName: { not: null } },
      orderBy: { receivedDate: 'desc' },
    });

    const direct = directBatches.map(b => ({
      id: b.id,
      direct: true,
      poId: null,
      poNumber: 'Direct / Cash',
      poStatus: null,
      date: b.receivedDate,
      supplierId: null,
      supplierName: b.supplierName,
      supplierContact: b.supplierContact,
      supplierAddress: b.supplierAddress,
      productName: product.name,
      productUnit: product.unit,
      quantity: b.quantity,
      unitPrice: b.unitCost,
      totalPrice: b.unitCost != null ? b.unitCost * b.quantity : null,
      receivedQty: b.quantity,
      itemStatus: 'DIRECT',
      assignedDept: b.assignedDept,
      batchNo: b.batchNo,
    }));

    const purchased = [...purchasedPo, ...direct]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // ── Quoted but not bought: QuotationItem where the parent quotation was NOT selected ──
    const quotedItems = await prisma.quotationItem.findMany({
      where: {
        OR: [
          { productId: product.id },
          { productName: nameMatch },
        ],
        quotation: { isSelected: false },
      },
      include: {
        quotation: {
          select: {
            id: true, quotationNumber: true, isSelected: true, createdAt: true,
            purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
          },
        },
        supplier: { select: { id: true, name: true, contact: true, address: true } },
      },
      orderBy: { quotation: { createdAt: 'desc' } },
    });

    const quoted = quotedItems.map(it => ({
      id: it.id,
      quotationId: it.quotation.id,
      quotationNumber: it.quotation.quotationNumber,
      date: it.quotation.createdAt,
      purchaseRequestNumber: it.quotation.purchaseRequest?.requestNumber || null,
      purchaseRequestStatus: it.quotation.purchaseRequest?.status || null,
      supplierId: it.supplier?.id || it.supplierId || null,
      supplierName: it.supplier?.name || it.supplierName,
      supplierContact: it.supplier?.contact || it.supplierContact || null,
      supplierAddress: it.supplier?.address || it.supplierAddress || null,
      productName: it.productName,
      productUnit: it.productUnit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
    }));

    // ── Summary ──
    const uniqueSupplierIds = new Set([
      ...purchased.map(p => p.supplierId).filter(Boolean),
      ...quoted.map(q => q.supplierId).filter(Boolean),
    ]);
    const uniqueSupplierNames = new Set([
      ...purchased.map(p => (p.supplierName || '').toLowerCase().trim()),
      ...quoted.map(q => (q.supplierName || '').toLowerCase().trim()),
    ].filter(Boolean));

    const lastBought = purchased[0] || null;
    // Direct entries may have no price — exclude them from the cheapest calc.
    const priced = purchased.filter(p => p.unitPrice != null);
    const cheapest = priced.length
      ? [...priced].sort((a, b) => a.unitPrice - b.unitPrice)[0]
      : null;

    res.json({
      product,
      purchased,
      quoted,
      summary: {
        totalSuppliers: Math.max(uniqueSupplierIds.size, uniqueSupplierNames.size),
        purchasedCount: purchased.length,
        quotedCount: quoted.length,
        lastBoughtFrom: lastBought ? {
          supplierName: lastBought.supplierName,
          date: lastBought.date,
          unitPrice: lastBought.unitPrice,
          poNumber: lastBought.poNumber,
        } : null,
        cheapestEver: cheapest ? {
          supplierName: cheapest.supplierName,
          date: cheapest.date,
          unitPrice: cheapest.unitPrice,
          poNumber: cheapest.poNumber,
        } : null,
      },
    });
  } catch (error) {
    console.error('Supplier history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        stockMovements: { orderBy: { createdAt: 'desc' }, take: 50 },
        unitStocks: { include: { unit: { select: { id: true, name: true, code: true } } } },
      },
    });

    if (!product) return res.status(404).json({ error: 'Product not found' });

    // FIM batches (customer property) for this product + their source inward GP + outward DC return links
    const fimBatches = await prisma.productBatch.findMany({
      where: { productId: req.params.id, isFim: true },
      orderBy: { receivedDate: 'desc' },
      include: {
        assignedToUnit: { select: { id: true, name: true, code: true } },
        assignedBy: { select: { id: true, name: true } },
        unitAcceptedBy: { select: { id: true, name: true } },
        sourceInwardGatePass: {
          select: {
            id: true, passNumber: true, fimNumber: true, gpRequisitionNo: true,
            customerName: true, customerGatePassNo: true, customerGatePassDate: true,
            customerContact: true, customerGpDocType: true, customerGpPdfUrl: true,
            vehicleNo: true, driverName: true,
            date: true, passType: true,
          },
        },
        sourceInwardGatePassItem: {
          select: {
            id: true, description: true, quantity: true, unit: true,
            probableReturnDate: true, itemPassType: true,
            outwardLinkedItems: {
              select: {
                id: true, description: true, quantity: true, unit: true,
                gatePass: { select: { id: true, passNumber: true, date: true, partyName: true } },
              },
            },
          },
        },
      },
    });

    // PO-flow batches with full chain: PR → PO → Lot N (invoice) → Batch.
    // Surfaces every inward against this product so anyone can trace where the
    // stock came from, which lot, which invoice, and when it arrived.
    const poBatches = await prisma.productBatch.findMany({
      where: { productId: req.params.id, isFim: false },
      orderBy: { receivedDate: 'desc' },
      include: {
        sourceQcInspection: {
          select: {
            id: true, inspectionNumber: true, lotNumber: true, arrivedQty: true,
            batchNo: true,
            invoiceNo: true, invoiceDate: true, invoiceFileUrl: true, lotReportFileUrl: true,
            materialReceiptDate: true, result: true,
            dcNo: true, gatePassNo: true, gatePassType: true,
            // Inspection request (IIR) metadata — who raised it, when
            requestCreatedBy: { select: { id: true, name: true } },
            createdAt: true,
            // Inspection report metadata — who QC'd, when, accept/reject totals
            inspectedBy: { select: { id: true, name: true } },
            inspectedAt: true,
            reportNo: true, reportDate: true,
            qtyOrdered: true, qtyReceived: true, qtyAccepted: true, qtyRejected: true,
            rejectionReason: true, remarks: true,
            inspectionLocation: true,
            materialCategory: true, documentTypes: true,
            packingCondition: true, packingDamageNotes: true,
            dateOfManufacturing: true, dateOfExpiry: true,
            items: {
              include: {
                purchaseOrderItem: {
                  select: { id: true, productName: true, productUnit: true }
                }
              }
            },
            purchaseOrder: {
              select: {
                id: true, orderNumber: true, customName: true, supplierName: true,
                mirNo: true,
                purchaseRequest: {
                  select: {
                    id: true, requestNumber: true,
                    manager: { select: { id: true, name: true } },
                    unit: { select: { id: true, name: true, code: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    // MIR level for this product = distinct MIR numbers across every PO-flow batch
    // (i.e. one increment per material-inward event). Sourced from the same chain
    // surfaced on the page; computing here keeps the UI honest for >5 batches.
    const mirSet = new Set();
    for (const b of poBatches) {
      const mir = b.sourceQcInspection?.purchaseOrder?.mirNo;
      if (mir) mirSet.add(mir);
    }
    const mirCount = mirSet.size;

    // Earliest expiry across batches with remaining stock — drives the warning badge.
    // Direct entries carry their own dateOfExpiry (no inspection).
    let earliestExpiry = null;
    for (const b of poBatches) {
      const exp = b.sourceQcInspection?.dateOfExpiry || b.dateOfExpiry;
      if (exp && (b.remaining ?? 0) > 0) {
        if (!earliestExpiry || new Date(exp) < new Date(earliestExpiry)) earliestExpiry = exp;
      }
    }

    res.json({ ...product, fimBatches, poBatches, mirCount, earliestExpiry });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/material-types — fixed dropdown values for PR/inward forms.
// MUST be declared before any `/:id`-style route — declared at top of file for safety.

// POST /api/products — sku is just the materialCode (identification number)
router.post('/', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('CREATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.parse(req.body);
    const category = normalizeMaterialType(data.category);
    const product = await prisma.product.create({
      data: { ...data, sku: data.materialCode, category },
    });
    res.status(201).json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Identification number already in use' });
    }
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// PUT /api/products/:id
router.put('/:id', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('UPDATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.partial().parse(req.body);
    // Keep sku mirrored to materialCode when the identification number changes.
    if (data.materialCode) data.sku = data.materialCode;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
    });
    res.json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Identification number already in use' });
    }
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id (soft delete)
router.delete('/:id', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('DELETE', 'Product'), async (req, res) => {
  try {
    await prisma.product.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Product deactivated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
