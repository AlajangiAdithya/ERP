const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const path = require('path');
const fs = require('fs');
const { generateSequentialNumber, paginate, applyDateFilter, isUniqueViolation, withDocRetry } = require('../utils/helpers');
const { qcDocsUpload, invoiceUpload, publicUrlFor, UPLOAD_ROOT } = require('../middleware/upload');

const router = express.Router();

// Accept up to 10 supporting documents per PO upload action.
function acceptQcDocs(req, res, next) {
  qcDocsUpload.array('docs', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Document upload failed' });
    next();
  });
}

// Optional replacement invoice PDF when PO edits the IIR.
function acceptInvoice(req, res, next) {
  invoiceUpload.single('invoiceFile')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Invoice upload failed' });
    next();
  });
}

function unlinkPublicFile(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) return;
  const relative = publicUrl.replace(/^\/uploads\//, '');
  const target = path.join(UPLOAD_ROOT, relative);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) return;
  fs.promises.unlink(resolved).catch(() => {});
}

// Full PR + item spec fields the QC team needs when filling the inspection
// report. These are the same fields a unit manager entered on the PR form,
// so QC can verify the goods against the exact specifications requested.
const PR_SPEC_SELECT = {
  id: true,
  requestNumber: true,
  createdAt: true,
  manager: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true, code: true } },
  items: {
    select: {
      id: true,
      productName: true,
      productUnit: true,
      requestedQty: true,
      adminApprovedQty: true,
      materialType: true,
      materialSpecification: true,
      qapNo: true,
      drawingNo: true,
      materialRequiredFor: true,
      internalWorkOrder: true,
      purpose: true,
      sourceOfSupply: true,
      scopeOfWork: true,
      inspectionType: true,
      requiredByDate: true,
      itemRemarks: true,
    },
  },
};

const INSPECTION_INCLUDE = {
  inspectedBy: { select: { id: true, name: true } },
  requestCreatedBy: { select: { id: true, name: true, role: true } },
  // Per-PO-item arrived qty rows for THIS lot — lets QC see exactly
  // which items arrived and how much of each.
  items: {
    include: {
      purchaseOrderItem: {
        select: {
          id: true, productName: true, productUnit: true,
          quantity: true, receivedQty: true,
        },
      },
    },
  },
  purchaseOrder: {
    select: {
      id: true, orderNumber: true, customName: true, supplierName: true,
      totalAmount: true, status: true, goodsArrivedAt: true, poDocumentUrl: true,
      isUnion: true,
      items: true,
      // Sibling lots for this PO so QC can see prior lot history alongside this one.
      qcInspections: {
        select: {
          id: true, inspectionNumber: true, lotNumber: true, arrivedQty: true,
          invoiceNo: true, invoiceFileUrl: true, result: true,
          materialReceiptDate: true, createdAt: true,
        },
        orderBy: { lotNumber: 'asc' },
      },
      purchaseRequest: { select: PR_SPEC_SELECT },
      sourceRequests: {
        select: {
          purchaseRequest: { select: PR_SPEC_SELECT },
        },
      },
    },
  },
};

