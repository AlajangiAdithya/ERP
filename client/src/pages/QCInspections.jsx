import { useState, useEffect } from 'react';
import { ClipboardCheck, CheckCircle, XCircle, Plus, Eye, FileCheck, X } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
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
}[r] || 'gray');

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
              <div className="col-span-2"><span className="text-gray-500">Scope of Work:</span> <span>{scopes.join(' / ')}</span></div>
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
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (order) {
      setInvoiceNo(''); setInvoiceDate(''); setDcNo('');
      setGatePassNo(''); setGatePassType('');
      setProbableDateOfReturn('');
      setMaterialReceiptDate(new Date().toISOString().slice(0, 10));
      setNotes('');
    }
  }, [order]);

  const submit = async () => {
    if (!order) return;
    if (!invoiceNo.trim() && !dcNo.trim()) {
      return alert('Invoice No. or DC No. is required');
    }
    setProcessing(true);
    try {
      await api.post('/qc-inspections', {
        purchaseOrderId: order.id,
        invoiceNo: invoiceNo || undefined,
        invoiceDate: invoiceDate || undefined,
        dcNo: dcNo || undefined,
        gatePassNo: gatePassNo || undefined,
        gatePassType: gatePassType || undefined,
        probableDateOfReturn: probableDateOfReturn || undefined,
        materialReceiptDate: materialReceiptDate || undefined,
        notes: notes || undefined,
      });
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
  const [documentTypes, setDocumentTypes] = useState({ testReport: false, coc: false, coa: false, thirdParty: false });
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
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (inspection) {
      setReportNo(inspection.reportNo || '');
      setReportDate(inspection.reportDate?.slice(0, 10) || new Date().toISOString().slice(0, 10));
      setMaterialDescription(inspection.materialDescription || '');
      setMaterialCategory(inspection.materialCategory || '');
      setDocumentTypes(inspection.documentTypes || { testReport: false, coc: false, coa: false, thirdParty: false });
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
    }
  }, [inspection]);

  const addParam = () => setParameters([...parameters, { name: '', expected: '', actual: '', passed: true }]);
  const removeParam = (idx) => parameters.length > 1 && setParameters(parameters.filter((_, i) => i !== idx));
  const updateParam = (idx, field, value) => {
    const updated = [...parameters];
    updated[idx] = { ...updated[idx], [field]: value };
    setParameters(updated);
  };

  const submit = async (resultValue) => {
    if (!inspection) return;
    if (!reportNo.trim()) return alert('Report No. is required');
    if (!confirm(`Submit inspection result as ${resultValue}?`)) return;
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
          </div>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Document Types Available</label>
              <div className="flex flex-wrap gap-3 text-xs pt-2">
                {[
                  { key: 'testReport', label: 'Test Report' },
                  { key: 'coc', label: 'COC' },
                  { key: 'coa', label: 'COA' },
                  { key: 'thirdParty', label: '3rd Party / Customer' },
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Inspection Location</label>
              <select value={inspectionLocation} onChange={(e) => setInspectionLocation(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-navy-500">
                <option value="">Select location</option>
                <option value="At Supplier Place">At Supplier Place</option>
                <option value="At RAPS Inward">At RAPS Inward</option>
              </select>
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
            <Input label="Qty Received" type="number" value={qtyReceived}
              onChange={(e) => setQtyReceived(e.target.value)} />
            <Input label="Qty Accepted" type="number" value={qtyAccepted}
              onChange={(e) => setQtyAccepted(e.target.value)} />
            <Input label="Qty Rejected" type="number" value={qtyRejected}
              onChange={(e) => setQtyRejected(e.target.value)} />
          </div>
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

        {/* Submit actions */}
        <div className="flex flex-wrap gap-3 pt-3 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <div className="flex-1" />
          <Button onClick={() => submit('PASSED')} disabled={processing}>
            <CheckCircle size={16} className="mr-1" /> Pass
          </Button>
          <Button variant="secondary" onClick={() => submit('PARTIAL')} disabled={processing}>
            Partial
          </Button>
          <Button variant="danger" onClick={() => submit('FAILED')} disabled={processing}>
            <XCircle size={16} className="mr-1" /> Fail
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
        <div className="flex items-center justify-between bg-gray-50 rounded-md p-3">
          <div>
            <span className="text-xs text-gray-500">Result:</span>{' '}
            <Badge color={resultColor(inspection.result)}>{inspection.result}</Badge>
            {inspection.inspectedBy && (
              <span className="text-xs text-gray-500 ml-3">
                by {inspection.inspectedBy.name} • {formatDateTime(inspection.inspectedAt)}
              </span>
            )}
          </div>
        </div>

        <OrderInfoHeader order={order} />

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
          </div>
        </div>

        {/* Page 2 — Report */}
        {inspection.result !== 'PENDING' && (
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

  const isQC = user?.role === 'QC';
  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isSM = user?.role === 'STORE_MANAGER';
  const isAdmin = user?.role === 'ADMIN';
  const canCreateRequest = isPO || isSM;

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/qc-inspections', { params: { limit: 50 } });
      setInspections(data.inspections);
      setPendingOrders(data.pendingOrders || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Orders that still need an inspection request (no inspection yet)
  const ordersNeedingRequest = pendingOrders.filter(
    o => !inspections.some(i => i.purchaseOrder?.id === o.id)
  );
  // Inspections awaiting QC report
  const pendingInspections = inspections.filter(i => i.result === 'PENDING');
  // Historic completed
  const completedInspections = inspections.filter(i => i.result !== 'PENDING');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">QC Inspections</h1>
        <span className="text-xs text-gray-500">Role: {user?.role}</span>
      </div>

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
                      <td className="px-3 py-2"><Badge color={resultColor(insp.result)}>{insp.result}</Badge></td>
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
      <ViewInspectionModal inspection={viewInspection} onClose={() => setViewInspection(null)} />
    </div>
  );
}
