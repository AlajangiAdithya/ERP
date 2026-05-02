const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate } = require('../utils/helpers');

const router = express.Router();

const INSPECTION_INCLUDE = {
  inspectedBy: { select: { id: true, name: true } },
  requestCreatedBy: { select: { id: true, name: true, role: true } },
  purchaseOrder: {
    select: {
      id: true, orderNumber: true, customName: true, supplierName: true,
      totalAmount: true, status: true, goodsArrivedAt: true,
      items: true,
      purchaseRequest: {
        select: {
          id: true, requestNumber: true, requestId: true,
          manager: { select: { id: true, name: true } },
          unit: { select: { name: true } },
          items: {
            select: { scopeOfWork: true, requiredByDate: true, productName: true },
          },
        },
      },
    },
  },
};

// GET /api/qc-inspections — list inspections
router.get('/', authenticate, authorize('QC', 'ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER'), async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.result = status;

    const [inspections, total] = await Promise.all([
      prisma.qCInspection.findMany({
        where,
        include: INSPECTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.qCInspection.count({ where }),
    ]);

    // Also get orders awaiting inspection (arrived but no inspection yet)
    const pendingOrders = await prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['GOODS_ARRIVED', 'QC_PENDING'] },
        qcInspections: { none: { result: { in: ['PASSED', 'FAILED'] } } },
      },
      include: {
        items: true,
        purchaseRequest: {
          select: {
            requestNumber: true,
            manager: { select: { name: true } },
            unit: { select: { name: true } },
          },
        },
      },
      orderBy: { goodsArrivedAt: 'desc' },
    });

    res.json({
      inspections, total,
      pendingOrders,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get QC inspections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/qc-inspections/:id
router.get('/:id', authenticate, authorize('QC', 'ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER'), async (req, res) => {
  try {
    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
      include: INSPECTION_INCLUDE,
    });

    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    res.json(inspection);
  } catch (error) {
    console.error('Get QC inspection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/qc-inspections — QC/Purchase/Stores create inspection request
router.post('/', authenticate, authorize('QC', 'PURCHASE_OFFICER', 'STORE_MANAGER'), async (req, res) => {
  try {
    const {
      purchaseOrderId, parameters, notes,
      // Page 1: Inward Inspection Request fields
      invoiceNo, invoiceDate, dcNo, gatePassNo, gatePassType,
      probableDateOfReturn, materialReceiptDate,
      // Page 2: Inward Inspection Report fields
      reportNo, reportDate, materialDescription, materialCategory,
      documentTypes, inspectionLocation, reportReferenceNo,
      packingCondition, packingDamageNotes, batchNo,
      dateOfManufacturing, dateOfExpiry, tappedHolesCondition,
      qtyAsPerPR, qtyOrdered, qtyReceived, qtyAccepted, qtyRejected,
      rejectionReason, remarks, mirNo,
    } = req.body;

    if (!purchaseOrderId) {
      return res.status(400).json({ error: 'Purchase order ID is required' });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['GOODS_ARRIVED', 'QC_PENDING'].includes(order.status)) {
      return res.status(400).json({ error: 'Can only inspect orders with arrived goods' });
    }

    const inspectionNumber = generateOrderNumber('QC');

    const inspection = await prisma.$transaction(async (tx) => {
      const result = await tx.qCInspection.create({
        data: {
          inspectionNumber,
          purchaseOrderId,
          parameters: parameters || null,
          notes: notes || null,
          requestCreatedById: req.user.id,
          // Page 1: Inward Inspection Request
          invoiceNo: invoiceNo || null,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
          dcNo: dcNo || null,
          gatePassNo: gatePassNo || null,
          gatePassType: gatePassType || null,
          probableDateOfReturn: probableDateOfReturn ? new Date(probableDateOfReturn) : null,
          materialReceiptDate: materialReceiptDate ? new Date(materialReceiptDate) : null,
          // Page 2: Inward Inspection Report
          reportNo: reportNo || null,
          reportDate: reportDate ? new Date(reportDate) : null,
          materialDescription: materialDescription || null,
          materialCategory: materialCategory || null,
          documentTypes: documentTypes || null,
          inspectionLocation: inspectionLocation || null,
          reportReferenceNo: reportReferenceNo || null,
          packingCondition: packingCondition || null,
          packingDamageNotes: packingDamageNotes || null,
          batchNo: batchNo || null,
          dateOfManufacturing: dateOfManufacturing ? new Date(dateOfManufacturing) : null,
          dateOfExpiry: dateOfExpiry ? new Date(dateOfExpiry) : null,
          tappedHolesCondition: tappedHolesCondition || null,
          qtyAsPerPR: qtyAsPerPR != null ? qtyAsPerPR : null,
          qtyOrdered: qtyOrdered != null ? qtyOrdered : null,
          qtyReceived: qtyReceived != null ? qtyReceived : null,
          qtyAccepted: qtyAccepted != null ? qtyAccepted : null,
          qtyRejected: qtyRejected != null ? qtyRejected : null,
          rejectionReason: rejectionReason || null,
          remarks: remarks || null,
          mirNo: mirNo || null,
        },
        include: INSPECTION_INCLUDE,
      });

      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: 'QC_PENDING' },
      });

      return result;
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'QCInspection',
        entityId: inspection.id,
        details: { inspectionNumber, orderNumber: order.orderNumber, customName: order.customName },
        ipAddress: req.ip,
      },
    });

    // Send notification to QC team to inspect
    await prisma.notification.create({
      data: {
        type: 'INSPECTION_REQUEST',
        title: `Inspection Request: ${inspection.inspectionNumber}`,
        message: `Goods arrived for order ${order.orderNumber}. Inspection request created. Please inspect and submit report.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });

    res.status(201).json(inspection);
  } catch (error) {
    console.error('Create QC inspection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/qc-inspections/:id/result — QC submits inspection result
router.put('/:id/result', authenticate, authorize('QC'), async (req, res) => {
  try {
    const {
      result, parameters, notes,
      // Allow updating IIR fields when submitting result
      reportNo, reportDate, materialDescription, materialCategory,
      documentTypes, inspectionLocation, reportReferenceNo,
      packingCondition, packingDamageNotes, batchNo,
      dateOfManufacturing, dateOfExpiry, tappedHolesCondition,
      qtyAsPerPR, qtyOrdered, qtyReceived, qtyAccepted, qtyRejected,
      rejectionReason, remarks, mirNo,
    } = req.body;

    if (!result || !['PASSED', 'FAILED', 'PARTIAL'].includes(result)) {
      return res.status(400).json({ error: 'Result must be PASSED, FAILED, or PARTIAL' });
    }

    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: {
          include: {
            purchaseRequest: { select: { id: true, requestNumber: true } },
          },
        },
      },
    });

    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (inspection.result !== 'PENDING') {
      return res.status(400).json({ error: 'Inspection result already submitted' });
    }

    const order = inspection.purchaseOrder;

    const updated = await prisma.$transaction(async (tx) => {
      const updateData = {
        result,
        parameters: parameters || inspection.parameters,
        notes: notes || inspection.notes,
        inspectedById: req.user.id,
        inspectedAt: new Date(),
      };
      // Update IIR report fields if provided
      if (reportNo !== undefined) updateData.reportNo = reportNo || null;
      if (reportDate !== undefined) updateData.reportDate = reportDate ? new Date(reportDate) : null;
      if (materialDescription !== undefined) updateData.materialDescription = materialDescription || null;
      if (materialCategory !== undefined) updateData.materialCategory = materialCategory || null;
      if (documentTypes !== undefined) updateData.documentTypes = documentTypes || null;
      if (inspectionLocation !== undefined) updateData.inspectionLocation = inspectionLocation || null;
      if (reportReferenceNo !== undefined) updateData.reportReferenceNo = reportReferenceNo || null;
      if (packingCondition !== undefined) updateData.packingCondition = packingCondition || null;
      if (packingDamageNotes !== undefined) updateData.packingDamageNotes = packingDamageNotes || null;
      if (batchNo !== undefined) updateData.batchNo = batchNo || null;
      if (dateOfManufacturing !== undefined) updateData.dateOfManufacturing = dateOfManufacturing ? new Date(dateOfManufacturing) : null;
      if (dateOfExpiry !== undefined) updateData.dateOfExpiry = dateOfExpiry ? new Date(dateOfExpiry) : null;
      if (tappedHolesCondition !== undefined) updateData.tappedHolesCondition = tappedHolesCondition || null;
      if (qtyAsPerPR !== undefined) updateData.qtyAsPerPR = qtyAsPerPR;
      if (qtyOrdered !== undefined) updateData.qtyOrdered = qtyOrdered;
      if (qtyReceived !== undefined) updateData.qtyReceived = qtyReceived;
      if (qtyAccepted !== undefined) updateData.qtyAccepted = qtyAccepted;
      if (qtyRejected !== undefined) updateData.qtyRejected = qtyRejected;
      if (rejectionReason !== undefined) updateData.rejectionReason = rejectionReason || null;
      if (remarks !== undefined) updateData.remarks = remarks || null;
      if (mirNo !== undefined) updateData.mirNo = mirNo || null;

      const inspResult = await tx.qCInspection.update({
        where: { id: req.params.id },
        data: updateData,
        include: INSPECTION_INCLUDE,
      });

      // Update order and PR status based on result
      if (result === 'PASSED') {
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'QC_PASSED' },
        });
        await tx.purchaseRequest.update({
          where: { id: order.purchaseRequest.id },
          data: { status: 'QC_PASSED' },
        });
      } else if (result === 'FAILED') {
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'QC_FAILED' },
        });
      }

      return inspResult;
    });

    // Send notifications based on result
    if (result === 'PASSED') {
      await prisma.notification.create({
        data: {
          type: 'QC_PASSED',
          title: `QC Passed: ${order.customName}`,
          message: `Quality inspection passed for order "${order.customName}" (${order.orderNumber}). Please proceed with inward entry into stores.`,
          targetRole: 'STORE_MANAGER',
          sentById: req.user.id,
        },
      });
    } else if (result === 'FAILED') {
      await prisma.notification.create({
        data: {
          type: 'QC_FAILED',
          title: `QC Failed: ${order.customName}`,
          message: `Quality inspection failed for order "${order.customName}" (${order.orderNumber}).${notes ? ' Notes: ' + notes : ''} Please review.`,
          targetRole: 'PURCHASE_OFFICER',
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'QC_RESULT',
        entity: 'QCInspection',
        entityId: inspection.id,
        details: { inspectionNumber: inspection.inspectionNumber, result, orderNumber: order.orderNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('QC result error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