// GET /api/qc-inspections — list inspections.
// Once an inspection report is filled, everyone in the originating PR chain (PR manager and
// requester roles MANAGER/LAB/SAFETY) can see it scoped to PRs they raised.
router.get('/', authenticate, authorize('QC', 'ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'SAFETY', 'MANAGER', 'LAB'), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (status) where.result = status;

    // PR originators (MANAGER/LAB/SAFETY) only see inspections tied to PRs they raised.
    // Privileged roles (QC, ADMIN, PURCHASE_OFFICER, STORE_MANAGER) see everything.
    const originatorRoles = ['MANAGER', 'LAB', 'SAFETY'];
    if (originatorRoles.includes(req.user.role)) {
      where.purchaseOrder = { purchaseRequest: { managerId: req.user.id } };
    }

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

    // Orders awaiting inspection — includes repeat deliveries (partial delivery support).
    // PR originators don't need this section (they can't act on it), so skip the query for them.
    const pendingOrders = originatorRoles.includes(req.user.role)
      ? []
      : await prisma.purchaseOrder.findMany({
          where: {
            status: 'GOODS_ARRIVED',
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
router.get('/:id', authenticate, authorize('QC', 'ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'SAFETY', 'MANAGER', 'LAB'), async (req, res) => {
  try {
    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
      include: INSPECTION_INCLUDE,
    });

    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    // Originator roles can only view inspections tied to PRs they raised.
    const originatorRoles = ['MANAGER', 'LAB', 'SAFETY'];
    if (originatorRoles.includes(req.user.role)) {
      const prManagerId = inspection.purchaseOrder?.purchaseRequest?.manager?.id;
      if (prManagerId !== req.user.id) {
        return res.status(403).json({ error: 'Not authorised to view this inspection' });
      }
    }

    res.json(inspection);
  } catch (error) {
    console.error('Get QC inspection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/qc-inspections — QC/Purchase/Stores create inspection request.
// The signed PO PDF that QC reads is uploaded on the PurchaseOrder itself
// (POST /api/purchase-orders/:id/po-document), not on the inspection.
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
      // Phase 4: PO-driven request fields
      docRequirement, docRequirementNote,
    } = req.body;

    if (!purchaseOrderId) {
      return res.status(400).json({ error: 'Purchase order ID is required' });
    }
    if (docRequirement && !['COA', 'COC', 'ANY_REPORTS', 'NONE'].includes(docRequirement)) {
      return res.status(400).json({ error: 'docRequirement must be COA, COC, ANY_REPORTS, or NONE' });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['GOODS_ARRIVED', 'QC_PENDING'].includes(order.status)) {
      return res.status(400).json({ error: 'Can only inspect orders with arrived goods' });
    }

    let inspectionNumber;
    const inspection = await withDocRetry(() => prisma.$transaction(async (tx) => {
      inspectionNumber = await generateSequentialNumber(tx, 'QC');
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
          docRequirement: docRequirement || null,
          docRequirementNote: docRequirementNote || null,
        },
        include: INSPECTION_INCLUDE,
      });

      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: 'QC_PENDING' },
      });

      return result;
    }));

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
      // Phase 4: QC can also mark ON_HOLD bouncing back to PO with pendingReason
      pendingReason,
    } = req.body;

    if (!result || !['PASSED', 'FAILED', 'PARTIAL', 'ON_HOLD'].includes(result)) {
      return res.status(400).json({ error: 'Result must be PASSED, FAILED, PARTIAL, or ON_HOLD' });
    }

    if (result === 'ON_HOLD') {
      if (!pendingReason || !String(pendingReason).trim()) {
        return res.status(400).json({ error: 'pendingReason is required when placing inspection on hold' });
      }
    }

    // Validate quantities only for finalized results
    let recNum = null, accNum = null, derivedRejected = 0;
    if (result !== 'ON_HOLD') {
      recNum = qtyReceived != null && qtyReceived !== '' ? parseFloat(qtyReceived) : null;
      accNum = qtyAccepted != null && qtyAccepted !== '' ? parseFloat(qtyAccepted) : null;
      if (recNum == null || isNaN(recNum) || recNum <= 0) {
        return res.status(400).json({ error: 'Qty Received is required' });
      }
      if (accNum == null || isNaN(accNum) || accNum < 0) {
        return res.status(400).json({ error: 'Qty Accepted is required' });
      }
      if (accNum > recNum) {
        return res.status(400).json({ error: 'Qty Accepted cannot exceed Qty Received' });
      }
      // The client enforces these — also enforce on the server so direct API
      // calls can't slip a malformed result past validation.
      if (result === 'PASSED' && accNum !== recNum) {
        return res.status(400).json({ error: 'PASSED requires Qty Accepted to equal Qty Received' });
      }
      if (result === 'FAILED' && accNum !== 0) {
        return res.status(400).json({ error: 'FAILED requires Qty Accepted to be 0' });
      }
      if (result === 'PARTIAL' && (accNum === 0 || accNum === recNum)) {
        return res.status(400).json({ error: 'PARTIAL requires Qty Accepted to be greater than 0 and less than Qty Received' });
      }
      derivedRejected = Math.max(0, recNum - accNum);
    }

    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: {
          include: {
            purchaseRequest: {
              select: { id: true, requestNumber: true, managerId: true },
            },
          },
        },
      },
    });

    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    // ON_HOLD can be set repeatedly when QC keeps requesting fixes; allow if PENDING or ON_HOLD.
    if (inspection.result !== 'PENDING' && inspection.result !== 'ON_HOLD') {
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
      
      // Locked Identification: if batchNo or qtyReceived were already defined (at arrival),
      // they MUST NOT be changed by QC. We ignore any overrides from the request body
      // and keep the current database values to maintain the audit trail.
      if (inspection.batchNo) {
        updateData.batchNo = inspection.batchNo;
      } else if (batchNo !== undefined) {
        updateData.batchNo = batchNo || null;
      }

      if (inspection.qtyReceived != null) {
        updateData.qtyReceived = inspection.qtyReceived;
      } else if (result !== 'ON_HOLD') {
        updateData.qtyReceived = recNum;
      }

      if (dateOfManufacturing !== undefined) updateData.dateOfManufacturing = dateOfManufacturing ? new Date(dateOfManufacturing) : null;
      if (dateOfExpiry !== undefined) updateData.dateOfExpiry = dateOfExpiry ? new Date(dateOfExpiry) : null;
      if (tappedHolesCondition !== undefined) updateData.tappedHolesCondition = tappedHolesCondition || null;
      if (qtyAsPerPR !== undefined) updateData.qtyAsPerPR = qtyAsPerPR;
      if (qtyOrdered !== undefined) updateData.qtyOrdered = qtyOrdered;
      
      if (result !== 'ON_HOLD') {
        updateData.qtyAccepted = accNum;
        updateData.qtyRejected = Math.max(0, (updateData.qtyReceived || 0) - accNum);
      }

      if (rejectionReason !== undefined) updateData.rejectionReason = rejectionReason || null;
      if (remarks !== undefined) updateData.remarks = remarks || null;
      if (mirNo !== undefined) updateData.mirNo = mirNo || null;
      if (result === 'ON_HOLD') {
        updateData.pendingReason = String(pendingReason).trim();
      } else {
        updateData.pendingReason = null;
      }

      const inspResult = await tx.qCInspection.update({
        where: { id: req.params.id },
        data: updateData,
        include: INSPECTION_INCLUDE,
      });

      // Update order and PR status based on result.
      // PARTIAL also flows to QC_PASSED so only the QC-accepted qty can be inwarded.
      if (result === 'PASSED' || result === 'PARTIAL') {
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'QC_PASSED' },
        });
        if (order.purchaseRequest?.id) {
          await tx.purchaseRequest.update({
            where: { id: order.purchaseRequest.id },
            data: { status: 'QC_PASSED' },
          });
        }
      } else if (result === 'FAILED') {
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'QC_FAILED' },
        });
      }
      // ON_HOLD keeps PO status as QC_PENDING so PO can take action and re-submit.

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
    } else if (result === 'PARTIAL') {
      await prisma.notification.create({
        data: {
          type: 'QC_PASSED',
          title: `QC Partially Passed: ${order.customName}`,
          message: `QC accepted ${accNum} of ${recNum} received for "${order.customName}" (${order.orderNumber}). Only the accepted quantity will be inwarded. ${derivedRejected} unit(s) rejected.`,
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
    } else if (result === 'ON_HOLD') {
      await prisma.notification.create({
        data: {
          type: 'QC_ON_HOLD',
          title: `QC On Hold: ${order.customName}`,
          message: `QC placed inspection ${inspection.inspectionNumber} on hold pending more information. Reason: ${pendingReason}. Please upload required documents or address the issue and re-submit for review.`,
          targetRole: 'PURCHASE_OFFICER',
          sentById: req.user.id,
        },
      });
    }

    // Once a finalised inspection report exists, surface it to the PR originator who started the chain.
    if (result !== 'ON_HOLD' && order.purchaseRequest?.managerId) {
      await prisma.notification.create({
        data: {
          type: `INSPECTION_${result}`,
          title: `Inspection Report Filed: ${inspection.inspectionNumber}`,
          message: `Inspection report for PR ${order.purchaseRequest.requestNumber} (PO ${order.orderNumber} — ${order.customName}) has been submitted. Result: ${result}.`,
          targetUserId: order.purchaseRequest.managerId,
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

// PUT /api/qc-inspections/:id/upload-docs — PO uploads supporting documents for QC verification
// PUT /api/qc-inspections/:id/iir — Purchase Officer edits the page-1 IIR fields.
// Allowed while QC has not yet submitted a result (PENDING or ON_HOLD). Lot items
// (per-PO-item arrived quantities) are NOT editable here — that requires reversing
// receivedQty on the PO, which is out of scope. Optional new invoice PDF replaces
// the existing one.
const iirEditSchema = z.object({
  batchNumber: z.string().trim().min(1, 'Batch number is required').max(64, 'Batch number too long'),
  invoiceNo: z.string().min(1, 'Invoice no. is required'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  dcNo: z.string().optional().nullable(),
  gatePassNo: z.string().optional().nullable(),
  gatePassType: z.string().optional().nullable(),
  probableDateOfReturn: z.string().optional().nullable(),
  materialReceiptDate: z.string().min(1, 'Material receipt date is required'),
  materialCategory: z.string().optional().nullable(),
  documentTypes: z.object({
    testReport: z.boolean().optional(),
    coc: z.boolean().optional(),
    coa: z.boolean().optional(),
    thirdParty: z.boolean().optional(),
    dimInspAtSupplier: z.boolean().optional(),
    dimInspAtRapsInward: z.boolean().optional(),
  }).partial().optional(),
});

router.put('/:id/iir', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), acceptInvoice, async (req, res) => {
  try {
    const body = { ...req.body };
    if (typeof body.documentTypes === 'string') {
      try { body.documentTypes = JSON.parse(body.documentTypes); }
      catch {
        if (req.file) unlinkPublicFile(publicUrlFor('invoices', req.file.filename));
        return res.status(400).json({ error: 'documentTypes must be valid JSON' });
      }
    }

    const data = iirEditSchema.parse(body);

    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: {
          select: {
            id: true, orderNumber: true, customName: true,
            qcInspections: { select: { id: true, lotNumber: true, batchNo: true } },
          },
        },
      },
    });
    if (!inspection) {
      if (req.file) unlinkPublicFile(publicUrlFor('invoices', req.file.filename));
      return res.status(404).json({ error: 'Inspection not found' });
    }

    if (!['PENDING', 'ON_HOLD'].includes(inspection.result)) {
      if (req.file) unlinkPublicFile(publicUrlFor('invoices', req.file.filename));
      return res.status(400).json({
        error: `Cannot edit IIR — inspection result is already ${inspection.result}. The form is locked after QC submits.`,
      });
    }

    // Batch number must stay unique across sibling lots on the same PO.
    const newBatch = data.batchNumber.trim();
    const duplicate = (inspection.purchaseOrder?.qcInspections || []).find(
      (q) => q.id !== inspection.id && (q.batchNo || '').trim().toLowerCase() === newBatch.toLowerCase(),
    );
    if (duplicate) {
      if (req.file) unlinkPublicFile(publicUrlFor('invoices', req.file.filename));
      return res.status(400).json({
        error: `Batch number "${newBatch}" is already used on Lot ${duplicate.lotNumber || '?'} of this PO.`,
      });
    }

    const oldInvoiceUrl = inspection.invoiceFileUrl;
    const newInvoiceUrl = req.file ? publicUrlFor('invoices', req.file.filename) : oldInvoiceUrl;

    const updated = await prisma.qCInspection.update({
      where: { id: inspection.id },
      data: {
        batchNo: newBatch,
        invoiceNo: data.invoiceNo,
        invoiceDate: new Date(data.invoiceDate),
        dcNo: data.dcNo || null,
        gatePassNo: data.gatePassNo || null,
        gatePassType: data.gatePassType || null,
        probableDateOfReturn: data.probableDateOfReturn ? new Date(data.probableDateOfReturn) : null,
        materialReceiptDate: new Date(data.materialReceiptDate),
        materialCategory: data.materialCategory || null,
        documentTypes: data.documentTypes || null,
        invoiceFileUrl: newInvoiceUrl,
      },
      include: INSPECTION_INCLUDE,
    });

    // Replace the old invoice file on disk only after the DB row points to the new one.
    if (req.file && oldInvoiceUrl && oldInvoiceUrl !== newInvoiceUrl) {
      unlinkPublicFile(oldInvoiceUrl);
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'EDIT_IIR',
        entity: 'QCInspection',
        entityId: inspection.id,
        details: {
          inspectionNumber: inspection.inspectionNumber,
          orderNumber: inspection.purchaseOrder?.orderNumber,
          batchNoChanged: inspection.batchNo !== newBatch,
          invoiceReplaced: !!req.file,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    if (req.file) unlinkPublicFile(publicUrlFor('invoices', req.file.filename));
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
    console.error('Edit IIR error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/upload-docs', authenticate, authorize('PURCHASE_OFFICER', 'STORE_MANAGER'), acceptQcDocs, async (req, res) => {
  try {
    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one document is required' });
    }

    const existing = Array.isArray(inspection.uploadedDocs) ? inspection.uploadedDocs : [];
    const newDocs = files.map((f) => ({
      filename: f.originalname,
      url: publicUrlFor('qc-docs', f.filename),
      mimetype: f.mimetype,
      size: f.size,
      uploadedById: req.user.id,
      uploadedAt: new Date().toISOString(),
    }));

    const updated = await prisma.qCInspection.update({
      where: { id: req.params.id },
      data: { uploadedDocs: [...existing, ...newDocs] },
      include: INSPECTION_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPLOAD_QC_DOCS',
        entity: 'QCInspection',
        entityId: inspection.id,
        details: { inspectionNumber: inspection.inspectionNumber, count: files.length },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Upload QC docs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/qc-inspections/:id/re-review — PO sends an ON_HOLD inspection back to QC for re-review
router.put('/:id/re-review', authenticate, authorize('PURCHASE_OFFICER', 'STORE_MANAGER'), async (req, res) => {
  try {
    const { responseNote } = req.body || {};
    const inspection = await prisma.qCInspection.findUnique({
      where: { id: req.params.id },
      include: { purchaseOrder: { select: { id: true, orderNumber: true, customName: true } } },
    });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (inspection.result !== 'ON_HOLD') {
      return res.status(400).json({ error: 'Only on-hold inspections can be sent for re-review' });
    }

    const updated = await prisma.qCInspection.update({
      where: { id: req.params.id },
      data: {
        result: 'PENDING',
        iteration: { increment: 1 },
        pendingReason: null,
        notes: responseNote
          ? `${inspection.notes ? inspection.notes + '\n' : ''}[Re-review iteration ${inspection.iteration + 1}] PO response: ${responseNote}`
          : inspection.notes,
      },
      include: INSPECTION_INCLUDE,
    });

    await prisma.notification.create({
      data: {
        type: 'QC_RE_REVIEW',
        title: `Re-review Requested: ${inspection.purchaseOrder.customName}`,
        message: `PO has addressed the hold reason and resubmitted inspection ${inspection.inspectionNumber} for re-review.${responseNote ? ' Note: ' + responseNote : ''}`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'QC_RE_REVIEW',
        entity: 'QCInspection',
        entityId: inspection.id,
        details: { inspectionNumber: inspection.inspectionNumber, iteration: inspection.iteration + 1 },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('QC re-review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
