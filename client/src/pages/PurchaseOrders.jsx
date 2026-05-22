import { useState, useEffect, useMemo } from 'react';
import {
  Truck, CreditCard, CheckCircle, Eye, PackagePlus,
  ChevronRight, ChevronDown, Phone, Building2, FileText, Package, Layers, Clock,
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
import POPdf from '../components/pdf/POPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import DownloadWordButton from '../components/pdf/DownloadWordButton';
import { buildPOWordHtml } from '../components/pdf/POWordHtml';

const formatCurrency = (amt) => `₹${Number(amt || 0).toLocaleString('en-IN')}`;

const statusColor = (s) => ({
  PENDING_ACCOUNTING: 'amber',
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
}[s] || 'gray');

const statusLabel = (s) => ({
  PENDING_ACCOUNTING: 'Awaiting Accounting',
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

// ─── Inward Inspection Request Form (RAPS/IIR Rev 01, page 1) ───
function IIRForm({ order, iir, setIir, processing, onCancel, onSubmit }) {
  const prNumber = order.purchaseRequest?.requestNumber
    || (order.sourceRequests || []).map(s => s.purchaseRequest?.requestNumber).filter(Boolean).join(', ')
    || '—';
  const prDate = order.purchaseRequest?.createdAt
    ? new Date(order.purchaseRequest.createdAt).toLocaleDateString('en-IN')
    : '—';
  const poDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-IN')
    : '—';

  const prItemsById = new Map(
    (order.purchaseRequest?.items || []).map(it => [it.id, it])
  );
  const materialDescription = (order.items || [])
    .map(i => {
      const prItem = prItemsById.get(i.purchaseRequestItemId);
      const spec = prItem?.materialSpecification ? ` (${prItem.materialSpecification})` : '';
      return `${i.productName}${spec}`;
    })
    .join('; ') || '—';
  const totalQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  const qtyText = (order.items || [])
    .map(i => `${i.quantity} ${i.productUnit || ''}`)
    .join(', ');
  const scopeOfWork = order.customName || materialDescription;

  const supplierLine = [order.supplierName, order.quotation?.supplierContact, order.quotation?.supplierAddress]
    .filter(Boolean)
    .join(' · ');
  const budgetaryQuote = order.quotation
    ? `Quotation ${order.quotation.quotationNumber} — ₹${Number(order.quotation.totalAmount || 0).toLocaleString('en-IN')}`
    : '—';

  const Row = ({ sno, label, children, sectionFirst }) => (
    <tr className={sectionFirst ? 'border-t-2 border-gray-300' : ''}>
      <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium w-12 text-center align-top">{sno}</td>
      <td className="border border-gray-300 px-2 py-1.5 text-xs w-1/3 align-top">{label}</td>
      <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">{children}</td>
    </tr>
  );

  const SectionHeader = ({ children }) => (
    <tr>
      <td colSpan={3} className="border border-gray-300 px-2 py-1.5 text-xs font-bold text-center bg-gray-100 uppercase tracking-wide">
        {children}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Letterhead-style header */}
      <div className="border border-gray-400 rounded-md overflow-hidden">
        <div className="grid grid-cols-3 bg-gray-50">
          <div className="p-3 border-r border-gray-400 flex items-center justify-center">
            <span className="font-bold text-lg text-navy-700">RAPS</span>
          </div>
          <div className="p-3 border-r border-gray-400 flex items-center justify-center text-center">
            <div>
              <div className="text-sm font-bold">INWARD INSPECTION</div>
              <div className="text-sm font-bold">REQUEST FORM</div>
            </div>
          </div>
          <div className="p-3 text-xs">
            <div><span className="font-medium">Form no.:</span> RAPS/IIR Rev 01</div>
            <div><span className="font-medium">Dt:</span> 01/09/2024</div>
          </div>
        </div>
        <div className="px-3 py-1.5 text-xs border-t border-gray-400 bg-white">
          <span className="font-medium">Inspection ION No. &amp; Date:</span>{' '}
          <span className="text-gray-500">(auto-generated on submission — {new Date().toLocaleDateString('en-IN')})</span>
        </div>
      </div>

      {/* The 16-row form */}
      <div className="overflow-x-auto">
        <table className="w-full border border-gray-300 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="border border-gray-300 px-2 py-1.5 text-xs w-12">S.no</th>
              <th className="border border-gray-300 px-2 py-1.5 text-xs">Details (To be filled by Purchase &amp; stores)</th>
              <th className="border border-gray-300 px-2 py-1.5 text-xs">Value</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeader>Purchase Requisition details</SectionHeader>
            <Row sno="01" label="Purchase requisition no. & Date">
              <span className="font-medium">{prNumber}</span>
              <span className="text-gray-500"> · {prDate}</span>
            </Row>
            <Row sno="02" label="Material description and Specification">
              {materialDescription}
            </Row>
            <Row sno="03" label="Quantity as per PR">
              {qtyText || `${totalQty}`}
            </Row>

            <SectionHeader>Enquiry &amp; Budgetary quote details</SectionHeader>
            <Row sno="04" label="Supplier details">
              {supplierLine || order.supplierName || '—'}
            </Row>
            <Row sno="05" label="Budgetary quote details">
              {budgetaryQuote}
            </Row>
            <Row sno="06" label="Supplier Assessment form">
              <span className="text-gray-500 italic">On file with Purchase team</span>
            </Row>

            <SectionHeader>Purchase order details</SectionHeader>
            <Row sno="07" label="Purchase order no. & date">
              <span className="font-medium">{order.orderNumber}</span>
              <span className="text-gray-500"> · {poDate}</span>
            </Row>
            <Row sno="08" label="Quantity ordered">
              {qtyText || `${totalQty}`}
            </Row>
            <Row sno="09" label="Delivery Required by">
              <span className="text-gray-500 italic">As per PO terms (mutually agreed)</span>
            </Row>
            <Row sno="10" label="Scope of Work as per PO">
              {scopeOfWork}
            </Row>

            <SectionHeader>Invoice &amp; DC Details</SectionHeader>
            <tr>
              <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium text-center align-top">11</td>
              <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">Invoice no. &amp; date <span className="text-red-600">*</span></td>
              <td className="border border-gray-300 px-2 py-1.5 align-top">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={iir.invoiceNo}
                    onChange={(e) => setIir({ ...iir, invoiceNo: e.target.value })}
                    placeholder="Invoice no."
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <input
                    type="date"
                    value={iir.invoiceDate}
                    onChange={(e) => setIir({ ...iir, invoiceDate: e.target.value })}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                </div>
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium text-center align-top">12</td>
              <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">DC no. if any</td>
              <td className="border border-gray-300 px-2 py-1.5 align-top">
                <input
                  type="text"
                  value={iir.dcNo}
                  onChange={(e) => setIir({ ...iir, dcNo: e.target.value })}
                  placeholder="Delivery challan no."
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium text-center align-top">13</td>
              <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">Gate pass no. (FIM/others)</td>
              <td className="border border-gray-300 px-2 py-1.5 align-top">
                <input
                  type="text"
                  value={iir.gatePassNo}
                  onChange={(e) => setIir({ ...iir, gatePassNo: e.target.value })}
                  placeholder="Gate pass no."
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium text-center align-top">14</td>
              <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">Gate pass type</td>
              <td className="border border-gray-300 px-2 py-1.5 align-top">
                <select
                  value={iir.gatePassType}
                  onChange={(e) => setIir({ ...iir, gatePassType: e.target.value })}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value="">— select —</option>
                  <option value="FIM">FIM</option>
                  <option value="OTHERS">Others</option>
                </select>
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium text-center align-top">15</td>
              <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">Probable date of Return</td>
              <td className="border border-gray-300 px-2 py-1.5 align-top">
                <input
                  type="date"
                  value={iir.probableDateOfReturn}
                  onChange={(e) => setIir({ ...iir, probableDateOfReturn: e.target.value })}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1.5 text-xs font-medium text-center align-top">16</td>
              <td className="border border-gray-300 px-2 py-1.5 text-xs align-top">Material receipt date @RAPS, Store <span className="text-red-600">*</span></td>
              <td className="border border-gray-300 px-2 py-1.5 align-top">
                <input
                  type="date"
                  value={iir.materialReceiptDate}
                  onChange={(e) => setIir({ ...iir, materialReceiptDate: e.target.value })}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer text */}
      <div className="border border-gray-300 rounded p-2 text-xs bg-gray-50">
        <span className="font-medium">Requesting QA/QC Group</span> to inspect the particulars mentioned above and inspect the material as per Material specification / Scope of PO.
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="border border-gray-300 rounded p-3 min-h-[60px]">
          <div className="font-medium text-gray-700">Stores / Purchase / Indenter</div>
          <div className="text-gray-500 mt-1 italic">Signed digitally on submission</div>
        </div>
        <div className="border border-gray-300 rounded p-3 min-h-[60px]">
          <div className="font-medium text-gray-700">Quality group</div>
          <div className="text-gray-500 mt-1 italic">Filled by QC on the Inspection Report (page 2)</div>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Submitting this form auto-creates a QC Inspection Request and notifies the QC team. Page 2 (Inspection Report) is filled by QC.
      </p>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="secondary" onClick={onCancel} disabled={processing}>Cancel</Button>
        <Button onClick={onSubmit} disabled={processing}>
          {processing ? 'Submitting...' : 'Submit & Notify QC'}
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
  const [showIirForm, setShowIirForm] = useState(false);
  const [iir, setIir] = useState({
    invoiceNo: '',
    invoiceDate: '',
    dcNo: '',
    gatePassNo: '',
    gatePassType: '',
    probableDateOfReturn: '',
    materialReceiptDate: '',
  });

  const isPO = userRole === 'PURCHASE_OFFICER';
  const isSM = userRole === 'STORE_MANAGER' || userRole === 'ADMIN';

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
    setIir({
      invoiceNo: '',
      invoiceDate: today,
      dcNo: '',
      gatePassNo: '',
      gatePassType: '',
      probableDateOfReturn: '',
      materialReceiptDate: today,
    });
    setShowIirForm(true);
  };

  const submitIir = async () => {
    if (!iir.invoiceNo.trim()) return alert('Invoice no. is required.');
    if (!iir.invoiceDate) return alert('Invoice date is required.');
    if (!iir.materialReceiptDate) return alert('Material receipt date is required.');
    setProcessing(true);
    try {
      await api.put(`/purchase-orders/${order.id}/goods-arrived`, {
        invoiceNo: iir.invoiceNo.trim(),
        invoiceDate: iir.invoiceDate,
        dcNo: iir.dcNo.trim() || undefined,
        gatePassNo: iir.gatePassNo.trim() || undefined,
        gatePassType: iir.gatePassType || undefined,
        probableDateOfReturn: iir.probableDateOfReturn || undefined,
        materialReceiptDate: iir.materialReceiptDate,
      });
      setShowIirForm(false);
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
    setProcessing(false);
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

  return (
    <Modal isOpen={!!order} onClose={onClose} title={`Order: ${order.customName}`} size="xl">
      <div className="space-y-4">
        <div className="bg-navy-50 border border-navy-200 rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-navy-600 font-medium">Order Name (set by unit manager on the PR)</div>
          <div className="text-xl font-bold text-navy-700">{order.customName}</div>
        </div>

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

        {/* Payment Progress */}
        <div className="bg-blue-50 rounded-md p-3">
          <ProgressBar value={order.totalPaid} total={order.totalAmount} label={`Paid: ${formatCurrency(order.totalPaid)} / ${formatCurrency(order.totalAmount)}`} />
          {order.advancePaid > 0 && <p className="text-xs text-blue-600 mt-1">Advance: {formatCurrency(order.advancePaid)}</p>}
          {remaining > 0 && <p className="text-xs text-red-600 mt-1">Remaining: {formatCurrency(remaining)}</p>}
        </div>

        {/* Items */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Materials in this order</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Material</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
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
                return (
                  <tr key={item.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{item.productName}</td>
                    <td className="px-3 py-2 text-gray-600">{item.quantity} {item.productUnit}</td>
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
              <div key={qc.id} className="bg-gray-50 p-3 rounded-md text-sm mb-2">
                <div className="flex justify-between">
                  <span className="font-medium">{qc.inspectionNumber}</span>
                  <Badge color={qc.result === 'PASSED' ? 'green' : qc.result === 'FAILED' ? 'red' : 'yellow'}>{qc.result}</Badge>
                </div>
                {qc.inspectedBy && <p className="text-xs text-gray-500 mt-1">By: {qc.inspectedBy.name} {qc.inspectedAt ? `on ${formatDateTime(qc.inspectedAt)}` : ''}</p>}
                {qc.notes && <p className="text-xs text-gray-500 mt-1">Notes: {qc.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-2 border-t items-center">
          <DownloadPdfButton document={<POPdf order={order} />} fileName={`PO-${order.orderNumber}.pdf`} label="Download PO PDF" />
          <DownloadWordButton
            html={buildPOWordHtml(order)}
            fileName={`PO-${order.orderNumber}`}
            title={`Purchase Order ${order.orderNumber}`}
            label="Download PO Word"
          />

          {isPO && isPendingAccounting && (
            <>
              {!showPaymentForm ? (
                <Button onClick={() => setShowPaymentForm(true)}>
                  <CheckCircle size={16} className="mr-1" /> Place Order (Send to Accounting)
                </Button>
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

          {isPO && ['ORDERED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'PARTIAL'].includes(order.status) && (
            <Button onClick={openIirForm} disabled={processing}>
              <Truck size={16} className="mr-1" />
              {order.items?.some(i => (i.receivedQty || 0) > 0) ? 'Mark More Goods Arrived' : 'Mark Goods Arrived'}
            </Button>
          )}

          {isSM && order.status === 'QC_PASSED' && (
            <Button onClick={doInward} disabled={processing}>
              <PackagePlus size={16} className="mr-1" /> {processing ? 'Processing...' : 'Record Inward Entry'}
            </Button>
          )}
        </div>
      </div>

      {showIirForm && (
        <Modal isOpen onClose={() => setShowIirForm(false)} title={`Inward Inspection Request Form — ${order.orderNumber}`} size="xl">
          <IIRForm
            order={order}
            iir={iir}
            setIir={setIir}
            processing={processing}
            onCancel={() => setShowIirForm(false)}
            onSubmit={submitIir}
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
          {orders.map(o => (
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
                  </div>
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
          ))}
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
              {isUnion ? (orders[0]?.customName || 'Union Order') : (prInfo?.requestId || prNumber)}
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

  const tabs = ['ALL', 'PENDING_ACCOUNTING', 'ORDERED', 'PAID', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
        <div className="text-xs text-gray-500">
          Grouped by purchase request → supplier → material
        </div>
      </div>

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
