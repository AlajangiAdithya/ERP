const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const {
  authorizeProductMaster, authorizeProductCreate, isProductMasterRole,
  canEditProductMasterData, canEditProductDetails, PRODUCT_EDIT_FORBIDDEN,
} = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { msdsUpload, prSpecsUpload, publicUrlFor } = require('../middleware/upload');
const {
  paginate, normalizeMaterialType, MATERIAL_TYPES, MATERIAL_CATEGORIES,
  codeRangeFor, nextMaterialCode,
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

// Attaches `deptStocks: [{ dept, quantity }]` to each product — the stock reserved
// to each non-unit department (QC, Designs, Safety, Lab, Metrology, NDT, Planning).
// This is the department counterpart to unitStocks (per-unit ownership), read from
// the ProductDeptStock ledger — the single source of truth that MIV issue and
// inventory transfers both move against.
async function annotateDeptStocks(products) {
  if (!products.length) {
    return;
  }
  const ids = products.map((p) => p.id);
  const rows = await prisma.productDeptStock.findMany({
    where: { productId: { in: ids }, quantity: { gt: 0 } },
    select: { productId: true, dept: true, quantity: true },
  });
  const perProduct = new Map();
  for (const r of rows) {
    const list = perProduct.get(r.productId) || [];
    list.push({ dept: r.dept, quantity: r.quantity });
    perProduct.set(r.productId, list);
  }
  for (const p of products) {
    p.deptStocks = perProduct.get(p.id) || [];
  }
}

const productSchema = z.object({
  name: z.string().min(1),
  // Material code from the category register (utils/materialCategories.js) — the
  // number is issued inside the block reserved for the material's category. Also
  // stored as SKU.
  materialCode: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional(),
  unit: z.string().optional(),
  minStockLevel: z.number().min(0).optional(),
  // Storage handling — free text, editable from the products list.
  shelfLife: z.string().trim().optional().nullable(),
  storageTemp: z.string().trim().optional().nullable(),
});

// Human labels for the product-detail fields tracked in ProductEditHistory.
// Only these fields are diffed on save; stock figures (currentStock) and
// non-detail columns are never recorded here.
const PRODUCT_FIELD_LABELS = {
  materialCode: 'Material Code',
  name: 'Name',
  description: 'Specification / Description',
  category: 'Material Type',
  unit: 'UOM',
  shelfLife: 'Shelf Life',
  storageTemp: 'Storage Temperature',
  minStockLevel: 'Min Stock Level',
};

// GET /api/products
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, page, limit, includeUnitStock, includeMir, includeStockSummary, sort, masterData } = req.query;

    // Sort presets — default to alphabetical by name, which is what Stores asked for.
    // `recent` (newest first) drives the Master Data "needs master data" view so
    // freshly auto-created (PR-time) products surface at the top for enrichment.
    const sortPresets = {
      name: [{ name: 'asc' }],
      category: [{ category: 'asc' }, { name: 'asc' }],
      id: [{ materialCode: 'asc' }, { sku: 'asc' }],
      recent: [{ createdAt: 'desc' }],
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
    // Master Data screen filter: only products whose master data hasn't been
    // added/completed yet (the ones that block Stores inward until enriched).
    if (masterData === 'pending') where.masterDataComplete = false;

    const wantUnitStock = includeUnitStock === 'true' || includeUnitStock === '1';
    const wantMir = includeMir === 'true' || includeMir === '1';
    // Stock health counts (out-of-stock over the same filtered set) for dashboards.
    const wantStockSummary = includeStockSummary === 'true' || includeStockSummary === '1';

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
      // Always carried: the Master Data screen shows who entered each material,
      // and the client uses it to decide whether the edit controls are drawn.
      createdBy: { select: { id: true, name: true, role: true } },
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

    const [products, total, outOfStock] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip,
        take,
        include: Object.keys(include).length ? include : undefined,
      }),
      prisma.product.count({ where }),
      wantStockSummary
        ? prisma.product.count({ where: { ...where, currentStock: { lte: 0 } } })
        : Promise.resolve(null),
    ]);

    if (wantMir) await annotateMirAndExpiry(products);
    if (wantUnitStock) await annotateDeptStocks(products);

    const response = { products, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) };
    if (wantStockSummary) {
      response.stockSummary = { total, outOfStock, available: total - outOfStock };
    }
    res.json(response);
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/material-types — fixed dropdown values for PR/inward forms
router.get('/material-types', authenticate, (_req, res) => {
  res.json(MATERIAL_TYPES);
});

