const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const {
  paginate, generateProductSku, normalizeMaterialType,
  MATERIAL_TYPES, isUniqueViolation,
} = require('../utils/helpers');

const router = express.Router();

const productSchema = z.object({
  name: z.string().min(1),
  // SKU is auto-generated from category (materialType). Accepted but ignored on create.
  sku: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  minStockLevel: z.number().min(0).optional(),
  maxStockLevel: z.number().min(0).optional().nullable(),
});

// GET /api/products
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, page, limit, includeUnitStock } = req.query;

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = category;

    const wantUnitStock = includeUnitStock === 'true' || includeUnitStock === '1';

    // Support limit=all to bypass pagination (for product selection dropdowns)
    if (limit === 'all') {
      const products = await prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        include: wantUnitStock ? { unitStocks: { include: { unit: { select: { id: true, name: true, code: true } } } } } : undefined,
      });
      return res.json({ products, total: products.length, page: 1, totalPages: 1 });
    }

    const { skip, take } = paginate(page, limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: wantUnitStock ? { unitStocks: { include: { unit: { select: { id: true, name: true, code: true } } } } } : undefined,
      }),
      prisma.product.count({ where }),
    ]);

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

    const purchased = purchasedItems.map(it => ({
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
    const cheapest = purchased.length
      ? [...purchased].sort((a, b) => a.unitPrice - b.unitPrice)[0]
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
        sourceInwardGatePass: {
          select: {
            id: true, passNumber: true, customerName: true,
            customerGatePassNo: true, customerGatePassDate: true, customerContact: true,
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
            invoiceNo: true, invoiceDate: true, invoiceFileUrl: true,
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

    res.json({ ...product, fimBatches, poBatches });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/material-types — fixed dropdown values for PR/inward forms.
// MUST be declared before any `/:id`-style route — declared at top of file for safety.

// POST /api/products — SKU auto-generated from category (materialType)
router.post('/', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('CREATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.parse(req.body);
    const category = normalizeMaterialType(data.category);
    let product = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const sku = await generateProductSku(prisma, category);
        product = await prisma.product.create({
          data: { ...data, sku, category },
        });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 4) throw err;
      }
    }
    res.status(201).json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// PUT /api/products/:id
router.put('/:id', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('UPDATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.partial().parse(req.body);
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
    if (error.code === 'P2002') return res.status(409).json({ error: 'SKU already exists' });
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
