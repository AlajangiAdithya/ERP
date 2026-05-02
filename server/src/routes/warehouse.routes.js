const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { generateOrderNumber, paginate } = require('../utils/helpers');

const router = express.Router();

const warehouseSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

// GET /api/warehouses — list all warehouses
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [warehouses, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        include: {
          _count: { select: { warehouseStocks: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.warehouse.count({ where }),
    ]);

    // Get total stock value for each warehouse
    const warehousesWithStats = await Promise.all(
      warehouses.map(async (wh) => {
        const stockAgg = await prisma.warehouseStock.aggregate({
          where: { warehouseId: wh.id, quantity: { gt: 0 } },
          _sum: { quantity: true },
        });
        return {
          ...wh,
          totalItems: wh._count.warehouseStocks,
          totalQuantity: stockAgg._sum.quantity || 0,
        };
      })
    );

    res.json({ warehouses: warehousesWithStats, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get warehouses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warehouses/all — all warehouses (no pagination, for dropdowns)
router.get('/all', authenticate, async (req, res) => {
  try {
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true },
    });
    res.json(warehouses);
  } catch (error) {
    console.error('Get all warehouses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warehouses/:id — single warehouse with stock details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
      include: {
        warehouseStocks: {
          where: { quantity: { gt: 0 } },
          include: {
            product: {
              select: { id: true, name: true, sku: true, unit: true, category: true, currentStock: true },
            },
          },
          orderBy: { product: { name: 'asc' } },
        },
      },
    });

    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(warehouse);
  } catch (error) {
    console.error('Get warehouse error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/warehouses — create warehouse
router.post('/', authenticate, authorizeMinRole('STAFF'), auditLog('CREATE', 'Warehouse'), async (req, res) => {
  try {
    const data = warehouseSchema.parse(req.body);
    const warehouse = await prisma.warehouse.create({ data });
    res.status(201).json(warehouse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create warehouse error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/warehouses/:id — update warehouse
router.put('/:id', authenticate, authorizeMinRole('STAFF'), auditLog('UPDATE', 'Warehouse'), async (req, res) => {
  try {
    const data = warehouseSchema.partial().parse(req.body);
    const warehouse = await prisma.warehouse.update({
      where: { id: req.params.id },
      data,
    });
    res.json(warehouse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: 'Warehouse not found' });
    console.error('Update warehouse error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/warehouses/:id — soft delete
router.delete('/:id', authenticate, authorizeMinRole('MANAGER'), auditLog('DELETE', 'Warehouse'), async (req, res) => {
  try {
    await prisma.warehouse.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Warehouse deactivated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Warehouse not found' });
    console.error('Delete warehouse error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── WAREHOUSE STOCK ────

// PUT /api/warehouses/:id/stock — update bin location for a product in warehouse
router.put('/:id/stock', authenticate, authorizeMinRole('STAFF'), async (req, res) => {
  try {
    const { productId, binLocation } = req.body;
    if (!productId) return res.status(400).json({ error: 'Product ID is required' });

    const stock = await prisma.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: req.params.id, productId } },
      update: { binLocation },
      create: { warehouseId: req.params.id, productId, quantity: 0, binLocation },
    });
    res.json(stock);
  } catch (error) {
    console.error('Update bin location error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── STOCK TRANSFERS ────

const transferSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  transferDate: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/warehouses/transfers — create stock transfer
router.post('/transfers', authenticate, authorizeMinRole('STAFF'), async (req, res) => {
  try {
    const data = transferSchema.parse(req.body);

    if (data.fromWarehouseId === data.toWarehouseId) {
      return res.status(400).json({ error: 'Source and destination warehouses must be different' });
    }

    // Check source warehouse has enough stock
    const sourceStock = await prisma.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: data.fromWarehouseId, productId: data.productId } },
    });

    if (!sourceStock || sourceStock.quantity < data.quantity) {
      return res.status(400).json({ error: 'Insufficient stock in source warehouse' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Decrement source warehouse
      await tx.warehouseStock.update({
        where: { warehouseId_productId: { warehouseId: data.fromWarehouseId, productId: data.productId } },
        data: { quantity: { decrement: data.quantity } },
      });

      // Increment destination warehouse (upsert)
      await tx.warehouseStock.upsert({
        where: { warehouseId_productId: { warehouseId: data.toWarehouseId, productId: data.productId } },
        update: { quantity: { increment: data.quantity } },
        create: { warehouseId: data.toWarehouseId, productId: data.productId, quantity: data.quantity },
      });

      // Create transfer record
      const transfer = await tx.stockTransfer.create({
        data: {
          transferNumber: generateOrderNumber('TRF'),
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          productId: data.productId,
          quantity: data.quantity,
          transferDate: data.transferDate ? new Date(data.transferDate) : new Date(),
          notes: data.notes || null,
          createdBy: req.user.id,
        },
        include: {
          fromWarehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
          product: { select: { name: true, sku: true } },
        },
      });

      // Create stock movements for audit trail
      await tx.stockMovement.create({
        data: {
          productId: data.productId,
          type: 'OUT',
          quantity: data.quantity,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          notes: `Transfer to ${transfer.toWarehouse.name} (${transfer.transferNumber})`,
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: data.productId,
          type: 'IN',
          quantity: data.quantity,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          notes: `Transfer from ${transfer.fromWarehouse.name} (${transfer.transferNumber})`,
        },
      });

      return transfer;
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Stock transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warehouses/transfers/history — transfer history
router.get('/transfers/history', authenticate, async (req, res) => {
  try {
    const { search, productId, warehouseId, startDate, endDate, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (productId) where.productId = productId;
    if (warehouseId) {
      where.OR = [
        { fromWarehouseId: warehouseId },
        { toWarehouseId: warehouseId },
      ];
    }
    if (startDate || endDate) {
      where.transferDate = {};
      if (startDate) where.transferDate.gte = new Date(startDate);
      if (endDate) where.transferDate.lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { transferNumber: { contains: search, mode: 'insensitive' } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { fromWarehouse: { name: { contains: search, mode: 'insensitive' } } },
        { toWarehouse: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [transfers, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        include: {
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, sku: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    res.json({ transfers, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get transfer history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/warehouses/:id/stock-for-product/:productId — get stock for a product in a warehouse
router.get('/:id/stock-for-product/:productId', authenticate, async (req, res) => {
  try {
    const stock = await prisma.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: req.params.id, productId: req.params.productId } },
    });
    res.json({ quantity: stock?.quantity || 0, binLocation: stock?.binLocation || '' });
  } catch (error) {
    console.error('Get warehouse stock error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