// GET /api/products/material-categories — the material-code register: each
// category with the block of codes reserved for it and what belongs in it. Drives
// the Material Type dropdowns AND the reference table shown on a requisition.
router.get('/material-categories', authenticate, (_req, res) => {
  res.json(MATERIAL_CATEGORIES);
});

// GET /api/products/next-material-code?category=<label>
// The next free material code for a category — codes are counted inside the block
// the register reserves for that category, so a new resin gets 1501…2000 and a
// new consumable 3001…3300. Deactivated products still hold their code (the
// column is unique), so every product is considered, active or not.
router.get('/next-material-code', authenticate, async (req, res) => {
  try {
    const category = normalizeMaterialType(req.query.category);
    const range = codeRangeFor(category);
    if (!range) {
      // 'Others' and the retired labels have no reserved block — the code is
      // typed by hand. Answer plainly rather than 400-ing; the form just doesn't
      // prefill.
      return res.json({ category, code: null, from: null, to: null, used: 0, capacity: 0, full: false });
    }
    // Both columns carry the identification number (sku mirrors materialCode),
    // and older rows have only one of the two — read both.
    const rows = await prisma.product.findMany({ select: { materialCode: true, sku: true } });
    const used = [];
    for (const r of rows) { used.push(r.materialCode, r.sku); }
    res.json({ category, ...nextMaterialCode(category, used) });
  } catch (error) {
    console.error('Next material code error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
            // Customer test reports covering the whole FIM entry. Per-line ones
            // come back on sourceInwardGatePassItem.testReports below.
            testReports: { where: { gatePassItemId: null }, orderBy: { createdAt: 'asc' } },
          },
        },
        sourceInwardGatePassItem: {
          select: {
            id: true, description: true, probableReturnDate: true, itemPassType: true,
            itemPurpose: true, dispatchedTo: true, remarks: true,
            testReports: { orderBy: { createdAt: 'asc' } },
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

// Per-product master-data gate for the document routes (spec PDFs, MSDS).
// Master owners, or the person who entered this material — the same rule as the
// detail edit, minus the Stores rollout window (Stores never owned the files).
// Runs BEFORE the uploader so a refused request never writes a file to disk.
const requireProductMasterDataEditor = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true, createdById: true },
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!canEditProductMasterData(req.user, product)) {
      return res.status(403).json({ error: PRODUCT_EDIT_FORBIDDEN });
    }
    return next();
  } catch (error) {
    console.error('Product master-data gate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ──── PRODUCT MATERIAL SPECS (reusable spec-PDF library) ────
// GET /api/products/:id/specs — list a product's spec PDFs (newest first).
// Open to any authenticated user (PR picker + Product Detail read it).
router.get('/:id/specs', authenticate, async (req, res) => {
  try {
    const specs = await prisma.productSpec.findMany({
      where: { productId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(specs);
  } catch (error) {
    console.error('List product specs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products/:id/specs — add a spec PDF to the library. Master owners,
// or whoever entered this material in master data.
// Reuses the pr-specs uploader so PR-time and product-page uploads share storage.
router.post('/:id/specs', authenticate, requireProductMasterDataEditor, prSpecsUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const spec = await prisma.productSpec.create({
      data: {
        productId: req.params.id,
        url: publicUrlFor('pr-specs', req.file.filename),
        name: req.file.originalname || req.file.filename,
        uploadedById: req.user.id,
        uploadedByName: req.user.name || null,
      },
    });
    res.status(201).json(spec);
  } catch (error) {
    console.error('Upload product spec error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id/specs/:specId — remove a spec link.
router.delete('/:id/specs/:specId', authenticate, requireProductMasterDataEditor, async (req, res) => {
  try {
    await prisma.productSpec.delete({ where: { id: req.params.specId } });
    res.json({ message: 'Spec removed' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Spec not found' });
    console.error('Delete product spec error:', error);
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
        specs: { orderBy: { createdAt: 'desc' } },
        // Who entered this material in master data — shown on the master-data
        // page and used there to decide whether the form is editable.
        createdBy: { select: { id: true, name: true, role: true } },
        // Full field-level edit trail (who changed what, when). Surfaced on the
        // Product Detail page's "Edit History" tab.
        editHistory: { orderBy: { createdAt: 'desc' }, take: 200 },
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
            // Entry-level customer test reports (per-line ones ride on the item).
            testReports: { where: { gatePassItemId: null }, orderBy: { createdAt: 'asc' } },
          },
        },
        sourceInwardGatePassItem: {
          select: {
            id: true, description: true, quantity: true, unit: true,
            probableReturnDate: true, itemPassType: true,
            testReports: { orderBy: { createdAt: 'asc' } },
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

    // New inward-register batches don't use the legacy QCInspection — their full
    // chain (PR → PO → lot → QC report) lives on the MaterialInwardRegister row.
    // Synthesize a sourceQcInspection-shaped object from it so the procurement
    // chain tab links them up exactly like PO-flow batches (instead of showing
    // "Legacy / no QC link").
    const regIds = [...new Set(poBatches
      .filter((b) => b.referenceType === 'MaterialInwardRegister' && !b.sourceQcInspection && b.referenceId)
      .map((b) => b.referenceId))];
    if (regIds.length) {
      const regs = await prisma.materialInwardRegister.findMany({ where: { id: { in: regIds } } });
      const poIds = [...new Set(regs.map((r) => r.purchaseOrderId).filter(Boolean))];
      const poItemIds = [...new Set(regs.map((r) => r.purchaseOrderItemId).filter(Boolean))];
      const userIds = [...new Set(regs.flatMap((r) => [r.qcReviewerId, r.qcRequestedById, r.createdById]).filter(Boolean))];
      const prSelect = {
        id: true, requestNumber: true,
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
      };
      const [pos, poItems, users] = await Promise.all([
        poIds.length ? prisma.purchaseOrder.findMany({
          where: { id: { in: poIds } },
          select: {
            id: true, orderNumber: true, customName: true, supplierName: true, mirNo: true,
            purchaseRequest: { select: prSelect },
            sourceRequests: { select: { purchaseRequest: { select: prSelect } } },
          },
        }) : [],
        poItemIds.length ? prisma.purchaseOrderItem.findMany({ where: { id: { in: poItemIds } }, select: { id: true, quantity: true } }) : [],
        userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      ]);
      const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));
      const poItemMap = Object.fromEntries(poItems.map((p) => [p.id, p]));
      const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
      const docUrl = (docs, re) => (Array.isArray(docs) ? (docs.find((d) => re.test(d.label || '') || re.test(d.name || ''))?.url || null) : null);
      const toDocObj = (v) => (Array.isArray(v) ? Object.fromEntries(v.map((k) => [k, true])) : (v && typeof v === 'object' ? v : {}));

      const regMap = {};
      for (const r of regs) {
        const po = r.purchaseOrderId ? poMap[r.purchaseOrderId] : null;
        const pr = po?.purchaseRequest || po?.sourceRequests?.[0]?.purchaseRequest || null;
        const rep = r.qcReport || {};
        const rq = r.qcRequest || {};
        const isInvoice = ['INVOICE', 'CASH_PURCHASE'].includes(r.docType);
        regMap[r.id] = {
          id: r.id,
          inspectionNumber: r.ionNo || r.qcReportNo || r.mirNo,
          lotNumber: r.lotNo,
          arrivedQty: r.qtyReceived,
          batchNo: r.batchNo,
          invoiceNo: isInvoice ? r.docNumber : null,
          invoiceDate: isInvoice ? r.inwardDate : null,
          invoiceFileUrl: docUrl(r.documents, /invoice/i),
          lotReportFileUrl: docUrl(r.documents, /report/i),
          // Full set of supporting papers Stores attached at inward (invoice, DC,
          // test report, COA, COC, 3rd-party clearance …). The two regex picks
          // above only catch the invoice + report; surface everything here so the
          // procurement-chain tab is the single place to find every document.
          documents: Array.isArray(r.documents) ? r.documents : [],
          materialReceiptDate: r.inwardDate,
          result: r.qcResult || null,
          // Tools & Fixtures fast-path: inwarded to a unit before QC. QC pending
          // until a result is filed; surfaced as a badge on the procurement chain.
          qcDeferred: !!(r.inwardedAt && !r.qcResult),
          dcNo: rq.dcNo || null,
          gatePassNo: rq.gatePassNo || null,
          gatePassType: rq.gatePassType || null,
          requestCreatedBy: userMap[r.qcRequestedById] || userMap[r.createdById] || null,
          createdAt: r.qcRequestedAt || r.createdAt,
          inspectedBy: r.qcReviewerId ? (userMap[r.qcReviewerId] || null) : null,
          inspectedAt: r.qcFinishedAt || null,
          reportNo: r.qcReportNo || null,
          reportDate: rep.reportDate || null,
          qtyOrdered: r.purchaseOrderItemId ? (poItemMap[r.purchaseOrderItemId]?.quantity ?? null) : null,
          qtyReceived: r.qtyReceived,
          qtyAccepted: r.qtyAccepted,
          qtyRejected: r.qtyRejected,
          rejectionReason: rep.rejectionReason || null,
          remarks: r.qcReportRemark || null,
          inspectionLocation: rep.inspectionLocation || null,
          materialCategory: rep.materialCategory || null,
          documentTypes: toDocObj(rep.documentTypes),
          packingCondition: rep.packingCondition || null,
          packingDamageNotes: rep.packingDamageNotes || null,
          dateOfManufacturing: rep.dateOfManufacturing || null,
          dateOfExpiry: r.dateOfExpiry || null,
          items: [{ id: r.id, arrivedQty: r.qtyReceived, purchaseOrderItem: { id: r.purchaseOrderItemId, productName: r.itemDescription, productUnit: r.uom } }],
          purchaseOrder: po ? {
            id: po.id, orderNumber: po.orderNumber, customName: po.customName,
            supplierName: po.supplierName || r.supplierName, mirNo: po.mirNo || r.mirNo,
            purchaseRequest: pr ? {
              id: pr.id,
              requestNumber: r.prNumbers || pr.requestNumber,
              manager: pr.manager || (r.indenterName ? { name: r.indenterName } : null),
              unit: pr.unit || null,
            } : (r.prNumbers || r.indenterName
              ? { requestNumber: r.prNumbers, manager: r.indenterName ? { name: r.indenterName } : null, unit: null }
              : null),
          } : null,
        };
      }
      for (const b of poBatches) {
        if (!b.sourceQcInspection && b.referenceType === 'MaterialInwardRegister' && regMap[b.referenceId]) {
          b.sourceQcInspection = regMap[b.referenceId];
        }
      }
    }

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

// POST /api/products — sku is just the materialCode (identification number).
// Restricted to Admin, QC and the unit managers (PRODUCT_CREATE_ROLES) — master
// data is theirs to own. Any other requester who needs a new material asks one
// of them to enter it. createdById stamps the author — they and the Unit 1–5
// managers are the only ones who can edit the entry afterwards.
router.post('/', authenticate, authorizeProductCreate, auditLog('CREATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.parse(req.body);
    const category = normalizeMaterialType(data.category);
    const product = await prisma.product.create({
      // Created from the Master Data screen → master data is being added now.
      data: { ...data, sku: data.materialCode, category, masterDataComplete: true, createdById: req.user.id },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Material code already in use' });
    }
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products/bulk — create several products in one go. Stores often
// enters a batch of new items together, so the form lets them add rows and
// submit them at once. All-or-nothing: any invalid / duplicate row rolls back
// the whole batch and names the offender.
router.post('/bulk', authenticate, authorizeProductCreate, auditLog('CREATE', 'Product'), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Add at least one product' });

    const parsed = items.map((it, i) => {
      try {
        const data = productSchema.parse(it);
        return {
          ...data,
          sku: data.materialCode,
          category: normalizeMaterialType(data.category),
          masterDataComplete: true,
          createdById: req.user.id,
        };
      } catch (e) {
        if (e instanceof z.ZodError) {
          throw new z.ZodError(e.errors.map((err) => ({ ...err, path: [`Item ${i + 1}`, ...err.path] })));
        }
        throw e;
      }
    });

    // Duplicate ID numbers — catch within the batch and against existing stock
    // up front so the message can name them (the DB unique error can't).
    const codes = parsed.map((p) => p.materialCode);
    const dupInBatch = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dupInBatch) return res.status(409).json({ error: `Material code "${dupInBatch}" is repeated in the list` });
    const existing = await prisma.product.findMany({ where: { sku: { in: codes } }, select: { sku: true } });
    if (existing.length) {
      return res.status(409).json({ error: `Material code already in use: ${existing.map((e) => e.sku).join(', ')}` });
    }

    const created = await prisma.$transaction(parsed.map((data) => prisma.product.create({ data })));
    res.status(201).json({ count: created.length, products: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Material code already in use' });
    }
    console.error('Bulk create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// PUT /api/products/:id
// Who may edit is decided per product, not per role alone:
//   • master owners (Unit 1–5 managers + Admin) — any product
//   • the person who entered it in master data  — their own entry
//   • Stores — temporary rollout access, descriptive details only, and their
//     edit does NOT flip the master-data gate
// Everyone else is read-only. Every change (by anyone) goes to ProductEditHistory.
router.put('/:id', authenticate, auditLog('UPDATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.partial().parse(req.body);

    // Load first — the gate depends on who created this particular product.
    const prev = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: {
        masterDataComplete: true, createdById: true,
        materialCode: true, name: true, description: true, category: true,
        unit: true, shelfLife: true, storageTemp: true, minStockLevel: true,
      },
    });
    if (!prev) return res.status(404).json({ error: 'Product not found' });

    if (!canEditProductDetails(req.user, prev)) {
      return res.status(403).json({ error: PRODUCT_EDIT_FORBIDDEN });
    }

    // A master owner, or the author correcting their own master-data entry, is
    // maintaining master data — their save completes the gate. Stores' temporary
    // detail access is not master data and must never flip it.
    const ownsMasterData = canEditProductMasterData(req.user, prev);
    const isMaster = isProductMasterRole(req.user);
    // Stores (temporary access) may only touch descriptive fields — never the
    // stock threshold. currentStock is not in the schema, so it can't be set here.
    if (!isMaster) delete data.minStockLevel;
    // Keep sku mirrored to materialCode when the identification number changes.
    if (data.materialCode) data.sku = data.materialCode;
    // Saving on the Master Data screen counts as the master data being added —
    // releases the inward hold.
    if (ownsMasterData) data.masterDataComplete = true;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });

    // Record a field-level edit-history entry for every detail that actually
    // changed (compared after normalisation/save). Null-safe string compare so
    // "" ↔ null doesn't register as a change. Best-effort — never blocks the save.
    const changes = [];
    for (const [field, label] of Object.entries(PRODUCT_FIELD_LABELS)) {
      if (!(field in data)) continue;
      const before = prev[field] ?? null;
      const after = product[field] ?? null;
      if (String(before ?? '') !== String(after ?? '')) {
        changes.push({ field, label, from: before, to: after });
      }
    }
    if (changes.length) {
      await prisma.productEditHistory.create({
        data: {
          productId: product.id,
          changedById: req.user.id,
          changedByName: req.user.name || null,
          changedByRole: req.user.role || null,
          changes,
        },
      }).catch((err) => console.error('[PRODUCT EDIT HISTORY FAIL]', err?.code, err?.message));
    }
    // Master data just went from missing → added: tell Stores any inward entries
    // that were held for this product can now be inwarded into stock. Only a
    // master-data save flips the gate, so a Stores detail-edit never fires this.
    if (ownsMasterData && prev.masterDataComplete === false) {
      const heldCount = await prisma.materialInwardRegister.count({
        where: { productId: product.id, inwardedAt: null, status: { not: 'INWARDED' } },
      });
      if (heldCount > 0) {
        await prisma.notification.create({
          data: {
            type: 'INWARD_MASTER_DATA_READY',
            title: `Master data added: ${product.name}`,
            message: `${req.user.name} added master data for "${product.name}". ${heldCount} inward ${heldCount === 1 ? 'entry is' : 'entries are'} waiting — you can inward ${heldCount === 1 ? 'it' : 'them'} now.`,
            targetRole: 'STORE_MANAGER',
            sentById: req.user.id,
          },
        }).catch(() => {});
      }
    }
    res.json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Material code already in use' });
    }
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products/:id/msds — upload / replace the Material Safety Data Sheet.
router.post('/:id/msds', authenticate, requireProductMasterDataEditor, msdsUpload.single('msds'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { msdsUrl: publicUrlFor('msds', req.file.filename), msdsName: req.file.originalname || req.file.filename },
    });
    res.json(product);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    console.error('MSDS upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id/msds — remove the MSDS link.
router.delete('/:id/msds', authenticate, requireProductMasterDataEditor, async (req, res) => {
  try {
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { msdsUrl: null, msdsName: null },
    });
    res.json(product);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    console.error('MSDS remove error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── DELETING A MASTER-DATA MATERIAL ────
// Everything that can point at a product. Anything found here means the material
// has history, so it can only be deactivated — removing the row would either be
// refused by the database or silently orphan a document somebody still reads.
// ProductSpec / ProductEditHistory / empty unit-dept stock rows are deliberately
// absent: they belong to the material itself and go with it.
async function productUsage(productId) {
  const [
    product, purchaseRequestItems, mivItems, quotationItems, purchaseOrderItems,
    transfers, stockMovements, batches, materialPools, inwardRows, unitStocks, deptStocks,
  ] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, sku: true, materialCode: true, category: true, isActive: true, currentStock: true },
    }),
    prisma.purchaseRequestItem.count({ where: { productId } }),
    prisma.requestItem.count({ where: { productId } }),
    prisma.quotationItem.count({ where: { productId } }),
    prisma.purchaseOrderItem.count({ where: { productId } }),
    prisma.inventoryTransferRequest.count({ where: { productId } }),
    prisma.stockMovement.count({ where: { productId } }),
    prisma.productBatch.count({ where: { productId } }),
    prisma.materialPool.count({ where: { productId } }),
    prisma.materialInwardRegister.count({ where: { productId } }),
    prisma.productUnitStock.count({ where: { productId, quantity: { gt: 0 } } }),
    prisma.productDeptStock.count({ where: { productId, quantity: { gt: 0 } } }),
  ]);
  if (!product) return null;
  const counts = {
    purchaseRequestItems, mivItems, quotationItems, purchaseOrderItems,
    transfers, stockMovements, batches, materialPools, inwardRows, unitStocks, deptStocks,
  };
  const referenced = Object.values(counts).reduce((a, b) => a + b, 0);
  const hasStock = (product.currentStock || 0) > 0;
  return { product, counts, referenced, hasStock, canHardDelete: referenced === 0 && !hasStock };
}

// GET /api/products/:id/usage — what references this material, so the delete
// confirmation can say up front whether it will be removed or deactivated.
router.get('/:id/usage', authenticate, authorizeProductMaster, async (req, res) => {
  try {
    const usage = await productUsage(req.params.id);
    if (!usage) return res.status(404).json({ error: 'Product not found' });
    res.json(usage);
  } catch (error) {
    console.error('Product usage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id — remove a material from master data.
// Removed for real when nothing references it (a mistyped or duplicate entry);
// deactivated when it has history, which hides it from every picker and list
// while leaving the PRs, POs and batches that name it readable. Deliberately NOT
// opened to the person who added the material — it can break other people's
// documents, so it stays with the master owners.
router.delete('/:id', authenticate, authorizeProductMaster, auditLog('DELETE', 'Product'), async (req, res) => {
  try {
    const usage = await productUsage(req.params.id);
    if (!usage) return res.status(404).json({ error: 'Product not found' });

    if (!usage.canHardDelete) {
      const product = await prisma.product.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      return res.json({
        deleted: false,
        message: `"${product.name}" is used elsewhere, so it was deactivated instead of deleted — it is hidden from every picker and list, and the documents that reference it are unchanged.`,
        usage: { counts: usage.counts, referenced: usage.referenced, hasStock: usage.hasStock },
        product,
      });
    }

    // Nothing points at it: drop the material's own records, then the row.
    // Empty unit/dept stock rows and specs/history cascade or are cleared here.
    await prisma.$transaction([
      prisma.productSpec.deleteMany({ where: { productId: req.params.id } }),
      prisma.productEditHistory.deleteMany({ where: { productId: req.params.id } }),
      prisma.productUnitStock.deleteMany({ where: { productId: req.params.id } }),
      prisma.productDeptStock.deleteMany({ where: { productId: req.params.id } }),
      prisma.product.delete({ where: { id: req.params.id } }),
    ]);
    res.json({
      deleted: true,
      message: `"${usage.product.name}" was deleted from master data. Its material code ${usage.product.materialCode || usage.product.sku || ''} is free again.`.trim(),
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    // A reference we don't count above (foreign key still held somewhere) —
    // fall back to deactivating rather than failing the request.
    if (error.code === 'P2003') {
      const product = await prisma.product.update({
        where: { id: req.params.id },
        data: { isActive: false },
      }).catch(() => null);
      if (product) {
        return res.json({
          deleted: false,
          message: `"${product.name}" is still referenced by another record, so it was deactivated instead of deleted.`,
          product,
        });
      }
    }
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
