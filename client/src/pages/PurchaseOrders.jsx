import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Truck, CreditCard, CheckCircle, Eye, PackagePlus,
  ChevronRight, ChevronDown, Phone, Building2, FileText, Package, Layers, Clock,
  Upload, Trash2, Handshake, XCircle, AlertTriangle,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useAutoRefresh } from '../context/NotificationContext';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';
import PageHero from '../components/shared/PageHero';

const formatCurrency = (amt) => `₹${Number(amt || 0).toLocaleString('en-IN')}`;

const statusColor = (s) => ({
  PENDING_ACCOUNTING: 'amber',
  CREDIT_PLACED: 'orange',
  ORDERED: 'blue',
  PLACED: 'blue',
  ADVANCE_PAID: 'navy',
  PAYMENT_PENDING: 'yellow',
  PAID: 'green',
  GOODS_ARRIVED: 'purple',
  QC_PENDING: 'yellow',
  QC_PASSED: 'green',
  QC_FAILED: 'red',
  PARTIAL: 'amber',
  INWARD_DONE: 'green',
  COMPLETED: 'green',
  CLOSED: 'gray',
}[s] || 'gray');

const statusLabel = (s) => ({
  PENDING_ACCOUNTING: 'Awaiting Accounting',
  CREDIT_PLACED: 'On Credit · Payment Pending',
  ORDERED: 'Ordered',
  PLACED: 'Order Placed',
  ADVANCE_PAID: 'Advance Paid',
  PAYMENT_PENDING: 'Payment Pending',
  PAID: 'Fully Paid',
  GOODS_ARRIVED: 'Goods Arrived',
  QC_PENDING: 'QC Pending',
  QC_PASSED: 'QC Passed',
  QC_FAILED: 'QC Failed',
  PARTIAL: 'Partially Received',
  INWARD_DONE: 'Inward Done',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
}[s] || s);

const itemStatusColor = (s) => ({
  WAITING: 'gray',
  ORDERED: 'blue',
  ON_THE_WAY: 'purple',
  RECEIVED: 'green',
  CANCELLED: 'red',
}[s] || 'gray');

const itemStatusLabel = (s) => ({
  WAITING: 'Waiting',
  ORDERED: 'Ordered',
  ON_THE_WAY: 'On the Way',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}[s] || s);

// Material Category is sourced from the PR items' materialType (set by the unit
// manager at PR creation, finalised on admin approval) and stays the same all the
// way from PR → PO → IIR → inward. Stores never re-pick it here. Aggregates across
// all source PRs of a union PO so multi-PR pools show every distinct category.
function derivePRMaterialCategory(order) {
  if (!order) return '';
  const prs = order.isUnion
    ? (order.sourceRequests || []).map((s) => s.purchaseRequest).filter(Boolean)
    : (order.purchaseRequest ? [order.purchaseRequest] : []);
  const types = new Set();
  for (const pr of prs) {
    for (const it of (pr.items || [])) {
      if (it.materialType) types.add(it.materialType);
    }
  }
  return Array.from(types).join(' / ');
}

