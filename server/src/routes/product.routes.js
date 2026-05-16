const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { paginate } = require('../utils/helpers');

const router = express.Router();

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  minStockLevel: z.number().min(0).optional(),
  maxStockLevel: z.number().min(0).optional().nullable(),
});

// GET /api/products
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, category, page, limit } = req.query;

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = category;

    // Support limit=all to bypass pagination (for product selection dropdowns)
    if (limit === 'all') {
      const products = await prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
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
      }),
      prisma.product.count({ where }),
    ]);

    res.json({ products, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get products error:', error);
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
      },
    });

    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products
router.post('/', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('CREATE', 'Product'), async (req, res) => {
  try {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({ data });
    res.status(201).json(product);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU already exists' });
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
