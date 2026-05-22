import { useState, useEffect } from 'react';
import { ClipboardCheck, CheckCircle, XCircle, Plus, Eye, FileCheck, X, Paperclip, Upload, AlertCircle, RotateCcw, Download, FileText } from 'lucide-react';
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

const formatCurrency = (amt) => `₹${Number(amt).toLocaleString('en-IN')}`;

const resultColor = (r) => ({
  PENDING: 'yellow',
  PASSED: 'green',
  FAILED: 'red',
  PARTIAL: 'navy',
  ON_HOLD: 'orange',
}[r] || 'gray');

const resultLabel = (r) => ({
  PENDING: 'Pending',
  PASSED: 'Accepted',
  FAILED: 'Rejected',
  PARTIAL: 'Partial',
  ON_HOLD: 'On Hold',
}[r] || r);

// Short date only
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

// ─── Shared: PR/PO Info Header (read-only) ───
function OrderInfoHeader({ order }) {
  if (!order) return null;
  const pr = order.purchaseRequest;
  const totalQty = order.items?.reduce((s, i) => s + (i.quantity || 0), 0) || 0;
  const scopes = Array.from(new Set((pr?.items || []).map(i => i.scopeOfWork).filter(Boolean)));
  const requiredBy = (pr?.items || []).map(i => i.requiredByDate).filter(Boolean).sort()[0];

  return (
    <div className="border border-gray-300 rounded-md overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 text-xs font-bold text-gray-700">
        Purchase Order / PR Details (auto-populated)
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs p-3">
        <div><span className="text-gray-500">PO No.:</span> <span className="font-medium">{order.orderNumber}</span></div>
        <div><span className="text-gray-500">PO Name:</span> <span className="font-medium">{order.customName}</span></div>
        <div><span className="text-gray-500">Supplier:</span> <span>{order.supplierName}</span></div>
        <div><span className="text-gray-500">Amount:</span> <span>{formatCurrency(order.totalAmount)}</span></div>
        <div><span className="text-gray-500">Goods Arrived:</span> <span>{order.goodsArrivedAt ? formatDateTime(order.goodsArrivedAt) : '—'}</span></div>
        <div><span className="text-gray-500">Total Qty Ordered:</span> <span>{totalQty}</span></div>
        {pr && (
          <>
            <div><span className="text-gray-500">PR No.:</span> <span>{pr.requestNumber}</span></div>
            <div><span className="text-gray-500">Manager:</span> <span>{pr.manager?.name}</span></div>
            {pr.requestId && (
              <div className="col-span-2"><span className="text-gray-500">Request/Work ID:</span> <span className="font-medium">{pr.requestId}</span></div>
            )}
            {requiredBy && (
              <div><span className="text-gray-500">Delivery Required By:</span> <span>{fmtDate(requiredBy)}</span></div>
            )}
            {scopes.length > 0 && (
              <div className="col-span-2"><span className="text-gray-500">Reports Required / Scope of Work:</span> <span>{scopes.join(' / ')}</span></div>
            )}
          </>
        )}
      </div>

      {/* Order Items */}
      {order.items?.length > 0 && (
        <div className="border-t border-gray-300">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-300">
                <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Product</th>
                <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Qty</th>
                <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Unit</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map(item => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-3 py-1.5">{item.productName}</td>
                  <td className="px-3 py-1.5">{item.quantity}</td>
                  <td className="px-3 py-1.5 text-gray-600">{item.productUnit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Static annexure published with the PO that QC and PR originators always need to see.
const ANNEXURE_URL = '/po-terms-and-conditions.pdf';

// ─── Shared: 3 reference documents available to everyone on the PR chain (PR specs, PO PDF, Annexure) ───
function InspectionDocsPanel({ order, inspection }) {
  const pr = order?.purchaseRequest;
  const prSpecsUrl = pr?.materialSpecsPdfUrl;
  const poDocumentUrl = inspection?.poDocumentUrl;

  const DocLink = ({ href, label, hint, missingHint }) => {
    if (!href) {
      return (
        <div className="flex items-start gap-2 px-3 py-2 rounded border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500">
          <FileText size={14} className="mt-0.5 text-gray-400" />
          <div>
            <div className="font-medium text-gray-600">{label}</div>
            <div>{missingHint}</div>
          </div>
        </div>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer"
        className="flex items-start gap-2 px-3 py-2 rounded border border-blue-200 bg-blue-50 text-xs text-blue-800 hover:bg-blue-100 transition">
        <FileText size={14} className="mt-0.5 text-blue-600" />
        <div>
          <div className="font-semibold">{label}</div>
          <div className="text-blue-700">{hint}</div>
        </div>
      </a>
    );
  };

  return (
    <div className="border border-gray-300 rounded-md overflow-hidden">
      <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 text-xs font-bold text-gray-700">
        Reference Documents — visible to everyone on this PR chain
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-3">
        <DocLink
          href={prSpecsUrl}
          label={`PR ${pr?.requestNumber || ''}`.trim()}
          hint={pr?.requestId ? `${pr.requestId} • Material specs` : 'Material specifications'}
          missingHint={pr ? 'No specs PDF was attached to this PR.' : 'No PR linked to this PO.'}
        />
        <DocLink
          href={poDocumentUrl}
          label="Purchase Order (signed)"
          hint="Uploaded by Purchase Officer when sending QC request"
          missingHint="PO has not uploaded the signed PO PDF yet."
        />
        <DocLink
          href={ANNEXURE_URL}
          label="PO Terms & Conditions (Annexure)"
          hint="Standard annexure attached to every PO"
          missingHint="—"
        />
      </div>
    </div>
  );
}

// ─── PO / SM: Create Inspection Request (Page 1) ───
function CreateRequestModal({ order, onClose, onCreated }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dcNo, setDcNo] = useState('');
  const [gatePassNo, setGatePassNo] = useState('');
  const [gatePassType, setGatePassType] = useState('');
  const [probableDateOfReturn, setProbableDateOfReturn] = useState('');
  const [materialReceiptDate, setMaterialReceiptDate] = useState('');
  const [notes, setNotes] = useState('');
  const [docRequirement, setDocRequirement] = useState('NONE');
  const [docRequirementNote, setDocRequirementNote] = useState('');
  const [incomingDocs, setIncomingDocs] = useState([]);
  const [poDocument, setPoDocument] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (order) {
      setInvoiceNo(''); setInvoiceDate(''); setDcNo('');
      setGatePassNo(''); setGatePassType('');
      setProbableDateOfReturn('');
      setMaterialReceiptDate(new Date().toISOString().slice(0, 10));
      setNotes('');
      setDocRequirement('NONE');
      setDocRequirementNote('');
      setIncomingDocs([]);
      setPoDocument(null);
    }
  }, [order]);

  const submit = async () => {
    if (!order) return;
    if (!invoiceNo.trim() && !dcNo.trim()) {
      return alert('Invoice No. or DC No. is required');
    }
    if (['COA', 'COC', 'ANY_REPORTS'].includes(docRequirement) && !docRequirementNote.trim()) {
      return alert('Please describe which documents/reports QC should expect.');
    }
    if (!poDocument) {
      const proceed = confirm('No signed PO PDF attached. QC needs the signed PO to inspect — continue anyway?');
      if (!proceed) return;
    }
    setProcessing(true);
    try {
      // Use multipart so the signed PO PDF rides along with the request.
      const fd = new FormData();
      const stringFields = {
        purchaseOrderId: order.id,
        invoiceNo, invoiceDate, dcNo, gatePassNo, gatePassType,
        probableDateOfReturn, materialReceiptDate, notes,
        docRequirement, docRequirementNote,
      };
      for (const [k, v] of Object.entries(stringFields)) {
        if (v !== undefined && v !== null && v !== '') fd.append(k, v);
      }
      if (poDocument) fd.append('poDocument', poDocument);

      const { data: created } = await api.post('/qc-inspections', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // If PO attached incoming docs at request time, upload them straight away.
      if (incomingDocs.length > 0 && created?.id) {
        const docsFd = new FormData();
        for (const f of incomingDocs) docsFd.append('docs', f);
        try {
          await api.put(`/qc-inspections/${created.id}/upload-docs`, docsFd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (err) {
          alert(`Inspection request created but document upload failed: ${err.response?.data?.error || err.message}`);
        }
      }

      onClose();
      onCreated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create inspection request');
    }
    setProcessing(false);
  };

  if (!order) return null;

  return (
    <Modal isOpen={!!order} onClose={onClose}
      title={`Create Inspection Request — ${order.customName}`} size="lg">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800">
          <strong>Inward Inspection Request (RAPS/IIR Rev 01)</strong> — Fill invoice, DC and gate pass details.
          Once submitted, QC will be notified to perform inspection.
        </div>

        <OrderInfoHeader order={order} />

        <InspectionDocsPanel order={order} inspection={null} />

        {/* Signed PO PDF — what QC will actually open instead of the auto-generated PO. */}
        <div className="border border-navy-200 bg-navy-50/40 rounded-md p-3 space-y-2">
          <label className="block text-xs font-semibold text-navy-900 flex items-center gap-1">
            <Paperclip size={12} /> Attach Signed Purchase Order PDF *
          </label>
          <p className="text-xs text-gray-600">
            Upload the signed/issued PO. QC will see this in place of the auto-generated PO when filling the report.
          </p>
          <input type="file" accept="application/pdf"
            onChange={(e) => setPoDocument(e.target.files?.[0] || null)}
            className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-navy-100 file:text-navy-900 hover:file:bg-navy-200" />
          {poDocument && (
            <div className="text-xs text-gray-600">Selected: <span className="font-medium">{poDocument.name}</span></div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Invoice / DC / Gate Pass Details</h4>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Invoice No." value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder="Invoice no." />
            <Input label="Invoice Date" type="date" value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)} />
            <Input label="DC No. (if any)" value={dcNo} onChange={(e) => setDcNo(e.target.value)}
              placeholder="DC number" />
            <Input label="Gate Pass No." value={gatePassNo} onChange={(e) => setGatePassNo(e.target.value)}
              placeholder="Gate pass no." />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gate Pass Type</label>
              <select value={gatePassType} onChange={(e) => setGatePassType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-navy-500">
                <option value="">Select type</option>
                <option value="FIM">FIM</option>
                <option value="Others">Others</option>
              </select>
            </div>
            <Input label="Probable Date of Return (if returnable)" type="date" value={probableDateOfReturn}
              onChange={(e) => setProbableDateOfReturn(e.target.value)} />
            <Input label="Material Receipt Date @ RAPS Store" type="date" value={materialReceiptDate}
              onChange={(e) => setMaterialReceiptDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500"
            placeholder="Any additional info for QC..." />
        </div>

        {/* Phase 4: PO declares which docs QC should expect */}
        <div className="border border-amber-200 bg-amber-50 rounded-md p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-900">Documentation Required for QC</div>
          <div className="flex flex-wrap gap-4 text-xs">
            {[
              { v: 'NONE', label: 'No additional documents' },
              { v: 'COA', label: 'COA (Certificate of Analysis)' },
              { v: 'COC', label: 'COC (Certificate of Conformity)' },
              { v: 'ANY_REPORTS', label: 'Any other reports' },
            ].map(opt => (
              <label key={opt.v} className="flex items-center gap-1">
                <input type="radio" name="docRequirement" value={opt.v}
                  checked={docRequirement === opt.v}
                  onChange={() => setDocRequirement(opt.v)} />
                {opt.label}
              </label>
            ))}
          </div>
          {['COA', 'COC', 'ANY_REPORTS'].includes(docRequirement) && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Note for QC — what to verify *
                </label>
                <textarea value={docRequirementNote}
                  onChange={(e) => setDocRequirementNote(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-amber-500"
                  placeholder="e.g., Mill certificate for SS316L, batch traceability required..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                  <Paperclip size={12} /> Attach Incoming Documents (optional)
                </label>
                <input type="file" multiple
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => setIncomingDocs(Array.from(e.target.files || []))}
                  className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-amber-100 file:text-amber-900 hover:file:bg-amber-200" />
                {incomingDocs.length > 0 && (
                  <div className="mt-1 text-xs text-gray-600">
                    {incomingDocs.length} file{incomingDocs.length !== 1 ? 's' : ''} selected:{' '}
                    {incomingDocs.map(f => f.name).join(', ')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={processing}>
            <ClipboardCheck size={16} className="mr-1" />
            {processing ? 'Submitting...' : 'Submit Inspection Request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── QC: Fill Inspection Report (Page 2) ───
function FillReportModal({ inspection, onClose, onUpdated }) {
  const [reportNo, setReportNo] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [materialDescription, setMaterialDescription] = useState('');
  const [materialCategory, setMaterialCategory] = useState('');
  const [documentTypes, setDocumentTypes] = useState({ testReport: false, coc: false, coa: false, thirdParty: false, dimInspAtSupplier: false, dimInspAtRapsInward: false });
  const [inspectionLocation, setInspectionLocation] = useState('');
  const [reportReferenceNo, setReportReferenceNo] = useState('');
  const [packingCondition, setPackingCondition] = useState('');
  const [packingDamageNotes, setPackingDamageNotes] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [dateOfManufacturing, setDateOfManufacturing] = useState('');
  const [dateOfExpiry, setDateOfExpiry] = useState('');
  const [tappedHolesCondition, setTappedHolesCondition] = useState('');
  const [qtyAsPerPR, setQtyAsPerPR] = useState('');
  const [qtyOrdered, setQtyOrdered] = useState('');
  const [qtyReceived, setQtyReceived] = useState('');
  const [qtyAccepted, setQtyAccepted] = useState('');
  const [qtyRejected, setQtyRejected] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [mirNo, setMirNo] = useState('');
  const [parameters, setParameters] = useState([{ name: '', expected: '', actual: '', passed: true }]);
  const [pendingReason, setPendingReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (inspection) {
      setReportNo(inspection.reportNo || '');
      setReportDate(inspection.reportDate?.slice(0, 10) || new Date().toISOString().slice(0, 10));
      setMaterialDescription(inspection.materialDescription || '');
      setMaterialCategory(inspection.materialCategory || '');
      setDocumentTypes({ testReport: false, coc: false, coa: false, thirdParty: false, dimInspAtSupplier: false, dimInspAtRapsInward: false, ...(inspection.documentTypes || {}) });
      setInspectionLocation(inspection.inspectionLocation || '');
      setReportReferenceNo(inspection.reportReferenceNo || '');
      setPackingCondition(inspection.packingCondition || '');
      setPackingDamageNotes(inspection.packingDamageNotes || '');
      setBatchNo(inspection.batchNo || '');
      setDateOfManufacturing(inspection.dateOfManufacturing?.slice(0, 10) || '');
      setDateOfExpiry(inspection.dateOfExpiry?.slice(0, 10) || '');
      setTappedHolesCondition(inspection.tappedHolesCondition || '');
      // Pre-fill qty from PO
      const totalOrderedQty = inspection.purchaseOrder?.items?.reduce((s, i) => s + (i.quantity || 0), 0) || '';
      setQtyAsPerPR(inspection.qtyAsPerPR ?? totalOrderedQty);
      setQtyOrdered(inspection.qtyOrdered ?? totalOrderedQty);
      setQtyReceived(inspection.qtyReceived ?? '');
      setQtyAccepted(inspection.qtyAccepted ?? '');
      setQtyRejected(inspection.qtyRejected ?? '');
      setRejectionReason(inspection.rejectionReason || '');
      setRemarks(inspection.remarks || '');
      setMirNo(inspection.mirNo || '');
      setParameters(
        Array.isArray(inspection.parameters) && inspection.parameters.length > 0
          ? inspection.parameters
          : [{ name: '', expected: '', actual: '', passed: true }]
      );
      setPendingReason(inspection.pendingReason || '');
    }
  }, [inspection]);

  const addParam = () => setParameters([...parameters, { name: '', expected: '', actual: '', passed: true }]);
  const removeParam = (idx) => parameters.length > 1 && setParameters(parameters.filter((_, i) => i !== idx));
  const updateParam = (idx, field, value) => {
    const updated = [...parameters];
    updated[idx] = { ...updated[idx], [field]: value };
    setParameters(updated);
  };

  // Auto-derive qtyRejected from received - accepted
  useEffect(() => {
    const rec = parseFloat(qtyReceived);
    const acc = parseFloat(qtyAccepted);
    if (!isNaN(rec) && !isNaN(acc)) {
      const rej = Math.max(0, rec - acc);
      setQtyRejected(rej);
    } else if (qtyReceived === '' && qtyAccepted === '') {
      setQtyRejected('');
    }
  }, [qtyReceived, qtyAccepted]);

  const submit = async (resultValue) => {
    if (!inspection) return;
    // ON_HOLD only needs a reason — short-circuit before qty validation.
    if (resultValue === 'ON_HOLD') {
      if (!pendingReason.trim()) {
        return alert('Please describe what is missing or unverifiable so PO can address it.');
      }
      if (!confirm('Place this inspection on hold and bounce it back to Purchase Officer for action?')) return;
      setProcessing(true);
      try {
        await api.put(`/qc-inspections/${inspection.id}/result`, {
          result: 'ON_HOLD',
          pendingReason: pendingReason.trim(),
          // Persist any partial work QC has already done.
          parameters: parameters.filter(p => p.name.trim()),
          reportNo: reportNo || undefined,
          reportDate: reportDate || undefined,
          materialDescription: materialDescription || undefined,
          materialCategory: materialCategory || undefined,
          documentTypes,
          inspectionLocation: inspectionLocation || undefined,
          reportReferenceNo: reportReferenceNo || undefined,
          packingCondition: packingCondition || undefined,
          packingDamageNotes: packingDamageNotes || undefined,
          batchNo: batchNo || undefined,
          dateOfManufacturing: dateOfManufacturing || undefined,
          dateOfExpiry: dateOfExpiry || undefined,
          tappedHolesCondition: tappedHolesCondition || undefined,
          remarks: remarks || undefined,
        });
        onClose();
        onUpdated();
      } catch (err) {
        alert(err.response?.data?.error || 'Failed to place inspection on hold');
      }
      setProcessing(false);
      return;
    }

    if (!reportNo.trim()) return alert('Report No. is required');
    const recNum = parseFloat(qtyReceived);
    const accNum = parseFloat(qtyAccepted);
    if (isNaN(recNum) || recNum <= 0) return alert('Qty Received is required');
    if (isNaN(accNum) || accNum < 0) return alert('Qty Accepted is required');
    if (accNum > recNum) return alert('Qty Accepted cannot exceed Qty Received');
    if (resultValue === 'PASSED' && accNum < recNum) {
      return alert('For Accepted result, Qty Accepted must equal Qty Received. Use Partial if some qty is rejected.');
    }
    if (resultValue === 'FAILED' && accNum > 0) {
      return alert('For Rejected result, Qty Accepted must be 0.');
    }
    if (!confirm(`Submit inspection result as ${resultLabel(resultValue)}?`)) return;
    setProcessing(true);
    try {
      await api.put(`/qc-inspections/${inspection.id}/result`, {
        result: resultValue,
        parameters: parameters.filter(p => p.name.trim()),
        reportNo: reportNo || undefined,
        reportDate: reportDate || undefined,
        materialDescription: materialDescription || undefined,
        materialCategory: materialCategory || undefined,
        documentTypes,
        inspectionLocation: inspectionLocation || undefined,
        reportReferenceNo: reportReferenceNo || undefined,
        packingCondition: packingCondition || undefined,
        packingDamageNotes: packingDamageNotes || undefined,
        batchNo: batchNo || undefined,
        dateOfManufacturing: dateOfManufacturing || undefined,
        dateOfExpiry: dateOfExpiry || undefined,
        tappedHolesCondition: tappedHolesCondition || undefined,
        qtyAsPerPR: qtyAsPerPR !== '' ? parseFloat(qtyAsPerPR) : undefined,
        qtyOrdered: qtyOrdered !== '' ? parseFloat(qtyOrdered) : undefined,
        qtyReceived: qtyReceived !== '' ? parseFloat(qtyReceived) : undefined,
        qtyAccepted: qtyAccepted !== '' ? parseFloat(qtyAccepted) : undefined,
        qtyRejected: qtyRejected !== '' ? parseFloat(qtyRejected) : undefined,
        rejectionReason: rejectionReason || undefined,
        remarks: remarks || undefined,
        mirNo: mirNo || undefined,
      });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit result');
    }
    setProcessing(false);
  };

  if (!inspection) return null;
  const order = inspection.purchaseOrder;

  return (
    <Modal isOpen={!!inspection} onClose={onClose}
      title={`Fill Inspection Report — ${inspection.inspectionNumber}`} size="full">
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-xs text-green-800">
          <strong>Inward Inspection Report</strong> — Verify material, record dimensional inspection and submit result.
        </div>

        <OrderInfoHeader order={order} />

        <InspectionDocsPanel order={order} inspection={inspection} />

        {/* Page 1 request details (read-only) */}
        <div className="border border-gray-300 rounded-md overflow-hidden">
          <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 text-xs font-bold text-gray-700">
            Inspection Request Details (filled by {inspection.requestCreatedBy?.name || 'Purchase/Stores'})
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs p-3">
            <div><span className="text-gray-500">Invoice No.:</span> <span>{inspection.invoiceNo || '—'}</span></div>
            <div><span className="text-gray-500">Invoice Date:</span> <span>{fmtDate(inspection.invoiceDate)}</span></div>
            <div><span className="text-gray-500">DC No.:</span> <span>{inspection.dcNo || '—'}</span></div>
            <div><span className="text-gray-500">Gate Pass No.:</span> <span>{inspection.gatePassNo || '—'}</span></div>
            <div><span className="text-gray-500">Gate Pass Type:</span> <span>{inspection.gatePassType || '—'}</span></div>
            <div><span className="text-gray-500">Receipt Date:</span> <span>{fmtDate(inspection.materialReceiptDate)}</span></div>
            {inspection.probableDateOfReturn && (
              <div><span className="text-gray-500">Prob. Return:</span> <span>{fmtDate(inspection.probableDateOfReturn)}</span></div>
            )}
            {inspection.notes && (
              <div className="col-span-3"><span className="text-gray-500">Notes:</span> <span>{inspection.notes}</span></div>
            )}
            {inspection.docRequirement && inspection.docRequirement !== 'NONE' && (
              <div className="col-span-3">
                <span className="text-gray-500">Docs Expected:</span>{' '}
                <span className="font-medium text-amber-800">{inspection.docRequirement.replace('_', ' ')}</span>
                {inspection.docRequirementNote && (
                  <span className="text-gray-700"> — {inspection.docRequirementNote}</span>
                )}
              </div>
            )}
            {Array.isArray(inspection.uploadedDocs) && inspection.uploadedDocs.length > 0 && (
              <div className="col-span-3">
                <span className="text-gray-500">Uploaded by PO:</span>{' '}
                <span className="inline-flex flex-wrap gap-x-3 gap-y-1 align-middle">
                  {inspection.uploadedDocs.map((d, idx) => (
                    <a key={idx} href={d.url} target="_blank" rel="noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-1">
                      <Download size={11} /> {d.filename}
                    </a>
                  ))}
                </span>
              </div>
            )}
            {inspection.iteration > 0 && (
              <div className="col-span-3">
                <span className="text-gray-500">Re-review Iteration:</span>{' '}
                <span className="font-medium text-orange-700">#{inspection.iteration}</span>
              </div>
            )}
          </div>
          {(() => {
            const dt = inspection.documentTypes || {};
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
            if (!inspection.materialCategory && docs.length === 0 && dims.length === 0) return null;
            return (
              <div className="border-t border-gray-300 bg-amber-50 px-3 py-2 text-xs space-y-1">
                <div className="font-semibold text-amber-900">Requested by Purchase — please verify</div>
                {inspection.materialCategory && (
                  <div><span className="text-gray-600">Material category:</span>{' '}
                    <span className="font-medium">{inspection.materialCategory}</span></div>
                )}
                {docs.length > 0 && (
                  <div><span className="text-gray-600">Documents required:</span>{' '}
                    <span className="font-medium">{docs.join(', ')}</span></div>
                )}
                {dims.length > 0 && (
                  <div><span className="text-gray-600">Dimensional inspection:</span>{' '}
                    <span className="font-medium">{dims.join(', ')}</span></div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Report fields */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Inspection Report</h4>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Report No. *" value={reportNo} onChange={(e) => setReportNo(e.target.value)}
              placeholder="e.g., IIR-2024-001" />
            <Input label="Report Date" type="date" value={reportDate}
              onChange={(e) => setReportDate(e.target.value)} />
          </div>

          <div className="mt-3">
            <Input label="Material Description & Specification" value={materialDescription}
              onChange={(e) => setMaterialDescription(e.target.value)} placeholder="Full description" />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Material Category</label>
              <div className="flex flex-wrap gap-3 text-xs pt-2">
                {['Raw Materials', 'Consumables', 'Tooling & Fixtures', 'FIM'].map(c => (
                  <label key={c} className="flex items-center gap-1">
                    <input type="radio" name="materialCategory" checked={materialCategory === c}
                      onChange={() => setMaterialCategory(c)} />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Documents Verified</label>
              <div className="flex flex-wrap gap-3 text-xs pt-2">
                {[
                  { key: 'testReport', label: 'Test Report' },
                  { key: 'coc', label: 'COC' },
                  { key: 'coa', label: 'COA' },
                  { key: 'thirdParty', label: '3rd Party / Customer Clearance' },
                ].map(dt => (
                  <label key={dt.key} className="flex items-center gap-1">
                    <input type="checkbox" checked={documentTypes[dt.key] || false}
                      onChange={(e) => setDocumentTypes({ ...documentTypes, [dt.key]: e.target.checked })} />
                    {dt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dimensional Inspection Done</label>
              <div className="flex flex-wrap gap-3 text-xs pt-2">
                {[
                  { key: 'dimInspAtSupplier', label: 'At Supplier place' },
                  { key: 'dimInspAtRapsInward', label: 'At RAPS inward' },
                ].map(dt => (
                  <label key={dt.key} className="flex items-center gap-1">
                    <input type="checkbox" checked={documentTypes[dt.key] || false}
                      onChange={(e) => setDocumentTypes({ ...documentTypes, [dt.key]: e.target.checked })} />
                    {dt.label}
                  </label>
                ))}
              </div>
            </div>
            <Input label="Report Reference No." value={reportReferenceNo}
              onChange={(e) => setReportReferenceNo(e.target.value)} placeholder="Reference" />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Packing Condition</label>
              <select value={packingCondition} onChange={(e) => setPackingCondition(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-navy-500">
                <option value="">Select</option>
                <option value="Sealed">Sealed</option>
                <option value="Broken">Broken</option>
              </select>
            </div>
            {packingCondition === 'Broken' && (
              <Input label="Damage Notes" value={packingDamageNotes}
                onChange={(e) => setPackingDamageNotes(e.target.value)} placeholder="Mention damages" />
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mt-3">
            <Input label="Batch No. / Identification" value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)} placeholder="Batch no." />
            <Input label="Date of Manufacturing" type="date" value={dateOfManufacturing}
              onChange={(e) => setDateOfManufacturing(e.target.value)} />
            <Input label="Date of Expiry" type="date" value={dateOfExpiry}
              onChange={(e) => setDateOfExpiry(e.target.value)} />
          </div>

          <div className="mt-3">
            <Input label="Tapped Holes / Weld Lugs Condition" value={tappedHolesCondition}
              onChange={(e) => setTappedHolesCondition(e.target.value)} placeholder="Check condition..." />
          </div>
        </div>

        {/* Qty Table */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Quantity Verification</h4>
          <div className="grid grid-cols-5 gap-2">
            <Input label="Qty as per PR" type="number" value={qtyAsPerPR}
              onChange={(e) => setQtyAsPerPR(e.target.value)} />
            <Input label="Qty Ordered" type="number" value={qtyOrdered}
              onChange={(e) => setQtyOrdered(e.target.value)} />
            <Input label="Qty Received *" type="number" value={qtyReceived}
              onChange={(e) => setQtyReceived(e.target.value)} />
            <Input label="Qty Accepted *" type="number" value={qtyAccepted}
              onChange={(e) => setQtyAccepted(e.target.value)} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Qty Rejected (auto)</label>
              <input type="number" value={qtyRejected} readOnly tabIndex={-1}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-100 text-gray-700 cursor-not-allowed" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Only the <strong>Qty Accepted</strong> will flow to Inward Entry. Rejected = Received − Accepted (auto-calculated).
          </p>
        </div>

        {/* Dimensional parameters */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Dimensional Inspection Parameters</h4>
            <button onClick={addParam} className="text-xs text-navy-600 hover:text-navy-800 flex items-center gap-1">
              <Plus size={12} /> Add Parameter
            </button>
          </div>
          <table className="w-full text-sm border border-gray-300">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-300">
                <th className="px-2 py-1 text-left text-xs font-medium text-gray-600">Parameter</th>
                <th className="px-2 py-1 text-left text-xs font-medium text-gray-600">Expected / Nominal</th>
                <th className="px-2 py-1 text-left text-xs font-medium text-gray-600">Actual / Measured</th>
                <th className="px-2 py-1 text-center text-xs font-medium text-gray-600 w-16">Pass?</th>
                <th className="px-2 py-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {parameters.map((param, idx) => (
                <tr key={idx} className="border-b border-gray-100">
                  <td className="px-2 py-1">
                    <input value={param.name} onChange={(e) => updateParam(idx, 'name', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="e.g., Thickness" />
                  </td>
                  <td className="px-2 py-1">
                    <input value={param.expected} onChange={(e) => updateParam(idx, 'expected', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="e.g., 5.0 mm" />
                  </td>
                  <td className="px-2 py-1">
                    <input value={param.actual} onChange={(e) => updateParam(idx, 'actual', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="e.g., 4.9 mm" />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={param.passed}
                      onChange={(e) => updateParam(idx, 'passed', e.target.checked)} />
                  </td>
                  <td className="px-2 py-1 text-center">
                    {parameters.length > 1 && (
                      <button onClick={() => removeParam(idx)} className="text-gray-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Input label="Reason for Rejection / Non-conformity" value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)} placeholder="If any, describe reason..." />

        <div className="grid grid-cols-2 gap-3">
          <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="Additional remarks" />
          <Input label="MIR No. (Store fills)" value={mirNo} onChange={(e) => setMirNo(e.target.value)}
            placeholder="MIR number" />
        </div>

        {/* On Hold reason (only required when placing on hold) */}
        <div className="border border-orange-200 bg-orange-50 rounded-md p-3">
          <label className="block text-xs font-semibold text-orange-900 mb-1 flex items-center gap-1">
            <AlertCircle size={12} /> Reason to Place On Hold (only when bouncing back to PO)
          </label>
          <textarea value={pendingReason}
            onChange={(e) => setPendingReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-orange-300 rounded-md text-xs focus:ring-2 focus:ring-orange-500 bg-white"
            placeholder="e.g., COA not provided / batch mismatch — needs supplier clarification..." />
          <p className="text-xs text-gray-500 mt-1">
            Use this when documents/conditions are insufficient to decide Accept/Reject. PO will be notified to address and resubmit.
          </p>
        </div>

        {/* Submit actions */}
        <div className="flex flex-wrap gap-3 pt-3 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={() => submit('ON_HOLD')} disabled={processing}
            className="border border-orange-400 text-orange-700 hover:bg-orange-50">
            <AlertCircle size={16} className="mr-1" /> On Hold
          </Button>
          <Button onClick={() => submit('PASSED')} disabled={processing}>
            <CheckCircle size={16} className="mr-1" /> Accept
          </Button>
          <Button variant="secondary" onClick={() => submit('PARTIAL')} disabled={processing}>
            Partial
          </Button>
          <Button variant="danger" onClick={() => submit('FAILED')} disabled={processing}>
            <XCircle size={16} className="mr-1" /> Reject
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── PO / SM: Address On-Hold Inspection ───
function HoldActionModal({ inspection, onClose, onActioned }) {
  const [docs, setDocs] = useState([]);
  const [responseNote, setResponseNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (inspection) {
      setDocs([]);
      setResponseNote('');
    }
  }, [inspection]);

  if (!inspection) return null;

  const uploadDocs = async () => {
    if (docs.length === 0) return alert('Select at least one document.');
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of docs) fd.append('docs', f);
      await api.put(`/qc-inspections/${inspection.id}/upload-docs`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDocs([]);
      onActioned();
      alert('Documents uploaded successfully. You may now send for re-review.');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to upload documents');
    }
    setUploading(false);
  };

  const sendForReReview = async () => {
    if (!confirm('Send this inspection back to QC for re-review?')) return;
    setReviewing(true);
    try {
      await api.put(`/qc-inspections/${inspection.id}/re-review`, {
        responseNote: responseNote.trim() || undefined,
      });
      onClose();
      onActioned();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send for re-review');
    }
    setReviewing(false);
  };

  const order = inspection.purchaseOrder;
  return (
    <Modal isOpen={!!inspection} onClose={onClose}
      title={`Address On-Hold — ${inspection.inspectionNumber}`} size="lg">
      <div className="space-y-4">
        <div className="border-l-4 border-orange-500 bg-orange-50 rounded-r-md p-3">
          <div className="text-xs font-semibold text-orange-900 flex items-center gap-1">
            <AlertCircle size={12} /> QC placed this inspection on hold
          </div>
          <p className="text-sm text-orange-900 mt-1 whitespace-pre-wrap">{inspection.pendingReason || '—'}</p>
          {inspection.iteration > 0 && (
            <p className="text-xs text-orange-800 mt-1">Re-review iteration so far: #{inspection.iteration}</p>
          )}
        </div>

        <OrderInfoHeader order={order} />

        <InspectionDocsPanel order={order} inspection={inspection} />

        {inspection.docRequirement && inspection.docRequirement !== 'NONE' && (
          <div className="border border-amber-200 bg-amber-50 rounded-md p-3 text-xs">
            <div className="font-semibold text-amber-900">QC Expected: {inspection.docRequirement.replace('_', ' ')}</div>
            {inspection.docRequirementNote && (
              <div className="text-gray-700 mt-1">{inspection.docRequirementNote}</div>
            )}
          </div>
        )}

        {Array.isArray(inspection.uploadedDocs) && inspection.uploadedDocs.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold text-gray-700 mb-1">Already Uploaded</div>
            <ul className="space-y-1">
              {inspection.uploadedDocs.map((d, idx) => (
                <li key={idx}>
                  <a href={d.url} target="_blank" rel="noreferrer"
                    className="text-blue-600 hover:underline inline-flex items-center gap-1">
                    <Download size={11} /> {d.filename}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border border-gray-200 rounded-md p-3 space-y-2">
          <label className="block text-xs font-medium text-gray-700 flex items-center gap-1">
            <Upload size={12} /> Upload Additional Documents
          </label>
          <input type="file" multiple
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setDocs(Array.from(e.target.files || []))}
            className="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-100 file:text-blue-900 hover:file:bg-blue-200" />
          {docs.length > 0 && (
            <div className="text-xs text-gray-600">
              {docs.length} file{docs.length !== 1 ? 's' : ''}: {docs.map(f => f.name).join(', ')}
            </div>
          )}
          <Button size="sm" onClick={uploadDocs} disabled={uploading || docs.length === 0}>
            <Upload size={14} className="mr-1" /> {uploading ? 'Uploading...' : 'Upload Now'}
          </Button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Response Note for QC (optional)</label>
          <textarea value={responseNote} onChange={(e) => setResponseNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-navy-500"
            placeholder="e.g., COA attached from supplier; batch traceability confirmed." />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={sendForReReview} disabled={reviewing}>
            <RotateCcw size={16} className="mr-1" /> {reviewing ? 'Sending...' : 'Send for Re-review'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Read-only View (Admin / completed inspections) ───
function ViewInspectionModal({ inspection, onClose }) {
  if (!inspection) return null;
  const order = inspection.purchaseOrder;
  const docTypes = inspection.documentTypes || {};
  const docList = [
    docTypes.testReport && 'Test Report',
    docTypes.coc && 'COC',
    docTypes.coa && 'COA',
    docTypes.thirdParty && '3rd Party / Customer',
  ].filter(Boolean).join(', ') || '—';

  return (
    <Modal isOpen={!!inspection} onClose={onClose}
      title={`Inspection ${inspection.inspectionNumber}`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-gray-50 rounded-md p-3 flex-wrap gap-2">
          <div>
            <span className="text-xs text-gray-500">Result:</span>{' '}
            <Badge color={resultColor(inspection.result)}>{resultLabel(inspection.result)}</Badge>
            {inspection.iteration > 0 && (
              <Badge color="orange" className="ml-2">Re-review #{inspection.iteration}</Badge>
            )}
            {inspection.inspectedBy && (
              <span className="text-xs text-gray-500 ml-3">
                by {inspection.inspectedBy.name} • {formatDateTime(inspection.inspectedAt)}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 space-x-3">
            <span>PR Created: <strong>{fmtDate(order?.purchaseRequest?.createdAt) === '—' ? fmtDate(inspection.createdAt) : fmtDate(order?.purchaseRequest?.createdAt)}</strong></span>
            <span>PO Placed: <strong>{fmtDate(order?.createdAt)}</strong></span>
            <span>Inspection Created: <strong>{fmtDate(inspection.createdAt)}</strong></span>
          </div>
        </div>

        {inspection.result === 'ON_HOLD' && inspection.pendingReason && (
          <div className="border-l-4 border-orange-500 bg-orange-50 rounded-r-md p-3">
            <div className="text-xs font-semibold text-orange-900 flex items-center gap-1">
              <AlertCircle size={12} /> On Hold — Pending PO Action
            </div>
            <p className="text-xs text-orange-900 mt-1 whitespace-pre-wrap">{inspection.pendingReason}</p>
          </div>
        )}

        <OrderInfoHeader order={order} />

        <InspectionDocsPanel order={order} inspection={inspection} />

        {/* Page 1 — Request */}
        <div className="border border-gray-300 rounded-md overflow-hidden">
          <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 text-xs font-bold text-gray-700">
            Page 1 — Inspection Request
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs p-3">
            <div><span className="text-gray-500">Invoice No.:</span> <span>{inspection.invoiceNo || '—'}</span></div>
            <div><span className="text-gray-500">Invoice Date:</span> <span>{fmtDate(inspection.invoiceDate)}</span></div>
            <div><span className="text-gray-500">DC No.:</span> <span>{inspection.dcNo || '—'}</span></div>
            <div><span className="text-gray-500">Gate Pass No.:</span> <span>{inspection.gatePassNo || '—'}</span></div>
            <div><span className="text-gray-500">Gate Pass Type:</span> <span>{inspection.gatePassType || '—'}</span></div>
            <div><span className="text-gray-500">Receipt Date:</span> <span>{fmtDate(inspection.materialReceiptDate)}</span></div>
            {inspection.probableDateOfReturn && (
              <div><span className="text-gray-500">Prob. Return:</span> <span>{fmtDate(inspection.probableDateOfReturn)}</span></div>
            )}
            {inspection.notes && (
              <div className="col-span-3"><span className="text-gray-500">Notes:</span> <span>{inspection.notes}</span></div>
            )}
            {inspection.docRequirement && inspection.docRequirement !== 'NONE' && (
              <div className="col-span-3">
                <span className="text-gray-500">Docs Expected:</span>{' '}
                <span className="font-medium text-amber-800">{inspection.docRequirement.replace('_', ' ')}</span>
                {inspection.docRequirementNote && (
                  <span className="text-gray-700"> — {inspection.docRequirementNote}</span>
                )}
              </div>
            )}
            {Array.isArray(inspection.uploadedDocs) && inspection.uploadedDocs.length > 0 && (
              <div className="col-span-3">
                <span className="text-gray-500">Uploaded Docs:</span>{' '}
                <span className="inline-flex flex-wrap gap-x-3 gap-y-1 align-middle">
                  {inspection.uploadedDocs.map((d, idx) => (
                    <a key={idx} href={d.url} target="_blank" rel="noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-1">
                      <Download size={11} /> {d.filename}
                    </a>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Page 2 — Report (rendered for any non-pending result, including ON_HOLD with partial data) */}
        {(inspection.result !== 'PENDING' || inspection.reportNo) && (
          <div className="border border-gray-300 rounded-md overflow-hidden">
            <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-300 text-xs font-bold text-gray-700">
              Page 2 — Inspection Report
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs p-3">
              <div><span className="text-gray-500">Report No.:</span> <span>{inspection.reportNo || '—'}</span></div>
              <div><span className="text-gray-500">Report Date:</span> <span>{fmtDate(inspection.reportDate)}</span></div>
              <div><span className="text-gray-500">Category:</span> <span>{inspection.materialCategory || '—'}</span></div>
              <div className="col-span-3"><span className="text-gray-500">Description:</span> <span>{inspection.materialDescription || '—'}</span></div>
              <div><span className="text-gray-500">Documents:</span> <span>{docList}</span></div>
              <div><span className="text-gray-500">Location:</span> <span>{inspection.inspectionLocation || '—'}</span></div>
              <div><span className="text-gray-500">Ref. No.:</span> <span>{inspection.reportReferenceNo || '—'}</span></div>
              <div><span className="text-gray-500">Packing:</span> <span>{inspection.packingCondition || '—'}</span></div>
              <div><span className="text-gray-500">Batch No.:</span> <span>{inspection.batchNo || '—'}</span></div>
              <div><span className="text-gray-500">Mfg. Date:</span> <span>{fmtDate(inspection.dateOfManufacturing)}</span></div>
              <div><span className="text-gray-500">Expiry:</span> <span>{fmtDate(inspection.dateOfExpiry)}</span></div>
              <div><span className="text-gray-500">Tapped Holes:</span> <span>{inspection.tappedHolesCondition || '—'}</span></div>
              <div><span className="text-gray-500">Qty PR:</span> <span>{inspection.qtyAsPerPR ?? '—'}</span></div>
              <div><span className="text-gray-500">Qty Ordered:</span> <span>{inspection.qtyOrdered ?? '—'}</span></div>
              <div><span className="text-gray-500">Qty Received:</span> <span>{inspection.qtyReceived ?? '—'}</span></div>
              <div><span className="text-gray-500">Qty Accepted:</span> <span>{inspection.qtyAccepted ?? '—'}</span></div>
              <div><span className="text-gray-500">Qty Rejected:</span> <span>{inspection.qtyRejected ?? '—'}</span></div>
              <div><span className="text-gray-500">MIR No.:</span> <span>{inspection.mirNo || '—'}</span></div>
              {inspection.rejectionReason && (
                <div className="col-span-3"><span className="text-gray-500">Rejection Reason:</span> <span>{inspection.rejectionReason}</span></div>
              )}
              {inspection.remarks && (
                <div className="col-span-3"><span className="text-gray-500">Remarks:</span> <span>{inspection.remarks}</span></div>
              )}
            </div>

            {Array.isArray(inspection.parameters) && inspection.parameters.length > 0 && (
              <div className="border-t border-gray-300">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-300">
                      <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Parameter</th>
                      <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Expected</th>
                      <th className="px-3 py-1.5 text-left text-gray-600 font-semibold">Actual</th>
                      <th className="px-3 py-1.5 text-center text-gray-600 font-semibold">Pass</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspection.parameters.map((p, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="px-3 py-1.5">{p.name}</td>
                        <td className="px-3 py-1.5">{p.expected}</td>
                        <td className="px-3 py-1.5">{p.actual}</td>
                        <td className="px-3 py-1.5 text-center">
                          {p.passed ? <CheckCircle size={14} className="text-green-600 inline" /> : <XCircle size={14} className="text-red-600 inline" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {inspection.result === 'PENDING' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-xs text-yellow-800">
            Report has not been filled yet. Awaiting QC inspection.
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Page ───
export default function QCInspections() {
  const { user } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createForOrder, setCreateForOrder] = useState(null);
  const [fillReportFor, setFillReportFor] = useState(null);
  const [viewInspection, setViewInspection] = useState(null);
  const [holdActionFor, setHoldActionFor] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const isQC = user?.role === 'QC';
  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isSM = user?.role === 'STORE_MANAGER';
  const isAdmin = user?.role === 'ADMIN';
  const canCreateRequest = isPO || isSM || isQC;
  const refreshKey = useAutoRefresh();

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/qc-inspections', { params: { limit: 50, fromDate: fromDate || undefined, toDate: toDate || undefined } });
      setInspections(data.inspections);
      setPendingOrders(data.pendingOrders || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [fromDate, toDate, refreshKey]);

  // Orders needing a new inspection request (no PENDING or ON_HOLD inspection for current batch)
  const ordersNeedingRequest = pendingOrders.filter(
    o => !inspections.some(i => i.purchaseOrder?.id === o.id && (i.result === 'PENDING' || i.result === 'ON_HOLD'))
  );
  // Inspections awaiting QC report
  const pendingInspections = inspections.filter(i => i.result === 'PENDING');
  // Inspections placed on hold — PO/SM must act
  const onHoldInspections = inspections.filter(i => i.result === 'ON_HOLD');
  // Historic completed (excludes PENDING + ON_HOLD)
  const completedInspections = inspections.filter(i => i.result !== 'PENDING' && i.result !== 'ON_HOLD');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">QC Inspections</h1>
        <span className="text-xs text-gray-500">Role: {user?.role}</span>
      </div>

      <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />

      {/* Section 1: Orders Awaiting Inspection Request (PO / SM only) */}
      {canCreateRequest && ordersNeedingRequest.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Orders Awaiting Inspection Request
            <span className="ml-2 text-xs font-normal text-gray-500">
              ({ordersNeedingRequest.length}) — Create request so QC can inspect
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ordersNeedingRequest.map(order => (
              <Card key={order.id}>
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-navy-700">{order.customName}</h3>
                    <Badge color="purple">Goods Arrived</Badge>
                  </div>
                  <p className="text-sm text-gray-600">{order.supplierName}</p>
                  <p className="text-sm text-gray-600">{formatCurrency(order.totalAmount)}</p>
                  <p className="text-xs text-gray-400">{order.items?.length} items • PR: {order.purchaseRequest?.requestNumber}</p>
                  <p className="text-xs text-gray-400">Manager: {order.purchaseRequest?.manager?.name}</p>
                  <Button size="sm" onClick={() => setCreateForOrder(order)} className="w-full mt-2">
                    <ClipboardCheck size={14} className="mr-1" /> Create Inspection Request
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Pending Inspection Requests (QC only) */}
      {isQC && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Pending Inspection Requests
            <span className="ml-2 text-xs font-normal text-gray-500">
              ({pendingInspections.length}) — Fill inspection report
            </span>
          </h2>
          {pendingInspections.length === 0 ? (
            <Card>
              <div className="text-center py-6 text-gray-400 text-sm">No pending inspection requests.</div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingInspections.map(insp => (
                <Card key={insp.id}>
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold text-navy-700">{insp.inspectionNumber}</h3>
                      <Badge color="yellow">Pending</Badge>
                    </div>
                    <p className="text-sm text-gray-700">{insp.purchaseOrder?.customName}</p>
                    <p className="text-xs text-gray-500">Supplier: {insp.purchaseOrder?.supplierName}</p>
                    <p className="text-xs text-gray-500">Invoice: {insp.invoiceNo || '—'} • DC: {insp.dcNo || '—'}</p>
                    <p className="text-xs text-gray-500">Request by: {insp.requestCreatedBy?.name || '—'}</p>
                    <p className="text-xs text-gray-500">Received: {fmtDate(insp.materialReceiptDate)}</p>
                    <Button size="sm" onClick={() => setFillReportFor(insp)} className="w-full mt-2">
                      <FileCheck size={14} className="mr-1" /> Fill Report
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section 2b: On-Hold Inspections (PO / SM action required + QC visibility) */}
      {(isPO || isSM || isQC || isAdmin) && onHoldInspections.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <AlertCircle size={18} className="text-orange-500" />
            On-Hold Inspections
            <span className="text-xs font-normal text-gray-500">
              ({onHoldInspections.length}) — {isQC ? 'awaiting PO action' : 'PO must upload docs / address reason and resubmit'}
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {onHoldInspections.map(insp => (
              <Card key={insp.id} className="border-l-4 border-orange-400">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-navy-700">{insp.inspectionNumber}</h3>
                    <Badge color="orange">On Hold</Badge>
                  </div>
                  <p className="text-sm text-gray-700">{insp.purchaseOrder?.customName}</p>
                  <p className="text-xs text-gray-500">Supplier: {insp.purchaseOrder?.supplierName}</p>
                  <p className="text-xs text-gray-500">PR: {insp.purchaseOrder?.purchaseRequest?.requestNumber || '—'} • PO: {insp.purchaseOrder?.orderNumber}</p>
                  {insp.iteration > 0 && (
                    <p className="text-xs text-orange-700">Iteration: #{insp.iteration}</p>
                  )}
                  <div className="bg-orange-50 border border-orange-200 rounded-md p-2 text-xs text-orange-900">
                    <strong>Reason:</strong> {insp.pendingReason || '—'}
                  </div>
                  {Array.isArray(insp.uploadedDocs) && insp.uploadedDocs.length > 0 && (
                    <p className="text-xs text-gray-500">
                      Docs uploaded: {insp.uploadedDocs.length}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="secondary" onClick={() => setViewInspection(insp)} className="flex-1">
                      <Eye size={14} className="mr-1" /> View
                    </Button>
                    {(isPO || isSM) && (
                      <Button size="sm" onClick={() => setHoldActionFor(insp)} className="flex-1">
                        <Upload size={14} className="mr-1" /> Address
                      </Button>
                    )}
                    {isQC && (
                      <Button size="sm" onClick={() => setFillReportFor(insp)} className="flex-1">
                        <FileCheck size={14} className="mr-1" /> Re-inspect
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Section 3: Inspection History (everyone) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          {isAdmin ? 'All Inspections' : 'Inspection History'}
        </h2>
        <Card>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : inspections.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No inspections yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Inspection #</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Invoice / DC</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Result</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Req. By</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Inspector</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(isAdmin ? inspections : completedInspections).map(insp => (
                    <tr key={insp.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-navy-700">{insp.inspectionNumber}</td>
                      <td className="px-3 py-2 text-gray-600">{insp.purchaseOrder?.customName}</td>
                      <td className="px-3 py-2 text-gray-600">{insp.purchaseOrder?.supplierName}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">
                        {insp.invoiceNo || '—'} / {insp.dcNo || '—'}
                      </td>
                      <td className="px-3 py-2"><Badge color={resultColor(insp.result)}>{resultLabel(insp.result)}</Badge></td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{insp.requestCreatedBy?.name || '—'}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{insp.inspectedBy?.name || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(insp.inspectedAt || insp.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setViewInspection(insp)}>
                            <Eye size={14} className="mr-1" /> View
                          </Button>
                          {isQC && insp.result === 'PENDING' && (
                            <Button size="sm" onClick={() => setFillReportFor(insp)}>
                              <FileCheck size={14} className="mr-1" /> Fill
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Modals */}
      <CreateRequestModal order={createForOrder} onClose={() => setCreateForOrder(null)} onCreated={fetchData} />
      <FillReportModal inspection={fillReportFor} onClose={() => setFillReportFor(null)} onUpdated={fetchData} />
      <HoldActionModal inspection={holdActionFor} onClose={() => setHoldActionFor(null)} onActioned={fetchData} />
      <ViewInspectionModal inspection={viewInspection} onClose={() => setViewInspection(null)} />
    </div>
  );
}