function ProgressBar({ value, total, label, compact = false }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const color = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-300';
  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-600">{label}</span>
          <span className={pct >= 100 ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>
            {Math.round(pct)}%
          </span>
        </div>
      )}
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${compact ? 'h-1.5' : 'h-2'}`}>
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Read-only QC inspection card (visible to Purchase, Stores, QC) ───
function QCInspectionCard({ qc }) {
  const [open, setOpen] = useState(false);
  const dt = qc.documentTypes || {};
  const docs = [
    dt.testReport && 'Test Report',
    dt.coc && 'COC',
    dt.coa && 'COA',
    dt.thirdParty && '3rd Party / Customer Clearance',
  ].filter(Boolean);
  const dims = [
    dt.dimInspAtSupplier && 'At Supplier place',
    dt.dimInspAtRapsInward && 'At RAPS inward',
  ].filter(Boolean);
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
  const reportFilled = !!qc.reportNo || !!qc.inspectedAt;
  const lotLabel = qc.lotNumber ? `Lot ${qc.lotNumber}` : null;

  return (
    <div className="border border-gray-200 rounded-md mb-2 bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2 flex-wrap">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="font-mono text-sm font-medium">{qc.inspectionNumber}</span>
          {lotLabel && <Badge color="navy">{lotLabel}</Badge>}
          {qc.arrivedQty != null && (
            <span className="text-xs text-gray-600">
              · arrived <span className="font-semibold">{qc.arrivedQty}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {qc.invoiceFileUrl && (
            <a
              href={qc.invoiceFileUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
              title="Open invoice PDF"
            >
              <FileText size={12} /> Invoice
            </a>
          )}
          {qc.lotReportFileUrl && (
            <a
              href={qc.lotReportFileUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline"
              title="Open lot report PDF"
            >
              <FileText size={12} /> Lot Report
            </a>
          )}
          <Badge color={qc.result === 'PASSED' ? 'green' : qc.result === 'FAILED' ? 'red' : qc.result === 'PARTIAL' ? 'navy' : qc.result === 'ON_HOLD' ? 'orange' : 'yellow'}>
            {qc.result}
          </Badge>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-200 p-3 text-xs space-y-3">
          {/* Lot summary — what arrived in THIS lot */}
          {(qc.lotNumber || qc.arrivedQty != null || qc.invoiceFileUrl || qc.lotReportFileUrl || (qc.items && qc.items.length > 0)) && (
            <div className="bg-navy-50/60 border border-navy-200 rounded p-2">
              <div className="font-semibold text-navy-800 mb-1 flex items-center gap-2 flex-wrap">
                {lotLabel || 'Lot'} delivery
                {qc.invoiceFileUrl && (
                  <a
                    href={qc.invoiceFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 hover:underline font-normal"
                  >
                    <FileText size={11} /> Open invoice PDF
                  </a>
                )}
                {qc.lotReportFileUrl && (
                  <a
                    href={qc.lotReportFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-700 hover:underline font-normal"
                  >
                    <FileText size={11} /> Open lot report PDF
                  </a>
                )}
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                <div><span className="text-gray-500">Lot total:</span> <span className="font-medium">{qc.arrivedQty ?? '—'}</span></div>
                <div><span className="text-gray-500">Invoice:</span> {qc.invoiceNo || '—'}</div>
                <div><span className="text-gray-500">Receipt date:</span> {fmt(qc.materialReceiptDate)}</div>
              </div>
              {Array.isArray(qc.items) && qc.items.length > 0 && (
                <table className="w-full mt-2 text-[11px]">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left font-normal">Item</th>
                      <th className="text-right font-normal">Arrived this lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qc.items.map((li) => (
                      <tr key={li.id}>
                        <td>{li.purchaseOrderItem?.productName || '—'}</td>
                        <td className="text-right font-medium">
                          {li.arrivedQty} {li.purchaseOrderItem?.productUnit || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Page 1 — Request details (filled by PO) */}
          <div>
            <div className="font-semibold text-gray-700 mb-1">
              Inspection Request (filled by {qc.requestCreatedBy?.name || 'Purchase'})
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
              <div><span className="text-gray-500">Invoice:</span> {qc.invoiceNo || '—'} · {fmt(qc.invoiceDate)}</div>
              <div><span className="text-gray-500">DC No.:</span> {qc.dcNo || '—'}</div>
              <div><span className="text-gray-500">Gate Pass:</span> {qc.gatePassNo || '—'} {qc.gatePassType ? `(${qc.gatePassType})` : ''}</div>
              <div><span className="text-gray-500">Material Receipt:</span> {fmt(qc.materialReceiptDate)}</div>
              {qc.probableDateOfReturn && (
                <div><span className="text-gray-500">Prob. Return:</span> {fmt(qc.probableDateOfReturn)}</div>
              )}
              {qc.materialCategory && (
                <div><span className="text-gray-500">Material Category:</span> <span className="font-medium">{qc.materialCategory}</span></div>
              )}
            </div>
            {(docs.length > 0 || dims.length > 0) && (
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                {docs.length > 0 && (
                  <div><span className="text-gray-500">Documents required:</span> <span className="font-medium">{docs.join(', ')}</span></div>
                )}
                {dims.length > 0 && (
                  <div><span className="text-gray-500">Dimensional inspection:</span> <span className="font-medium">{dims.join(', ')}</span></div>
                )}
              </div>
            )}
          </div>

          {/* Page 2 — Inspection report (filled by QC) */}
          {reportFilled ? (
            <div className="border-t border-gray-100 pt-2">
              <div className="font-semibold text-gray-700 mb-1">
                Inspection Report (filled by {qc.inspectedBy?.name || 'QC'}{qc.inspectedAt ? ` · ${formatDateTime(qc.inspectedAt)}` : ''})
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                <div><span className="text-gray-500">Report No.:</span> {qc.reportNo || '—'}</div>
                <div><span className="text-gray-500">Report Date:</span> {fmt(qc.reportDate)}</div>
                <div><span className="text-gray-500">Ref. No.:</span> {qc.reportReferenceNo || '—'}</div>
                {qc.materialDescription && (
                  <div className="col-span-3"><span className="text-gray-500">Material:</span> {qc.materialDescription}</div>
                )}
                <div><span className="text-gray-500">Packing:</span> {qc.packingCondition || '—'} {qc.packingDamageNotes ? `· ${qc.packingDamageNotes}` : ''}</div>
                <div><span className="text-gray-500">Batch:</span> {qc.batchNo || '—'}</div>
                <div><span className="text-gray-500">Mfg / Exp:</span> {fmt(qc.dateOfManufacturing)} / {fmt(qc.dateOfExpiry)}</div>
                {qc.tappedHolesCondition && (
                  <div className="col-span-3"><span className="text-gray-500">Tapped holes / weld lugs:</span> {qc.tappedHolesCondition}</div>
                )}
              </div>
              <div className="grid grid-cols-5 gap-2 mt-2 border-t border-gray-100 pt-2">
                <div><div className="text-gray-500">Qty PR</div><div className="font-medium">{qc.qtyAsPerPR ?? '—'}</div></div>
                <div><div className="text-gray-500">Qty Ordered</div><div className="font-medium">{qc.qtyOrdered ?? '—'}</div></div>
                <div><div className="text-gray-500">Qty Received</div><div className="font-medium">{qc.qtyReceived ?? '—'}</div></div>
                <div><div className="text-gray-500">Qty Accepted</div><div className="font-medium text-green-700">{qc.qtyAccepted ?? '—'}</div></div>
                <div><div className="text-gray-500">Qty Rejected</div><div className="font-medium text-red-700">{qc.qtyRejected ?? '—'}</div></div>
              </div>
              {qc.rejectionReason && (
                <div className="mt-2"><span className="text-gray-500">Rejection / non-conformity:</span> {qc.rejectionReason}</div>
              )}
              {qc.remarks && (
                <div className="mt-1"><span className="text-gray-500">Remarks:</span> {qc.remarks}</div>
              )}
              {qc.mirNo && (
                <div className="mt-1"><span className="text-gray-500">MIR No.:</span> <span className="font-medium">{qc.mirNo}</span></div>
              )}
              {Array.isArray(qc.parameters) && qc.parameters.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-500 mb-1">Inspection parameters:</div>
                  <table className="w-full border border-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border border-gray-200 px-2 py-1 text-left">Parameter</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Expected</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Actual</th>
                        <th className="border border-gray-200 px-2 py-1 text-left">Pass</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qc.parameters.map((p, i) => (
                        <tr key={i}>
                          <td className="border border-gray-200 px-2 py-1">{p.name}</td>
                          <td className="border border-gray-200 px-2 py-1">{p.expected}</td>
                          <td className="border border-gray-200 px-2 py-1">{p.actual}</td>
                          <td className="border border-gray-200 px-2 py-1">{p.passed ? '✓' : '✗'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="border-t border-gray-100 pt-2 text-gray-500 italic">
              Awaiting QC to fill the inspection report.
              {qc.pendingReason && (
                <span className="block mt-1 text-orange-700 not-italic">On hold — {qc.pendingReason}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inward Inspection Request Form (RAPS/IIR Rev 01) ───
// Read-only row in the auto-filled details panel
function AutoFillRow({ sno, label, value }) {
  return (
    <div className="grid grid-cols-[40px_1fr_1.5fr] gap-2 px-3 py-2 border-b border-gray-200 last:border-b-0 text-xs items-start">
      <div className="font-bold text-gray-500 text-center">{sno}</div>
      <div className="font-medium text-gray-700">{label}</div>
      <div className="text-gray-900">{value}</div>
    </div>
  );
}

function IIRForm({ order, iir, setIir, lotItems, setLotItems, invoiceFile, setInvoiceFile, lotReportFile, setLotReportFile, processing, onCancel, onSubmit, mode = 'create', editingInspection = null }) {
  const isEdit = mode === 'edit';
  const lotNumber = isEdit ? (editingInspection?.lotNumber || 1) : (order.qcInspections?.length || 0) + 1;
  const cumulativeReceived = (order.items || []).reduce((s, i) => s + (i.receivedQty || 0), 0);
  const totalOrdered = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const lotTotal = lotItems.reduce((s, li) => s + (parseFloat(li.arrivedQty) || 0), 0);

  const prNumber = order.purchaseRequest?.requestNumber
    || (order.sourceRequests || []).map(s => s.purchaseRequest?.requestNumber).filter(Boolean).join(', ')
    || '—';
  const prDate = order.purchaseRequest?.createdAt
    ? new Date(order.purchaseRequest.createdAt).toLocaleDateString('en-IN')
    : '—';
  const poDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-IN')
    : '—';

  const prItemsById = new Map((order.purchaseRequest?.items || []).map(it => [it.id, it]));
  const materialDescription = (order.items || [])
    .map(i => {
      const prItem = prItemsById.get(i.purchaseRequestItemId);
      return `${i.productName}${prItem?.materialSpecification ? ` (${prItem.materialSpecification})` : ''}`;
    })
    .join('; ') || '—';
  const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const qtyText = (order.items || []).map(i => `${i.quantity} ${i.productUnit || ''}`).join(', ');
  const scopeOfWork = order.customName || materialDescription;
  const isReturnable = iir.gatePassType === 'Returnable';

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded shadow-sm p-4 overflow-y-auto max-h-[80vh]">
        {/* Letterhead header */}
        <div className="border border-gray-400 rounded-md overflow-hidden mb-4">
          <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-400">
            <div className="p-3 border-r border-gray-400 flex items-center justify-center font-bold text-xl">RAPS</div>
            <div className="p-3 border-r border-gray-400 flex flex-col items-center justify-center text-center font-bold text-sm">
              <span>INWARD INSPECTION</span>
              <span>REQUEST FORM</span>
            </div>
            <div className="p-3 text-xs leading-tight">
              <div><strong>Form no.:</strong> RAPS/IIR Rev 01</div>
              <div><strong>Dt:</strong> 01/09/2024</div>
            </div>
          </div>
          <div className="px-3 py-2 text-xs bg-white flex flex-wrap gap-x-4 items-center">
            <div><strong>ION No. & Date:</strong> <span className="text-blue-700">Auto-generated on submit</span></div>
            <div className="text-gray-500 italic">Format: QC/DDMMYY/N · today {new Date().toLocaleDateString('en-IN')}</div>
          </div>
        </div>

        {/* BATCH NUMBER */}
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 mb-6 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="flex-1">
              <label className="block text-xs font-black text-amber-900 uppercase tracking-tighter mb-1">
                Batch/Lot Identifier {isEdit ? '(Editable until QC submits)' : '(Locked after submit)'} <span className="text-red-600">*</span>
              </label>
              <p className="text-[11px] text-amber-800 leading-tight mb-3">
                {isEdit
                  ? 'You can still adjust this batch number until QC submits the result. After that the value is frozen everywhere downstream.'
                  : <>This batch number is <strong>immutable</strong> after submission. It propagates through QC, Inward Entry, MIV, and the final Product Batch list for traceability.</>
                }
              </p>
              <input
                type="text"
                required
                value={iir.batchNumber}
                onChange={(e) => setIir({ ...iir, batchNumber: e.target.value })}
                placeholder="e.g. LOT-2024-001"
                className="w-full max-w-sm px-3 py-2 border-2 border-amber-400 rounded-md text-sm font-mono font-bold bg-white focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
            <div className="text-right whitespace-nowrap">
              <div className="text-[10px] font-bold text-amber-600 uppercase">Tracking Status</div>
              <div className="text-3xl font-black text-amber-900">Lot {lotNumber}</div>
              <div className="text-xs font-medium text-amber-800">
                {cumulativeReceived > 0 ? `${cumulativeReceived} of ${totalOrdered} received` : `First lot of ${totalOrdered}`}
              </div>
            </div>
          </div>
        </div>

        {/* AUTO-FILLED DETAILS (paper form items 1–10) */}
        <div className="border border-gray-300 rounded-md mb-6 overflow-hidden">
          <div className="bg-blue-50 px-3 py-2 border-b border-gray-300 flex items-center justify-between">
            <div className="text-xs font-bold uppercase text-blue-900">Auto-filled from Purchase Order</div>
            <div className="text-[10px] italic text-blue-700">Read-only — pulled from PR & PO records</div>
          </div>
          <div className="bg-white">
            <AutoFillRow sno="01" label="PR No. & Date" value={<span><span className="font-semibold">{prNumber}</span> · {prDate}</span>} />
            <AutoFillRow sno="02" label="Material Description" value={materialDescription} />
            <AutoFillRow sno="03" label="Qty as per PR" value={qtyText || totalQty} />
            <AutoFillRow sno="04" label="Supplier Details" value={order.supplierName || '—'} />
            <AutoFillRow sno="05" label="Quote Details" value={order.quotation?.quotationNumber || '—'} />
            <AutoFillRow sno="06" label="Assessment Status of Supplier" value={<span className="italic text-gray-500">Verified by Purchase</span>} />
            <AutoFillRow sno="07" label="PO No. & Date" value={<span><span className="font-semibold">{order.orderNumber}</span> · {poDate}</span>} />
            <AutoFillRow sno="08" label="Qty as per PO" value={qtyText || totalQty} />
            <AutoFillRow sno="09" label="Delivery Required by" value={<span className="italic text-gray-500">As per PO Terms</span>} />
            <AutoFillRow sno="10" label="Purpose / Scope of Supply" value={scopeOfWork} />
          </div>
        </div>

        {/* PURCHASE OFFICER INPUTS (paper form items 11–16) */}
        <div className="border-2 border-blue-300 rounded-md mb-6 overflow-hidden shadow-sm">
          <div className="bg-blue-100 px-3 py-2 border-b border-blue-300">
            <div className="text-xs font-bold uppercase text-blue-900">To be filled by Purchase Officer</div>
            <div className="text-[10px] italic text-blue-800">Items 11–16 of the IIR form</div>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-white">
            <div>
              <label className="block text-xs font-bold mb-1">
                11. Invoice No. {!isEdit && <span className="text-red-500">*</span>}
                {isEdit && <span className="text-gray-400 font-normal"> (locked)</span>}
              </label>
              <input
                type="text"
                value={iir.invoiceNo}
                onChange={e => setIir({ ...iir, invoiceNo: e.target.value })}
                placeholder="Invoice No."
                disabled={isEdit}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-300 outline-none disabled:bg-gray-100 disabled:text-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">
                11. Invoice Date {!isEdit && <span className="text-red-500">*</span>}
                {isEdit && <span className="text-gray-400 font-normal"> (locked)</span>}
              </label>
              <input
                type="date"
                value={iir.invoiceDate}
                onChange={e => setIir({ ...iir, invoiceDate: e.target.value })}
                disabled={isEdit}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-300 outline-none disabled:bg-gray-100 disabled:text-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">12. DC No. <span className="text-gray-400 font-normal">(if any)</span></label>
              <input
                type="text"
                value={iir.dcNo}
                onChange={e => setIir({ ...iir, dcNo: e.target.value })}
                placeholder="DC No."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">13. Gate Pass No. <span className="text-gray-400 font-normal">(if any)</span></label>
              <input
                type="text"
                value={iir.gatePassNo}
                onChange={e => setIir({ ...iir, gatePassNo: e.target.value })}
                placeholder="Gate Pass No."
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <div className="text-xs font-bold mb-1">14. Gate Pass Type</div>
              <div className="flex gap-6 text-xs font-medium">
                {['Returnable', 'Non-Returnable'].map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="gatePassType"
                      checked={iir.gatePassType === t}
                      onChange={() => setIir({ ...iir, gatePassType: t, probableDateOfReturn: t === 'Returnable' ? iir.probableDateOfReturn : '' })}
                    />
                    {t}
                  </label>
                ))}
                {iir.gatePassType && (
                  <button
                    type="button"
                    onClick={() => setIir({ ...iir, gatePassType: '', probableDateOfReturn: '' })}
                    className="text-[10px] text-gray-500 hover:text-red-600 underline"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">
                15. Probable Date of Return {isReturnable ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">(only for Returnable)</span>}
              </label>
              <input
                type="date"
                value={iir.probableDateOfReturn}
                disabled={!isReturnable}
                onChange={e => setIir({ ...iir, probableDateOfReturn: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm disabled:bg-gray-50 disabled:text-gray-400 focus:ring-2 focus:ring-blue-300 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">16. Material Receipt Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={iir.materialReceiptDate}
                onChange={e => setIir({ ...iir, materialReceiptDate: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-300 outline-none"
              />
            </div>
          </div>
        </div>

        {/* INSPECTION CATEGORY & SCOPE */}
        <div className="border border-gray-300 rounded mb-6 overflow-hidden">
          <div className="bg-gray-100 p-2 font-bold text-xs uppercase border-b border-gray-300">Inspection Category & Scope</div>
          <div className="p-4 space-y-5 bg-white">
            <div>
              <div className="text-xs font-bold mb-2">Material Category</div>
              <div className="flex items-center gap-2">
                <span className="inline-block px-2.5 py-1 rounded border border-gray-300 bg-gray-50 text-xs font-medium text-gray-800">
                  {iir.materialCategory || <span className="italic text-gray-400 font-normal">Not set on PR</span>}
                </span>
                <span className="text-[10px] text-gray-400 italic">Carried over from the purchase request — set at PR creation.</span>
              </div>
            </div>

            <div>
              <div className="text-xs font-bold mb-1">Documents Available with the Lot</div>
              <div className="text-[10px] text-gray-500 mb-2 italic">Tick whichever supplier-issued documents are attached with this delivery.</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {[
                  { k: 'testReport', l: 'Test Report' },
                  { k: 'coc', l: 'COC (Certificate of Conformance)' },
                  { k: 'coa', l: 'COA (Certificate of Analysis)' },
                ].map(opt => (
                  <label key={opt.k} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!iir.documentTypes?.[opt.k]}
                      onChange={e => setIir({ ...iir, documentTypes: { ...iir.documentTypes, [opt.k]: e.target.checked } })}
                    />
                    {opt.l}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold mb-1">Dimensional / Functional Inspection Scope</div>
              <div className="text-[10px] text-gray-500 mb-2 italic">Where should the inspection be carried out? Tick all that apply.</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {[
                  { k: 'dimInspAtSupplier', l: 'Inspection at Supplier Premises' },
                  { k: 'dimInspAtRapsInward', l: 'Inspection at RAPS Inward' },
                  { k: 'thirdParty', l: 'Third Party Inspection' },
                ].map(opt => (
                  <label key={opt.k} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!iir.documentTypes?.[opt.k]}
                      onChange={e => setIir({ ...iir, documentTypes: { ...iir.documentTypes, [opt.k]: e.target.checked } })}
                    />
                    {opt.l}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Quantities Table - Partial delivery (lot items locked in edit mode) */}
        <div className="border border-amber-300 rounded mb-6 overflow-hidden shadow-sm">
          <div className="bg-amber-100 p-2 font-bold text-[10px] uppercase text-amber-900 border-b border-amber-300 flex justify-between">
            <span>Lot Itemization — Physical Arrival{isEdit ? ' (Locked)' : ''}</span>
            <span>Lot Total: {isEdit ? (editingInspection?.arrivedQty ?? lotTotal) : lotTotal}</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-amber-50 font-bold border-b border-amber-200">
              <tr>
                <th className="p-2 text-left">Item Name</th>
                <th className="p-2 text-right">Ordered</th>
                <th className="p-2 text-right">Remaining</th>
                <th className="p-2 text-right w-32">Arrived Now *</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {(order.items || []).map(it => {
                const already = it.receivedQty || 0;
                const rem = Math.max(0, it.quantity - already);
                const row = lotItems.find(r => r.poItemId === it.id) || { arrivedQty: '' };
                // In edit mode, show the qty that arrived in THIS lot (from inspection.items), not remaining.
                const editLotQty = isEdit
                  ? (editingInspection?.items || []).find(i => i.purchaseOrderItemId === it.id)?.arrivedQty ?? 0
                  : null;
                return (
                  <tr key={it.id}>
                    <td className="p-2 font-medium">{it.productName}</td>
                    <td className="p-2 text-right">{it.quantity}</td>
                    <td className="p-2 text-right text-amber-600 font-bold">{rem}</td>
                    <td className="p-2 text-right">
                      {isEdit ? (
                        <span className="font-mono text-gray-700">{editLotQty}</span>
                      ) : (
                        <input
                          type="number" step="any" min="0" max={rem} placeholder="0"
                          value={row.arrivedQty}
                          disabled={rem <= 0}
                          onChange={e => {
                            const next = lotItems.map(r => r.poItemId === it.id ? {...r, arrivedQty: e.target.value} : r);
                            if (!lotItems.some(r => r.poItemId === it.id)) next.push({ poItemId: it.id, arrivedQty: e.target.value });
                            setLotItems(next);
                          }}
                          className="w-24 p-1 border border-gray-300 rounded text-right"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Invoice File */}
        <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
          <div className="text-xs font-bold text-blue-900 mb-2">
            Supporting Invoice PDF {isEdit ? <span className="text-gray-500 font-normal">(locked — uploaded at goods-arrival)</span> : <span className="text-red-500">*</span>}
          </div>
          {isEdit ? (
            editingInspection?.invoiceFileUrl ? (
              <div className="text-[11px] text-blue-800">
                <a href={editingInspection.invoiceFileUrl} target="_blank" rel="noreferrer" className="underline">view invoice on file</a>
              </div>
            ) : (
              <div className="text-[11px] text-gray-500 italic">No invoice on file.</div>
            )
          ) : (
            <>
              <input type="file" accept=".pdf" onChange={e => setInvoiceFile(e.target.files?.[0] || null)} className="text-xs" />
              {invoiceFile && <div className="mt-1 text-[10px] text-green-700 font-bold">✓ {invoiceFile.name}</div>}
            </>
          )}
        </div>

        {/* Lot Report File (supplier test report / COA / COC) */}
        <div className="bg-indigo-50 border border-indigo-200 rounded p-4 mb-4">
          <div className="text-xs font-bold text-indigo-900 mb-2">
            Lot Report PDF <span className="text-gray-500 font-normal">(test report / COA / COC / mill cert — optional but recommended)</span>
            {isEdit && <span className="text-gray-500 font-normal"> (locked — uploaded at goods-arrival)</span>}
          </div>
          {isEdit ? (
            editingInspection?.lotReportFileUrl ? (
              <div className="text-[11px] text-indigo-800">
                <a href={editingInspection.lotReportFileUrl} target="_blank" rel="noreferrer" className="underline">view lot report on file</a>
              </div>
            ) : (
              <div className="text-[11px] text-gray-500 italic">No lot report on file.</div>
            )
          ) : (
            <>
              <input type="file" accept=".pdf" onChange={e => setLotReportFile(e.target.files?.[0] || null)} className="text-xs" />
              {lotReportFile && <div className="mt-1 text-[10px] text-green-700 font-bold">✓ {lotReportFile.name}</div>}
            </>
          )}
        </div>

        <div className="text-[10px] text-gray-500 italic pb-2 text-center">
          {isEdit
            ? 'Edits are logged. QC will see the updated form on their next view.'
            : `Digitally signed on submission by ${order.createdBy?.name || 'Authorized Personnel'}. IIR created auto-notifies QC group.`}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-white p-2">
        <Button variant="secondary" onClick={onCancel} disabled={processing}>Cancel</Button>
        <Button onClick={onSubmit} disabled={processing}>
          {processing
            ? (isEdit ? 'Saving Changes...' : 'Creating IIR Request...')
            : (isEdit ? 'Save IIR Changes' : 'Submit Arrival & Notify QC')}
        </Button>
      </div>
    </div>
  );
}

// ─── Order Detail Modal ───
function OrderDetailModal({ order, onClose, onUpdated, userRole }) {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState('ADVANCE');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [delayAcknowledged, setDelayAcknowledged] = useState(false);
  const [delayNote, setDelayNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [inwardItems, setInwardItems] = useState([]);
  const [prQuotations, setPrQuotations] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [creditNote, setCreditNote] = useState('');
  const [showIirForm, setShowIirForm] = useState(false);
  const [iirMode, setIirMode] = useState('create'); // 'create' | 'edit'
  const [editingInspection, setEditingInspection] = useState(null);
  const [lotItems, setLotItems] = useState([]);
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [lotReportFile, setLotReportFile] = useState(null);
  // Close-PO confirmation: when the server returns 409 with the pending list
  // we surface this dialog so the PO can review and choose to force-close.
  const [closePending, setClosePending] = useState(null);
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [iir, setIir] = useState({
    batchNumber: '',
    invoiceNo: '',
    invoiceDate: '',
    dcNo: '',
    gatePassNo: '',
    gatePassType: '',
    probableDateOfReturn: '',
    materialReceiptDate: '',
    materialCategory: '',
    documentTypes: {
      testReport: false,
      coc: false,
      coa: false,
      thirdParty: false,
      dimInspAtSupplier: false,
      dimInspAtRapsInward: false,
    },
  });

  const isPO = userRole === 'PURCHASE_OFFICER';
  const isSM = userRole === 'STORE_MANAGER' || userRole === 'ADMIN';

  // Signed PO PDF upload / replace / delete (Purchase Officer only).
  const [uploadingPo, setUploadingPo] = useState(false);
  const poFileInputRef = useRef(null);

  const uploadPoDocument = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      return alert('Only PDF files are accepted for the PO document.');
    }
    if (order.poDocumentUrl && !confirm('Replace the existing PO PDF? The previous file will be removed.')) {
      if (poFileInputRef.current) poFileInputRef.current.value = '';
      return;
    }
    setUploadingPo(true);
    try {
      const fd = new FormData();
      fd.append('poDocument', file);
      const { data } = await api.post(`/purchase-orders/${order.id}/po-document`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Object.assign(order, data);
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to upload PO document');
    } finally {
      setUploadingPo(false);
      if (poFileInputRef.current) poFileInputRef.current.value = '';
    }
  };

  const deletePoDocument = async () => {
    if (!order.poDocumentUrl) return;
    if (!confirm('Delete the uploaded PO PDF? This removes the file from the system. You can upload a new one afterwards.')) return;
    setUploadingPo(true);
    try {
      const { data } = await api.delete(`/purchase-orders/${order.id}/po-document`);
      Object.assign(order, data);
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete PO document');
    } finally {
      setUploadingPo(false);
    }
  };

  useEffect(() => {
    if (order) {
      // Default to remaining qty for each item (supports partial deliveries)
      setInwardItems(order.items?.map(i => ({
        id: i.id,
        receivedQty: Math.max(0, i.quantity - (i.receivedQty || 0)),
      })) || []);
      setPaymentType(order.status === 'PENDING_ACCOUNTING' ? 'ADVANCE' : 'PARTIAL');
      const prId = order.purchaseRequest?.id || order.purchaseRequestId;
      if (prId) {
        setLoadingHistory(true);
        api.get('/quotations', { params: { purchaseRequestId: prId, limit: 50 } })
          .then(({ data }) => setPrQuotations(data.quotations || []))
          .catch(() => setPrQuotations([]))
          .finally(() => setLoadingHistory(false));
      } else {
        setPrQuotations([]);
      }
    }
  }, [order]);

  const supplierFromQuotation = useMemo(() => {
    if (!order || !prQuotations.length) return null;
    const selected = prQuotations.find(q => q.isSelected);
    if (!selected) return null;
    const item = (selected.items || []).find(
      i => (i.supplierName || '').trim().toLowerCase() === (order.supplierName || '').trim().toLowerCase()
    );
    return item ? { contact: item.supplierContact, address: item.supplierAddress } : null;
  }, [prQuotations, order]);

  if (!order) return null;

  const remaining = order.totalAmount - order.totalPaid;
  const isPendingAccounting = order.status === 'PENDING_ACCOUNTING';
  const isCreditPlaced = order.status === 'CREDIT_PLACED';

  // Phase 2: detect placement delay vs PR creation
  const prCreatedAt = order?.purchaseRequest?.createdAt || order?.sourceRequests?.[0]?.purchaseRequest?.createdAt;
  const daysSincePr = prCreatedAt
    ? Math.floor((Date.now() - new Date(prCreatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const isDelayed = daysSincePr >= 3;

  const placeOrder = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) return alert('Enter the payment amount.');
    if (isDelayed && delayAcknowledged && !delayNote.trim()) {
      return alert('Please write a brief reason for the delay before placing the order.');
    }
    if (!confirm(`Send ${paymentType} payment request of ₹${parseFloat(paymentAmount).toLocaleString('en-IN')} to Accounting?`)) return;
    setProcessing(true);
    try {
      await api.post(`/purchase-orders/${order.id}/place-order`, {
        paymentType,
        amount: parseFloat(paymentAmount),
        notes: paymentNotes || undefined,
        delayNote: isDelayed && delayAcknowledged ? delayNote.trim() : undefined,
      });
      setShowPaymentForm(false);
      setPaymentAmount('');
      setPaymentNotes('');
      setDelayNote('');
      setDelayAcknowledged(false);
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to place order');
    }
    setProcessing(false);
  };

  const placeOnCredit = async () => {
    const note = creditNote.trim();
    if (!confirm(
      `Place this order on credit with ${order.supplierName}?\n\n` +
      `The order will move forward immediately. ` +
      `You'll still need to raise a Payment Request afterwards for Accounting to process.`
    )) return;
    setProcessing(true);
    try {
      await api.put(`/purchase-orders/${order.id}/place-on-credit`, {
        creditNote: note || undefined,
      });
      setShowCreditForm(false);
      setCreditNote('');
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to place order on credit');
    }
    setProcessing(false);
  };

  const updateItemStatus = async (itemId, itemStatus) => {
    try {
      await api.put(`/purchase-orders/${order.id}/items/${itemId}/status`, { itemStatus });
      const { data } = await api.get(`/purchase-orders/${order.id}`);
      onUpdated();
      Object.assign(order, data);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update item status');
    }
  };

  const openIirForm = () => {
    const today = new Date().toISOString().slice(0, 10);
    // Suggest the next sequential batch identifier: <PO>-B<n> where n is the next lot
    // number. PO can override freely; uniqueness per PO is enforced server-side.
    const nextLotNo = (order.qcInspections?.length || 0) + 1;
    const suggestedBatch = `${order.orderNumber || 'PO'}-B${nextLotNo}`;
    setIir({
      batchNumber: suggestedBatch,
      invoiceNo: '',
      invoiceDate: today,
      dcNo: '',
      gatePassNo: '',
      gatePassType: '',
      probableDateOfReturn: '',
      materialReceiptDate: today,
      // Carried over from the PR — stores don't re-select it.
      materialCategory: derivePRMaterialCategory(order),
      documentTypes: {
        testReport: false,
        coc: false,
        coa: false,
        thirdParty: false,
        dimInspAtSupplier: false,
        dimInspAtRapsInward: false,
      },
    });
    // Pre-populate one row per PO item, defaulting arrivedQty to the remaining qty
    // (so a "full delivery" can be submitted with one click).
    setLotItems(
      (order.items || []).map((it) => ({
        poItemId: it.id,
        arrivedQty: Math.max(0, it.quantity - (it.receivedQty || 0)) || '',
      }))
    );
    setInvoiceFile(null);
    setLotReportFile(null);
    setIirMode('create');
    setEditingInspection(null);
    setShowIirForm(true);
  };

  // Open the IIR form pre-filled for editing the most recent pending/on-hold inspection.
  const openEditIirForm = () => {
    const pending = (order.qcInspections || [])
      .filter(q => q.result === 'PENDING' || q.result === 'ON_HOLD')
      .sort((a, b) => (b.lotNumber || 0) - (a.lotNumber || 0))[0];
    if (!pending) return alert('No editable IIR found — QC has already submitted for every lot.');
    const toDateStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    setIir({
      batchNumber: pending.batchNo || '',
      invoiceNo: pending.invoiceNo || '',
      invoiceDate: toDateStr(pending.invoiceDate),
      dcNo: pending.dcNo || '',
      gatePassNo: pending.gatePassNo || '',
      gatePassType: pending.gatePassType || '',
      probableDateOfReturn: toDateStr(pending.probableDateOfReturn),
      materialReceiptDate: toDateStr(pending.materialReceiptDate),
      materialCategory: derivePRMaterialCategory(order) || pending.materialCategory || '',
      documentTypes: pending.documentTypes || {
        testReport: false, coc: false, coa: false, thirdParty: false,
        dimInspAtSupplier: false, dimInspAtRapsInward: false,
      },
    });
    setLotItems([]); // not editable in edit mode
    setInvoiceFile(null);
    setLotReportFile(null);
    setEditingInspection(pending);
    setIirMode('edit');
    setShowIirForm(true);
  };

  const submitIir = async () => {
    if (!iir.batchNumber.trim()) return alert('Batch number is required — it is locked to this lot for inspection, inward, and the product list.');
    if (!iir.materialReceiptDate) return alert('Material receipt date is required.');
    // Material category is auto-carried from the PR, not picked here.
    if (iir.gatePassType === 'Returnable' && !iir.probableDateOfReturn) {
      return alert('Probable date of return is required when the gate pass is Returnable.');
    }

    const isEdit = iirMode === 'edit';

    if (!isEdit) {
      if (!iir.invoiceNo.trim()) return alert('Invoice no. is required.');
      if (!iir.invoiceDate) return alert('Invoice date is required.');
    }

    // Lot items + invoice file only apply when creating a fresh IIR.
    let arrivedItems = [];
    if (!isEdit) {
      arrivedItems = lotItems
        .map((r) => ({ poItemId: r.poItemId, arrivedQty: parseFloat(r.arrivedQty) || 0 }))
        .filter((r) => r.arrivedQty > 0);
      if (arrivedItems.length === 0) {
        return alert('Enter the arrived quantity for at least one item in this lot.');
      }
      for (const r of arrivedItems) {
        const it = order.items.find((i) => i.id === r.poItemId);
        if (!it) continue;
        const remaining = Math.max(0, it.quantity - (it.receivedQty || 0));
        if (r.arrivedQty > remaining + 0.0001) {
          return alert(`Arrived qty for "${it.productName}" exceeds remaining (${remaining}).`);
        }
      }
      if (!invoiceFile) return alert('Please upload the invoice PDF for this lot.');
    }

    setProcessing(true);
    try {
      const fd = new FormData();
      fd.append('batchNumber', (iir.batchNumber || '').trim());
      if (!isEdit) {
        fd.append('invoiceNo', (iir.invoiceNo || '').trim());
        fd.append('invoiceDate', iir.invoiceDate || '');
      }
      if (iir.dcNo?.trim()) fd.append('dcNo', iir.dcNo.trim());
      if (iir.gatePassNo?.trim()) fd.append('gatePassNo', iir.gatePassNo.trim());
      if (iir.gatePassType) fd.append('gatePassType', iir.gatePassType);
      if (iir.probableDateOfReturn) fd.append('probableDateOfReturn', iir.probableDateOfReturn);
      fd.append('materialReceiptDate', iir.materialReceiptDate || '');
      fd.append('materialCategory', iir.materialCategory || '');
      fd.append('documentTypes', JSON.stringify(iir.documentTypes || {}));
      if (!isEdit) {
        fd.append('items', JSON.stringify(arrivedItems));
        if (invoiceFile) fd.append('invoiceFile', invoiceFile);
        if (lotReportFile) fd.append('lotReportFile', lotReportFile);
      }

      const url = isEdit
        ? `/qc-inspections/${editingInspection.id}/iir`
        : `/purchase-orders/${order.id}/goods-arrived`;
      await api.put(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setShowIirForm(false);
      onClose();
      onUpdated();
    } catch (err) {
      console.error('SUBMIT_IIR_FAILED:', err.response?.data || err.message);
      const serverErr = err.response?.data?.error;
      const serverDetails = err.response?.data?.details;
      let msg = serverErr || 'Failed to submit goods arrived';
      if (serverDetails && Array.isArray(serverDetails)) {
        msg += '\n' + serverDetails.map(d => `- ${d.path.join('.')}: ${d.message}`).join('\n');
      }
      alert(msg);
    } finally {
      setProcessing(false);
    }
  };

  const requestPayment = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) return alert('Enter a valid amount');
    setProcessing(true);
    try {
      await api.post('/payment-requests', {
        purchaseOrderId: order.id,
        amount: parseFloat(paymentAmount),
        paymentType,
        notes: paymentNotes || undefined,
      });
      setShowPaymentForm(false);
      setPaymentAmount('');
      setPaymentNotes('');
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
    setProcessing(false);
  };

  const doInward = async () => {
    if (!confirm('Record inward entry for all items?')) return;
    setProcessing(true);
    try {
      await api.put(`/purchase-orders/${order.id}/inward`, { items: inwardItems });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
    setProcessing(false);
  };

  // PO clicks "Close PO". First attempt — let the server decide if it's complete.
  // If it returns 409 with the pending list, surface the confirm dialog so the
  // PO can review and choose to force-close.
  const attemptClose = async () => {
    setClosing(true);
    try {
      await api.post(`/purchase-orders/${order.id}/close`, {});
      onClose();
      onUpdated();
    } catch (err) {
      if (err.response?.status === 409 && err.response.data) {
        setClosePending(err.response.data);
      } else {
        alert(err.response?.data?.error || 'Failed to close PO');
      }
    }
    setClosing(false);
  };

  const forceClose = async () => {
    setClosing(true);
    try {
      await api.post(`/purchase-orders/${order.id}/close`, {
        force: true,
        reason: closeReason.trim() || undefined,
      });
      setClosePending(null);
      setCloseReason('');
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to force-close PO');
    }
    setClosing(false);
  };

  return (
    <Modal isOpen={!!order} onClose={onClose} title={`Order: ${order.customName}`} size="xl">
      <div className="space-y-4">
        <div className="bg-navy-50 border border-navy-200 rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-navy-600 font-medium">Order Name (set by unit manager on the PR)</div>
          <div className="text-xl font-bold text-navy-700">{order.customName}</div>
        </div>

        {/* Closed-PO banner — terminal state, surfaces who closed and why */}
        {(order.status === 'CLOSED' || order.status === 'COMPLETED') && order.closedAt && (
          <div className={`border-l-4 rounded-md p-3 flex items-start gap-2 ${
            order.forceClosed
              ? 'bg-red-50 border-red-500'
              : 'bg-green-50 border-green-500'
          }`}>
            <XCircle size={18} className={`mt-0.5 shrink-0 ${order.forceClosed ? 'text-red-700' : 'text-green-700'}`} />
            <div className="flex-1 text-sm">
              <div className={`font-bold ${order.forceClosed ? 'text-red-900' : 'text-green-900'}`}>
                {order.forceClosed ? 'PO Force-Closed' : 'PO Closed'}
              </div>
              <div className={order.forceClosed ? 'text-red-800 text-xs' : 'text-green-800 text-xs'}>
                {order.closedBy?.name && <>Closed by <span className="font-semibold">{order.closedBy.name}</span> </>}
                on {formatDateTime(order.closedAt)}.
                {order.forceClosed && <> Leftover quantities were cancelled on the originating PR.</>}
              </div>
              {order.closeReason && (
                <div className={`mt-1 italic ${order.forceClosed ? 'text-red-900' : 'text-green-900'} text-xs`}>
                  Reason: {order.closeReason}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Awaiting Accounting banner — visible to everyone viewing the order */}
        {isPendingAccounting && (
          <div className="bg-amber-50 border-l-4 border-amber-500 rounded-md p-3 flex items-start gap-2">
            <Clock size={18} className="text-amber-700 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-bold text-amber-900">Awaiting Accounting</div>
              <div className="text-xs text-amber-800">
                Work is currently stopped at the Accounts team. The order will move forward once accounting processes the payment.
              </div>
            </div>
          </div>
        )}

        {/* Credit-placed banner — order is live, payment is still owed */}
        {isCreditPlaced && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-md p-3 flex items-start gap-2">
            <Handshake size={18} className="text-orange-700 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-orange-900">Order Placed on Credit — Payment Pending</div>
              <div className="text-xs text-orange-800">
                {order.creditPlacedBy?.name
                  ? <>Placed on credit by <span className="font-semibold">{order.creditPlacedBy.name}</span></>
                  : 'Placed on credit'}
                {order.creditPlacedAt && <> on {formatDateTime(order.creditPlacedAt)}</>}.
                {' '}The order is being processed. Outstanding balance:{' '}
                <span className="font-semibold">{formatCurrency(remaining)}</span>.
                Raise a Payment Request below so Accounting can settle.
              </div>
              {order.creditNote && (
                <div className="mt-1 text-xs text-orange-900 italic">
                  Note: {order.creditNote}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Persistent credit marker for any order that began on credit, even after PAID */}
        {!isCreditPlaced && order.isCreditOrder && (
          <div className="bg-orange-50/60 border border-orange-200 rounded-md p-2 flex items-start gap-2 text-xs">
            <Handshake size={14} className="text-orange-600 mt-0.5 shrink-0" />
            <div className="text-orange-900">
              This order was originally placed on credit
              {order.creditPlacedBy?.name && <> by {order.creditPlacedBy.name}</>}
              {order.creditPlacedAt && <> on {formatDateTime(order.creditPlacedAt)}</>}.
              {order.creditNote && <> Note: <span className="italic">{order.creditNote}</span></>}
            </div>
          </div>
        )}

        {/* Header Info */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-md p-4">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Order #:</span> <span className="font-medium">{order.orderNumber}</span>
            {order.isUnion && <Badge color="purple"><Layers size={10} className="inline mr-0.5" /> UNION</Badge>}
          </div>
          <div><span className="text-gray-500">Supplier:</span> <span className="font-medium">{order.supplierName}</span></div>
          <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(order.status)}>{statusLabel(order.status)}</Badge></div>
          <div><span className="text-gray-500">Total:</span> <span className="font-bold text-navy-700">{formatCurrency(order.totalAmount)}</span></div>
          {order.isUnion ? (
            <div className="col-span-2 md:col-span-2">
              <span className="text-gray-500">Source PRs:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {(order.sourceRequests || []).map(s => (
                  <Badge key={s.id} color="navy">
                    {s.purchaseRequest?.requestNumber} · {s.purchaseRequest?.unit?.code || s.purchaseRequest?.unit?.name}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div><span className="text-gray-500">PR:</span> <span className="font-medium">{order.purchaseRequest?.requestNumber}</span></div>
              <div><span className="text-gray-500">Manager:</span> <span>{order.purchaseRequest?.manager?.name}</span></div>
            </>
          )}
        </div>

        {order.delayNote && (
          <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-sm">
            <div className="text-xs font-semibold text-orange-900 uppercase tracking-wide mb-1">Order Placement Delay Note</div>
            <div className="text-gray-700">{order.delayNote}</div>
          </div>
        )}
        {order.mirNo && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 text-sm">
            <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">MIR No: </span>
            <span className="font-mono font-bold text-emerald-700">{order.mirNo}</span>
          </div>
        )}

        {/* Supplier contact (for accounting) */}
        {supplierFromQuotation && (supplierFromQuotation.contact || supplierFromQuotation.address) && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <h4 className="text-xs font-semibold text-amber-900 mb-1 uppercase tracking-wide">Supplier Contact (for Accounting)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2"><Building2 size={14} className="text-amber-700" /><span className="font-medium">{order.supplierName}</span></div>
              {supplierFromQuotation.contact && (
                <div className="flex items-center gap-2"><Phone size={14} className="text-amber-700" /><span>{supplierFromQuotation.contact}</span></div>
              )}
              {supplierFromQuotation.address && (
                <div className="md:col-span-2 text-gray-700 text-xs">{supplierFromQuotation.address}</div>
              )}
            </div>
          </div>
        )}

        {/* Signed PO PDF — uploaded by Purchase Officer after the quotation is approved.
            Anyone in the chain can open it; only PO can upload/replace/delete. */}
        <div className="border border-navy-200 bg-navy-50/40 rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-semibold text-navy-900 flex items-center gap-1">
              <FileText size={14} /> Signed Purchase Order (PDF)
            </h4>
            {order.poDocumentUrl ? (
              <span className="text-xs text-green-700 font-medium">Uploaded</span>
            ) : (
              <span className="text-xs text-gray-500">{isPO ? 'Not uploaded yet' : 'Awaiting Purchase Officer upload'}</span>
            )}
          </div>

          {order.poDocumentUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href={order.poDocumentUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-blue-300 bg-blue-50 text-blue-800 text-xs font-medium hover:bg-blue-100">
                <Eye size={14} /> View PO PDF
              </a>
              {isPO && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => poFileInputRef.current?.click()} disabled={uploadingPo}>
                    <Upload size={14} className="mr-1" /> Replace
                  </Button>
                  <Button size="sm" variant="danger" onClick={deletePoDocument} disabled={uploadingPo}>
                    <Trash2 size={14} className="mr-1" /> Delete
                  </Button>
                </>
              )}
            </div>
          ) : (
            isPO ? (
              <div className="space-y-1">
                <p className="text-xs text-gray-600">
                  Upload the final signed PO PDF. Until uploaded, no one (including QC) can see the PO document.
                </p>
                <Button size="sm" onClick={() => poFileInputRef.current?.click()} disabled={uploadingPo}>
                  <Upload size={14} className="mr-1" /> {uploadingPo ? 'Uploading...' : 'Upload PO PDF'}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-gray-500">The Purchase Officer will upload the signed PO here once the quotation is approved.</p>
            )
          )}

          {isPO && (
            <input
              ref={poFileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => uploadPoDocument(e.target.files?.[0] || null)}
            />
          )}
        </div>

        {/* Payment Progress */}
        <div className="bg-blue-50 rounded-md p-3">
          <ProgressBar value={order.totalPaid} total={order.totalAmount} label={`Paid: ${formatCurrency(order.totalPaid)} / ${formatCurrency(order.totalAmount)}`} />
          {order.advancePaid > 0 && <p className="text-xs text-blue-600 mt-1">Advance: {formatCurrency(order.advancePaid)}</p>}
          {remaining > 0 && <p className="text-xs text-red-600 mt-1">Remaining: {formatCurrency(remaining)}</p>}
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Materials in this order</h4>
            {(() => {
              const totalOrdered = (order.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
              const totalReceived = (order.items || []).reduce((s, it) => s + (it.receivedQty || 0), 0);
              if (totalOrdered <= 0 || totalReceived <= 0) return null;
              const fullyReceived = totalReceived >= totalOrdered;
              const pct = Math.round((totalReceived / totalOrdered) * 100);
              const shortItems = (order.items || []).filter(it => (it.receivedQty || 0) < it.quantity && (it.receivedQty || 0) > 0).length;
              const pendingItems = (order.items || []).filter(it => (it.receivedQty || 0) === 0 && it.itemStatus !== 'CANCELLED').length;
              return (
                <div className={`flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded ${
                  fullyReceived ? 'bg-green-50 text-green-800 border border-green-300'
                  : 'bg-amber-50 text-amber-800 border border-amber-300'
                }`}>
                  <span>{totalReceived} of {totalOrdered} {fullyReceived ? '✓ fully arrived' : `arrived (${pct}%)`}</span>
                  {!fullyReceived && (pendingItems > 0 || shortItems > 0) && (
                    <span className="text-[10px] text-amber-700 font-normal">
                      {pendingItems > 0 && <>{pendingItems} item{pendingItems > 1 ? 's' : ''} not yet arrived</>}
                      {pendingItems > 0 && shortItems > 0 && ' · '}
                      {shortItems > 0 && <>{shortItems} short</>}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Partial arrival banner — everyone sees this when at least one item is short or missing */}
          {(() => {
            const totalOrdered = (order.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
            const totalReceived = (order.items || []).reduce((s, it) => s + (it.receivedQty || 0), 0);
            const hasArrivals = totalReceived > 0;
            const partial = hasArrivals && totalReceived < totalOrdered;
            if (!partial) return null;
            const short = (order.items || []).filter(it => (it.receivedQty || 0) < it.quantity);
            return (
              <div className="mb-2 bg-amber-50 border-l-4 border-amber-500 rounded-r-md p-2 text-xs text-amber-900">
                <div className="font-semibold flex items-center gap-1">
                  <AlertTriangle size={14} className="text-amber-700" /> Partial arrival — only {totalReceived} of {totalOrdered} units have arrived
                </div>
                <ul className="mt-1 ml-5 list-disc">
                  {short.map(it => (
                    <li key={it.id}>
                      <span className="font-medium">{it.productName}:</span>{' '}
                      {(it.receivedQty || 0)} of {it.quantity} {it.productUnit} arrived
                      {(it.receivedQty || 0) === 0
                        ? <span className="text-amber-700"> — not yet arrived</span>
                        : <span className="text-amber-700"> — {(it.quantity - (it.receivedQty || 0)).toFixed(2)} {it.productUnit} pending</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Material</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Ordered</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Arrived / Pending</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit Price</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Total</th>
                {order.isUnion && <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Sources</th>}
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Item Status</th>
                {isSM && order.status === 'QC_PASSED' && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Receive (this delivery)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {order.items?.map((item, idx) => {
                const canEditItemStatus = isPO && ['ORDERED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED'].includes(order.status);
                const recv = item.receivedQty || 0;
                const pending = Math.max(0, item.quantity - recv);
                const fullyArrived = recv >= item.quantity && item.quantity > 0;
                const notArrived = recv === 0;
                return (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{item.productName}</td>
                    <td className="px-3 py-2 text-gray-600">{item.quantity} {item.productUnit}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-xs font-semibold ${
                          fullyArrived ? 'text-green-700' : recv > 0 ? 'text-amber-700' : 'text-gray-400'
                        }`}>
                          {fullyArrived ? `✓ All ${recv} ${item.productUnit} arrived`
                            : recv > 0 ? `${recv} of ${item.quantity} ${item.productUnit} arrived`
                            : `Not yet arrived`}
                        </span>
                        {!fullyArrived && (
                          <span className="text-[11px] text-amber-700">
                            {pending} {item.productUnit} {notArrived ? 'awaiting delivery' : 'still pending'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{formatCurrency(item.unitPrice)}</td>
                    <td className="px-3 py-2 text-gray-600">{formatCurrency(item.totalPrice)}</td>
                    {order.isUnion && (
                      <td className="px-3 py-2">
                        <div className="space-y-0.5 text-[11px] text-gray-700">
                          {(item.allocations || []).map(a => {
                            const pr = a.purchaseRequestItem?.request;
                            return (
                              <div key={a.id} className="flex items-center gap-1">
                                <Badge color="navy">{pr?.requestNumber || 'PR'}{pr?.unit?.code ? ` · ${pr.unit.code}` : ''}</Badge>
                                <span>
                                  <strong>{a.allocatedQty}</strong> {item.productUnit}
                                  {a.receivedQty > 0 && <span className="text-green-600"> (rcv {a.receivedQty})</span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {canEditItemStatus ? (
                        <select
                          value={item.itemStatus || 'WAITING'}
                          onChange={(e) => updateItemStatus(item.id, e.target.value)}
                          className="px-2 py-1 border rounded text-xs"
                        >
                          <option value="WAITING">Waiting</option>
                          <option value="ORDERED">Ordered</option>
                          <option value="ON_THE_WAY">On the Way</option>
                          <option value="RECEIVED">Received</option>
                          <option value="CANCELLED">Cancelled</option>
                        </select>
                      ) : (
                        <Badge color={itemStatusColor(item.itemStatus || 'WAITING')}>
                          {itemStatusLabel(item.itemStatus || 'WAITING')}
                        </Badge>
                      )}
                    </td>
                    {isSM && order.status === 'QC_PASSED' && (
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={inwardItems[idx]?.receivedQty || ''}
                          onChange={(e) => {
                            const updated = [...inwardItems];
                            updated[idx] = { ...updated[idx], receivedQty: parseFloat(e.target.value) || 0 };
                            setInwardItems(updated);
                          }}
                          className="w-20 px-2 py-1 border rounded text-sm"
                          min="0" step="0.01"
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Other suppliers considered for the same PR */}
        {prQuotations.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              All quotations for {order.purchaseRequest?.requestNumber}
            </h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="px-2 py-1 text-left text-gray-600">Supplier</th>
                  <th className="px-2 py-1 text-left text-gray-600">Contact</th>
                  <th className="px-2 py-1 text-left text-gray-600">Total</th>
                  <th className="px-2 py-1 text-left text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {prQuotations.map(q => {
                  // Build a unique supplier list from the quotation header + its items
                  const supplierMap = new Map();
                  if (q.supplierName) {
                    supplierMap.set(q.supplierName.trim().toLowerCase(), {
                      name: q.supplierName,
                      contact: q.supplierContact || '',
                    });
                  }
                  (q.items || []).forEach(it => {
                    if (!it.supplierName) return;
                    const key = it.supplierName.trim().toLowerCase();
                    const existing = supplierMap.get(key);
                    if (!existing) {
                      supplierMap.set(key, {
                        name: it.supplierName,
                        contact: it.supplierContact || '',
                      });
                    } else if (!existing.contact && it.supplierContact) {
                      existing.contact = it.supplierContact;
                    }
                  });
                  const suppliers = Array.from(supplierMap.values());
                  const supplierNames = suppliers.map(s => s.name).join(', ') || '—';
                  const supplierContacts = suppliers
                    .map(s => s.contact)
                    .filter(Boolean)
                    .join(', ') || '—';
                  return (
                    <tr
                      key={q.id}
                      className={`border-b border-gray-100 last:border-0 ${
                        q.isSelected ? 'bg-green-50 ring-1 ring-inset ring-green-300' : ''
                      }`}
                    >
                      <td className="px-2 py-1 font-medium">
                        {q.isSelected && <span className="mr-1 text-green-700">✓</span>}
                        {supplierNames}
                      </td>
                      <td className="px-2 py-1 text-gray-600">{supplierContacts}</td>
                      <td className={`px-2 py-1 ${q.isSelected ? 'font-bold text-green-800' : ''}`}>
                        {formatCurrency(q.totalAmount)}
                      </td>
                      <td className="px-2 py-1">
                        {q.isSelected
                          ? <Badge color="green">Approved / Selected</Badge>
                          : <Badge color="gray">Not selected</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-500">
              The highlighted row is the quotation that was approved and converted into this purchase order.
            </p>
          </div>
        )}
        {loadingHistory && <p className="text-xs text-gray-400">Loading supplier history…</p>}

        {/* Payment History */}
        {order.paymentRequests?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1 text-left text-gray-500">Payment #</th>
                  <th className="px-2 py-1 text-left text-gray-500">Type</th>
                  <th className="px-2 py-1 text-left text-gray-500">Amount</th>
                  <th className="px-2 py-1 text-left text-gray-500">Status</th>
                  <th className="px-2 py-1 text-left text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {order.paymentRequests.map(p => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="px-2 py-1">{p.paymentNumber}</td>
                    <td className="px-2 py-1"><Badge color={p.paymentType === 'ADVANCE' ? 'blue' : 'navy'}>{p.paymentType}</Badge></td>
                    <td className="px-2 py-1 font-medium">{formatCurrency(p.amount)}</td>
                    <td className="px-2 py-1">
                      <Badge color={p.status === 'PAID' ? 'green' : p.status === 'REJECTED' ? 'red' : 'yellow'}>{p.status}</Badge>
                    </td>
                    <td className="px-2 py-1 text-gray-500">{formatDateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* QC Inspections */}
        {order.qcInspections?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">QC Inspections</h4>
            {order.qcInspections.map(qc => (
              <QCInspectionCard key={qc.id} qc={qc} />
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-2 border-t items-center">
          {isPO && isPendingAccounting && (
            <>
              {!showPaymentForm && !showCreditForm ? (
                <>
                  <Button onClick={() => setShowPaymentForm(true)}>
                    <CheckCircle size={16} className="mr-1" /> Place Order (Send to Accounting)
                  </Button>
                  <Button variant="secondary" onClick={() => setShowCreditForm(true)}>
                    <Handshake size={16} className="mr-1" /> Place on Credit
                  </Button>
                </>
              ) : showCreditForm ? (
                <div className="w-full bg-orange-50 border border-orange-200 rounded-md p-4 space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-orange-900 flex items-center gap-2">
                      <Handshake size={16} /> Place Order on Credit
                    </h4>
                    <p className="text-xs text-orange-800 mt-1">
                      Use this when the order is being placed on word-of-trust with {order.supplierName}.
                      The order will move forward immediately — supplier ships, items show as <span className="font-semibold">Ordered</span>,
                      and the source PR moves to <span className="font-semibold">Order Placed</span>.
                      You will still raise a Payment Request afterwards so Accounting can clear the dues.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Credit note <span className="text-gray-400">(optional — e.g. verbal confirmation from contact, agreed payment terms)</span>
                    </label>
                    <textarea
                      value={creditNote}
                      onChange={(e) => setCreditNote(e.target.value)}
                      placeholder="e.g. Confirmed by Mr. Rao on phone. Net-30 terms agreed. Payment to follow next week."
                      rows={3}
                      maxLength={500}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                    <div className="text-[10px] text-gray-400 mt-0.5">{creditNote.length}/500</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={placeOnCredit} disabled={processing}>
                      {processing ? 'Placing...' : 'Confirm — Place on Credit'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { setShowCreditForm(false); setCreditNote(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="w-full bg-amber-50 border border-amber-200 rounded-md p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-amber-900">Place Order — First Payment Request</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Amount (₹)" type="number" value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)} min="1" max={order.totalAmount} />
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                      <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm">
                        <option value="ADVANCE">Advance</option>
                        <option value="PARTIAL">Partial</option>
                        <option value="FINAL">Final (full amount)</option>
                      </select>
                    </div>
                    <Input label="Notes" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional" />
                  </div>

                  {isDelayed && (
                    <div className="border border-orange-300 bg-orange-50 rounded-md p-3 space-y-2">
                      <div className="text-xs font-semibold text-orange-800">
                        Placement delay detected — PR was created {daysSincePr} day(s) ago.
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="delay-ack"
                            checked={delayAcknowledged === true}
                            onChange={() => setDelayAcknowledged(true)}
                          />
                          <span>Delayed by 3 days or more — add reason</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="delay-ack"
                            checked={delayAcknowledged === false}
                            onChange={() => { setDelayAcknowledged(false); setDelayNote(''); }}
                          />
                          <span>No comment</span>
                        </label>
                      </div>
                      {delayAcknowledged && (
                        <textarea
                          value={delayNote}
                          onChange={(e) => setDelayNote(e.target.value)}
                          placeholder="Reason for delay in placing the order…"
                          rows={2}
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button size="sm" onClick={placeOrder} disabled={processing}>{processing ? 'Placing...' : 'Place Order & Request Payment'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setShowPaymentForm(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {isPO && !isPendingAccounting && remaining > 0 && (
            <>
              {!showPaymentForm ? (
                <Button variant="secondary" onClick={() => setShowPaymentForm(true)}>
                  <CreditCard size={16} className="mr-1" /> Request Payment
                </Button>
              ) : (
                <div className="w-full bg-blue-50 rounded-md p-4 space-y-3">
                  <h4 className="text-sm font-semibold">New Payment Request</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Amount (₹)" type="number" value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)} min="1" max={remaining} />
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                      <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm">
                        <option value="ADVANCE">Advance</option>
                        <option value="PARTIAL">Partial</option>
                        <option value="FINAL">Final</option>
                      </select>
                    </div>
                    <Input label="Notes" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={requestPayment} disabled={processing}>{processing ? 'Sending...' : 'Send Payment Request'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setShowPaymentForm(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {isSM && ['ORDERED', 'CREDIT_PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'PARTIAL'].includes(order.status) && (
            <Button onClick={openIirForm} disabled={processing}>
              <Truck size={16} className="mr-1" />
              {order.items?.some(i => (i.receivedQty || 0) > 0) ? 'Mark More Goods Arrived' : 'Mark Goods Arrived'}
            </Button>
          )}

          {/* Edit IIR: Stores can amend an unsubmitted IIR (page 1) until QC posts the result. */}
          {isSM && (order.qcInspections || []).some(q => q.result === 'PENDING' || q.result === 'ON_HOLD') && (
            <Button variant="secondary" onClick={openEditIirForm} disabled={processing}>
              <Truck size={16} className="mr-1" /> Edit IIR (Page 1)
            </Button>
          )}

          {isSM && order.status === 'QC_PASSED' && (
            <Button onClick={doInward} disabled={processing}>
              <PackagePlus size={16} className="mr-1" /> {processing ? 'Processing...' : 'Record Inward Entry'}
            </Button>
          )}

          {/* Close PO — PO can close once work is wrapped up. Server decides whether
              the close is clean or whether it needs a force-confirm (handled below). */}
          {isPO && !['COMPLETED', 'CLOSED', 'PENDING_ACCOUNTING'].includes(order.status) && (
            <Button variant="secondary" onClick={attemptClose} disabled={closing || processing}>
              <XCircle size={16} className="mr-1" /> {closing ? 'Closing…' : 'Close PO'}
            </Button>
          )}
        </div>
      </div>

      {/* Force-close confirmation: server returned 409 with what is still pending. */}
      {closePending && (
        <Modal
          isOpen
          onClose={() => { setClosePending(null); setCloseReason(''); }}
          title="Close PO with leftovers?"
          size="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-amber-50 border-l-4 border-amber-500 rounded-md p-3">
              <AlertTriangle size={18} className="text-amber-700 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-900">
                This order is not fully finished yet. Review what is still pending below.
                If you close it anyway, the leftover quantities will be cancelled on the
                originating Purchase Request(s) and no follow-up order will be created.
              </div>
            </div>

            {Array.isArray(closePending.pendingItems) && closePending.pendingItems.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1">Materials not fully received</div>
                <div className="border rounded-md divide-y">
                  {closePending.pendingItems.map((p, idx) => (
                    <div key={idx} className="px-3 py-2 text-sm flex justify-between">
                      <span className="text-gray-800">{p.productName || 'Item'}</span>
                      <span className="text-gray-600">
                        {Number(p.received || 0)} of {Number(p.ordered || 0)} {p.productUnit || ''} received
                        {p.shortQty != null && <> · short {Number(p.shortQty)}</>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Number(closePending.paymentRemaining || 0) > 0 && (
              <div className="text-sm bg-red-50 border border-red-200 rounded-md px-3 py-2 text-red-800">
                Payment remaining: <span className="font-semibold">{formatCurrency(closePending.paymentRemaining)}</span>
              </div>
            )}

            {closePending.openPaymentRequests && (
              <div className="text-sm bg-orange-50 border border-orange-200 rounded-md px-3 py-2 text-orange-800">
                There are open payment request(s) still in progress for this PO.
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
              <textarea
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Why are you force-closing this PO?"
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => { setClosePending(null); setCloseReason(''); }} disabled={closing}>
                Cancel
              </Button>
              <Button onClick={forceClose} disabled={closing}>
                <XCircle size={16} className="mr-1" /> {closing ? 'Closing…' : 'Close anyway'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showIirForm && (
        <Modal
          isOpen
          onClose={() => setShowIirForm(false)}
          title={`${iirMode === 'edit' ? 'Edit Inward Inspection Request' : 'Inward Inspection Request Form'} — ${order.orderNumber}`}
          size="xl"
        >
          <IIRForm
            order={order}
            iir={iir}
            setIir={setIir}
            lotItems={lotItems}
            setLotItems={setLotItems}
            invoiceFile={invoiceFile}
            setInvoiceFile={setInvoiceFile}
            lotReportFile={lotReportFile}
            setLotReportFile={setLotReportFile}
            processing={processing}
            onCancel={() => setShowIirForm(false)}
            onSubmit={submitIir}
            mode={iirMode}
            editingInspection={editingInspection}
          />
        </Modal>
      )}
    </Modal>
  );
}

// ─── Supplier sub-group inside a PR ───
function SupplierGroup({ supplier, orders, onOpenOrder }) {
  const [open, setOpen] = useState(false);
  const groupTotal = orders.reduce((s, o) => s + o.totalAmount, 0);
  const groupPaid = orders.reduce((s, o) => s + o.totalPaid, 0);

  // Pull contact info from any order item that has it (server includes items)
  const contact = orders.flatMap(o => o.items || []).find(i => i.supplierContact)?.supplierContact;

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 text-left">
          {open ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
          <Building2 size={16} className="text-amber-600" />
          <div>
            <div className="font-semibold text-gray-800">{supplier}</div>
            <div className="text-xs text-gray-500 flex items-center gap-3">
              <span>{orders.length} order{orders.length > 1 ? 's' : ''}</span>
              {contact && <span className="flex items-center gap-1"><Phone size={11} />{contact}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-bold text-navy-700">{formatCurrency(groupTotal)}</div>
            <div className="text-xs text-gray-500">{formatCurrency(groupPaid)} paid</div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
          {orders.map(o => {
            const totalOrdered = (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
            const totalReceived = (o.items || []).reduce((s, it) => s + (it.receivedQty || 0), 0);
            const lotCount = (o.qcInspections || []).length;
            const lastLot = (o.qcInspections || []).find(q => q.lotNumber);
            const arrivedPct = totalOrdered > 0 ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0;
            return (
            <div key={o.id} className="bg-white rounded-md p-3 border border-gray-100 hover:border-navy-200 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => onOpenOrder(o)}
                      className="font-mono text-xs text-navy-700 hover:underline font-semibold"
                    >
                      {o.orderNumber}
                    </button>
                    <Badge color={statusColor(o.status)}>{statusLabel(o.status)}</Badge>
                    {lotCount > 0 && (
                      <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        {lotCount} lot{lotCount > 1 ? 's' : ''}
                        {lastLot?.batchNo ? ` · last: ${lastLot.batchNo}` : ''}
                      </span>
                    )}
                  </div>
                  {/* Overall received progress — visible to every role */}
                  {totalOrdered > 0 && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-600 mb-0.5">
                        <span><strong className={totalReceived >= totalOrdered ? 'text-green-700' : 'text-amber-700'}>{totalReceived}</strong> of {totalOrdered} received</span>
                        <span className="text-gray-400">{Math.round(arrivedPct)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 rounded">
                        <div
                          className={`h-1.5 rounded transition-all ${
                            totalReceived >= totalOrdered ? 'bg-green-500' : totalReceived > 0 ? 'bg-amber-500' : 'bg-gray-300'
                          }`}
                          style={{ width: `${arrivedPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    {(o.items || []).map(it => {
                      const recv = it.receivedQty || 0;
                      const full = recv >= it.quantity && it.quantity > 0;
                      return (
                        <div key={it.id} className="flex items-center gap-2 text-xs text-gray-700">
                          <Package size={11} className="text-gray-400" />
                          <span className="font-medium">{it.productName}</span>
                          <span className="text-gray-500">× {it.quantity} {it.productUnit}</span>
                          <Badge color={itemStatusColor(it.itemStatus || 'WAITING')}>
                            {itemStatusLabel(it.itemStatus || 'WAITING')}
                          </Badge>
                          {recv > 0 && (
                            <span className={`text-[11px] font-medium ${full ? 'text-green-700' : 'text-amber-700'}`}>
                              {full ? 'Closed' : `Received ${recv}/${it.quantity}`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-navy-700">{formatCurrency(o.totalAmount)}</div>
                  <div className="w-24 mt-1">
                    <ProgressBar value={o.totalPaid} total={o.totalAmount} compact />
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onOpenOrder(o)} className="mt-2">
                    <Eye size={12} className="mr-1" /> View
                  </Button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PR group (top level accordion) ───
function PRGroup({ prNumber, prInfo, isUnion = false, sourceRequests = [], orders, onOpenOrder, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const totalAmount = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalPaid = orders.reduce((s, o) => s + o.totalPaid, 0);

  // Group POs by supplier
  const bySupplier = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const key = (o.supplierName || 'Unknown').trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [orders]);

  const pendingCount = orders.filter(o => o.status === 'PENDING_ACCOUNTING').length;
  const completedCount = orders.filter(o => ['INWARD_DONE', 'COMPLETED'].includes(o.status)).length;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
          isUnion
            ? 'bg-gradient-to-r from-purple-50 to-white hover:from-purple-100'
            : 'bg-gradient-to-r from-navy-50 to-white hover:from-navy-100'
        }`}
      >
        <div className="flex items-center gap-3 text-left">
          {open ? <ChevronDown size={18} className={isUnion ? 'text-purple-700' : 'text-navy-700'} /> : <ChevronRight size={18} className={isUnion ? 'text-purple-700' : 'text-navy-700'} />}
          {isUnion ? <Layers size={18} className="text-purple-700" /> : <FileText size={18} className="text-navy-700" />}
          <div>
            <div className={`font-bold flex items-center gap-2 ${isUnion ? 'text-purple-800' : 'text-navy-800'}`}>
              {isUnion ? (orders[0]?.customName || 'Union Order') : prNumber}
              {isUnion && <Badge color="purple">UNION</Badge>}
            </div>
            <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
              {isUnion ? (
                <>
                  <span className="font-mono">{prNumber}</span>
                  {sourceRequests.length > 0 && (
                    <span>
                      • {sourceRequests.length} PRs:{' '}
                      {sourceRequests
                        .slice(0, 5)
                        .map(s => `${s.purchaseRequest?.requestNumber} (${s.purchaseRequest?.unit?.code || s.purchaseRequest?.unit?.name || '—'})`)
                        .join(', ')}
                      {sourceRequests.length > 5 && ` +${sourceRequests.length - 5} more`}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="font-mono">{prNumber}</span>
                  {prInfo?.manager?.name && <span>• {prInfo.manager.name}</span>}
                  {prInfo?.unit?.name && <span>• {prInfo.unit.name}</span>}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-xs">
            <Badge color="gray">{bySupplier.length} supplier{bySupplier.length > 1 ? 's' : ''}</Badge>
            <Badge color="gray">{orders.length} order{orders.length > 1 ? 's' : ''}</Badge>
            {pendingCount > 0 && <Badge color="yellow">{pendingCount} awaiting</Badge>}
            {completedCount > 0 && <Badge color="green">{completedCount} done</Badge>}
          </div>
          <div className="text-right min-w-[120px]">
            <div className="font-bold text-navy-700">{formatCurrency(totalAmount)}</div>
            <ProgressBar value={totalPaid} total={totalAmount} compact />
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-3">
          {bySupplier.map(([supplier, supplierOrders]) => (
            <SupplierGroup
              key={supplier}
              supplier={supplier}
              orders={supplierOrders}
              onOpenOrder={onOpenOrder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───
export default function PurchaseOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isAdmin = user?.role === 'ADMIN';
  const refreshKey = useAutoRefresh();

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { limit: 100, fromDate: fromDate || undefined, toDate: toDate || undefined };
      if (tab !== 'ALL') params.status = tab;
      const [ordersRes, dashRes] = await Promise.all([
        api.get('/purchase-orders', { params }),
        (isPO || isAdmin) ? api.get('/purchase-orders/dashboard') : Promise.resolve({ data: null }),
      ]);
      setOrders(ordersRes.data.orders);
      setDashboard(dashRes.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tab, fromDate, toDate, refreshKey]);

  const openDetail = async (order) => {
    try {
      const { data } = await api.get(`/purchase-orders/${order.id}`);
      setSelectedOrder(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Group orders by PR
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? orders.filter(o =>
          (o.customName || '').toLowerCase().includes(q) ||
          (o.orderNumber || '').toLowerCase().includes(q) ||
          (o.supplierName || '').toLowerCase().includes(q) ||
          (o.purchaseRequest?.requestNumber || '').toLowerCase().includes(q)
        )
      : orders;

    const map = new Map();
    for (const o of filtered) {
      // Union POs get their own synthetic group so we don't mis-attach them to a single PR
      const groupKey = o.isUnion
        ? `__UNION__:${o.orderNumber || o.id}`
        : (o.purchaseRequest?.requestNumber || 'Unassigned');
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          isUnion: !!o.isUnion,
          prInfo: o.isUnion ? null : o.purchaseRequest,
          sourceRequests: o.isUnion ? (o.sourceRequests || []) : [],
          orders: [],
        });
      }
      map.get(groupKey).orders.push(o);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const aDate = Math.max(...a[1].orders.map(o => new Date(o.createdAt).getTime()));
      const bDate = Math.max(...b[1].orders.map(o => new Date(o.createdAt).getTime()));
      return bDate - aDate;
    });
  }, [orders, search]);

  const tabs = user?.role === 'STORE_MANAGER'
    ? ['ALL', 'ORDERED', 'CREDIT_PLACED', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'PARTIAL', 'INWARD_DONE', 'COMPLETED']
    : ['ALL', 'PENDING_ACCOUNTING', 'CREDIT_PLACED', 'ORDERED', 'PAID', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED'];

  return (
    <div className="space-y-6">
      <PageHero
        title="Purchase Orders"
        subtitle="Issue purchase orders to suppliers, monitor delivery, payment, and QC status — grouped by PR → supplier → material."
        eyebrow="Order Tracking"
        icon={Truck}
      />

      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-2xl font-bold text-navy-700">{dashboard.total}</p>
              <p className="text-xs text-gray-500">Total Orders</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{formatCurrency(dashboard.paymentSummary.totalPaidAmount)}</p>
              <p className="text-xs text-gray-500">Total Paid</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{formatCurrency(dashboard.paymentSummary.pendingPayment)}</p>
              <p className="text-xs text-gray-500">Pending Payment</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(dashboard.paymentSummary.totalAdvancePaid)}</p>
              <p className="text-xs text-gray-500">Advance Paid</p>
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg flex-wrap">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                tab === t ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >{t === 'ALL' ? 'All' : statusLabel(t)}</button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search PR, order #, supplier, name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-navy-400"
        />
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      {/* Grouped list */}
      {loading ? (
        <Card>
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-gray-400">
            {search ? 'No orders match your search.' : 'No purchase orders found.'}
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([groupKey, { isUnion, prInfo, sourceRequests, orders: prOrders }], idx) => (
            <PRGroup
              key={groupKey}
              prNumber={isUnion ? prOrders[0]?.orderNumber : groupKey}
              prInfo={prInfo}
              isUnion={isUnion}
              sourceRequests={sourceRequests}
              orders={prOrders}
              onOpenOrder={openDetail}
              defaultOpen={idx === 0}
            />
          ))}
        </div>
      )}

      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdated={fetchData}
        userRole={user?.role}
      />
    </div>
  );
}
