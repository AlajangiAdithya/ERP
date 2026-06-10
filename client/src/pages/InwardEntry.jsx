import { useState, useEffect } from 'react';
import { Check, Package, ClipboardList, Truck, Plus, FileInput, FileText, Trash2, Send } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import SearchBar from '../components/shared/SearchBar';
import { formatDate, formatDateTime } from '../utils/formatters';
import InwardPdf from '../components/pdf/InwardPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import PageHero from '../components/shared/PageHero';
import { checkFileSize } from '../utils/fileGuard';

// Stores does the actual inward work. Manager / QC / Designs / R&D get a
// read-only view so they can trace what's pending and what has already
// been inwarded without being able to mutate anything.
const INWARD_WRITE_ROLES = ['ADMIN', 'STORE_MANAGER'];

// Helper: pick the latest PASSED/PARTIAL inspection (the lot ready for inward)
function activeInspectionOf(order) {
  return (order.qcInspections || []).find(
    i => i.result === 'PASSED' || i.result === 'PARTIAL'
  );
}

// Helper: total arrived-so-far across all lots on this PO (lots already inwarded + this one)
function cumulativeArrived(order) {
  return (order.qcInspections || []).reduce((s, i) => s + (i.arrivedQty || 0), 0);
}

export default function InwardEntry() {
  const { user } = useAuth();
  const canEdit = INWARD_WRITE_ROLES.includes(user?.role);
  const [mode, setMode] = useState('po');
  const [success, setSuccess] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onSuccess = (msg) => {
    setSuccess(msg);
    setRefreshKey(k => k + 1);
    setTimeout(() => setSuccess(null), 8000);
  };

  const tabBtn = (key, label, Icon) => (
    <button onClick={() => setMode(key)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
        mode === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}>
      <Icon size={16} className="inline mr-2" />{label}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHero
        title="Inward Entry"
        subtitle={canEdit
          ? 'Record materials received into stores and generate MIV PDFs.'
          : 'Track what is ready for inwarding and what has already been received.'}
        eyebrow="Stores"
        icon={Package}
      />

      {success && (
        <Card className="border-green-200 bg-green-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Check size={20} className="text-green-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-green-800">{success.title}</p>
              <p className="text-sm text-green-600">{success.message}</p>
            </div>
            {success.pdfData && (
              <DownloadPdfButton
                document={<InwardPdf data={success.pdfData} />}
                fileName={`MIV-${success.pdfData.mivNumber || new Date().toISOString().slice(0, 10)}.pdf`}
                label="View MIV PDF"
              />
            )}
          </div>
        </Card>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {tabBtn('po', 'From Purchase Order', Truck)}
        {tabBtn('direct', 'Direct Entry / Cash Purchase', ClipboardList)}
        {tabBtn('gatepass', 'From Gate Pass (FIM)', FileInput)}
      </div>

      {mode === 'po' && <FromPOMode onSuccess={onSuccess} refreshKey={refreshKey} canEdit={canEdit} />}
      {mode === 'direct' && <DirectEntryMode onSuccess={onSuccess} canEdit={canEdit} />}
      {mode === 'gatepass' && <FromGatePassMode onSuccess={onSuccess} refreshKey={refreshKey} canEdit={canEdit} />}
    </div>
  );
}

// ─── From PO Mode ───
// PENDING list = QC-passed orders awaiting inward (PARTIAL stays here too: more lots may still arrive).
// INWARDED list = orders with at least one completed inward (INWARD_DONE / COMPLETED / CLOSED).
const PO_PENDING_STATUSES = ['QC_PASSED', 'PARTIAL'];
const PO_INWARDED_STATUSES = ['INWARD_DONE', 'COMPLETED', 'CLOSED'];

function FromPOMode({ onSuccess, refreshKey, canEdit }) {
  const [view, setView] = useState('pending'); // 'pending' | 'inwarded'
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);

  useEffect(() => {
    setLoading(true);
    const statuses = view === 'pending' ? PO_PENDING_STATUSES : PO_INWARDED_STATUSES;
    // Fetch each status bucket in parallel and merge — the list endpoint takes
    // a single status, so we just hit it once per status the user wants to see.
    // allSettled so a single failing status bucket doesn't blank the whole list.
    Promise.allSettled(
      statuses.map((s) => api.get('/purchase-orders', { params: { status: s, limit: 100 } })),
    )
      .then((results) => {
        const merged = results.flatMap((r) => {
          if (r.status === 'fulfilled') return r.value.data.orders || [];
          console.warn('[InwardEntry] status bucket fetch failed', r.reason?.message);
          return [];
        });
        // De-dupe by id in case the same order appears in overlapping buckets.
        const byId = new Map();
        for (const o of merged) byId.set(o.id, o);
        setOrders(Array.from(byId.values()));
      })
      .finally(() => setLoading(false));
  }, [refreshKey, view]);

  if (selectedOrder) {
    return (
      <POInwardForm
        order={selectedOrder}
        canEdit={canEdit && view === 'pending'}
        onCancel={() => setSelectedOrder(null)}
        onComplete={(msg) => { setSelectedOrder(null); onSuccess(msg); }}
      />
    );
  }

  const viewBtn = (key, label) => (
    <button
      onClick={() => setView(key)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        view === key
          ? 'bg-navy-700 text-white border-navy-700'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="text-lg font-semibold text-gray-800">
          {view === 'pending' ? 'QC-Passed Orders Pending Inward' : 'Orders Already Inwarded'}
        </h3>
        <div className="flex gap-2">
          {viewBtn('pending', 'Pending')}
          {viewBtn('inwarded', 'Inwarded')}
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : orders.length === 0 ? (
        <Card className="text-center text-gray-500 py-8">
          {view === 'pending'
            ? 'No QC-passed orders waiting for inward entry.'
            : 'No completed inward orders yet.'}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {orders.map(o => {
            const insp = activeInspectionOf(o);
            const totalOrdered = o.items?.reduce((s, i) => s + (i.quantity || 0), 0) || 0;
            const cumulative = cumulativeArrived(o);
            return (
              <Card key={o.id} className="cursor-pointer hover:border-navy-400 hover:shadow-md transition-all border border-gray-200"
                onClick={() => setSelectedOrder(o)}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-navy-700">{o.customName}</h4>
                    {insp?.lotNumber != null && (
                      <div className="mt-0.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block">
                        Lot {insp.lotNumber}
                        {insp.batchNo ? ` · Batch ${insp.batchNo}` : ''}
                        {insp.arrivedQty != null ? ` · ${insp.arrivedQty} arrived` : ''}
                      </div>
                    )}
                  </div>
                  <Badge color="green">QC Passed</Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Order:</span> {o.orderNumber}
                    {o.isUnion && (
                      <span className="text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                        UNION · {(o.sourceRequests?.length || 0)} PRs
                      </span>
                    )}
                  </div>
                  <div><span className="text-gray-500">Supplier:</span> {o.supplierName}</div>
                  <div><span className="text-gray-500">PR:</span> {o.isUnion
                    ? (o.sourceRequests || []).map(s => s.purchaseRequest?.requestNumber).filter(Boolean).join(', ') || '—'
                    : (o.purchaseRequest?.requestNumber || '—')}</div>
                  <div>
                    <span className="text-gray-500">Ordered:</span> {totalOrdered}
                    {cumulative > 0 && (
                      <span className="text-gray-500"> · Arrived so far: <strong className="text-gray-700">{cumulative}</strong></span>
                    )}
                    <span className="text-gray-500"> · {o.items?.length || 0} item(s)</span>
                  </div>
                  {insp?.createdAt && (
                    <div><span className="text-gray-500">This lot arrived:</span> {formatDateTime(insp.createdAt)}</div>
                  )}
                  {insp?.invoiceFileUrl && (
                    <div>
                      <a href={insp.invoiceFileUrl} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-navy-700 hover:underline">
                        <FileText size={12} /> Invoice (Lot {insp.lotNumber ?? '—'})
                      </a>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function POInwardForm({ order, onCancel, onComplete, canEdit }) {
  // Pull latest QC inspection (qcInspections come sorted desc from API) — this is the
  // current lot ready for inward.
  const latestInspection = activeInspectionOf(order);
  const qcAccepted = latestInspection?.qtyAccepted;
  const qcOrdered = latestInspection?.qtyOrdered;
  const lotNumber = latestInspection?.lotNumber;
  const lotArrivedQty = latestInspection?.arrivedQty;
  const invoiceUrl = latestInspection?.invoiceFileUrl;
  // Batch number is set ONCE by Purchase Officer at goods-arrival. Locked thereafter —
  // shown read-only here and stamped onto every ProductBatch row by the server.
  const lockedBatchNo = latestInspection?.batchNo;
  // Per-PO-item arrived qty for this specific lot
  const arrivedByItem = Object.fromEntries(
    (latestInspection?.items || []).map(it => [it.purchaseOrderItemId, it.arrivedQty || 0]),
  );
  const totalOrderedQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  // Ratio of accepted to arrived — used to back off prefill when QC rejected some material
  const acceptRatio = (qcAccepted != null && qcOrdered > 0)
    ? (qcAccepted / qcOrdered)
    : (qcAccepted != null && lotArrivedQty > 0)
      ? (qcAccepted / lotArrivedQty)
      : 1;

  const [items, setItems] = useState(
    (order.items || []).map(i => {
      // Prefer per-item arrived qty from QCInspectionItem; fall back to ordered.
      const arrived = arrivedByItem[i.id] != null ? arrivedByItem[i.id] : i.quantity;
      const prefill = Math.round(arrived * acceptRatio * 100) / 100;
      return {
        id: i.id,
        productName: i.productName,
        quantity: i.quantity,
        arrivedQty: arrived,
        productUnit: i.productUnit,
        receivedQty: prefill,
      };
    })
  );
  const [saving, setSaving] = useState(false);
  const totalAllowed = qcAccepted != null ? qcAccepted : (lotArrivedQty != null ? lotArrivedQty : totalOrderedQty);
  // All lots on this PO, in chronological order
  const allLots = [...(order.qcInspections || [])].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
  const cumulativeSoFar = cumulativeArrived(order);

  const updateItem = (idx, field, value) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [field]: value };
    setItems(copy);
  };

  const submit = async () => {
    // Inward qty is locked to QC-accepted (auto-prefilled from QC report).
    // Stores Incharge can only confirm the entry — they cannot alter the qty.
    if (items.some(i => !i.receivedQty || parseFloat(i.receivedQty) <= 0)) {
      return alert('QC has not finalised an accepted quantity for this lot yet — cannot inward.');
    }
    setSaving(true);
    try {
      await api.put(`/purchase-orders/${order.id}/inward`, {
        items: items.map(i => ({
          id: i.id,
          receivedQty: parseFloat(i.receivedQty),
        })),
      });
      onComplete({
        title: 'Inward entry recorded',
        message: `${order.customName} (${order.orderNumber}) — Lot ${lotNumber ?? '—'} (Batch ${lockedBatchNo || '—'}) inwarded.`,
        pdfData: {
          mivNumber: `MIV-${order.orderNumber}${lotNumber != null ? `-L${lotNumber}` : ''}`,
          date: new Date().toISOString(),
          supplierName: order.supplierName,
          orderNumber: order.orderNumber,
          prNumber: order.purchaseRequest?.requestNumber,
          customName: order.customName,
          lotNumber,
          lotArrivedQty,
          batchNumber: lockedBatchNo,
          invoiceUrl,
          items: items.map(i => ({
            productName: i.productName,
            orderedQty: i.quantity,
            arrivedQty: i.arrivedQty,
            receivedQty: parseFloat(i.receivedQty),
            productUnit: i.productUnit,
            batchNumber: lockedBatchNo,
          })),
        },
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record inward');
    }
    setSaving(false);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-navy-700">{order.customName}</h3>
            {lotNumber != null && (
              <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                Lot {lotNumber}
                {lotArrivedQty != null ? ` · ${lotArrivedQty} arrived` : ''}
                {totalOrderedQty > 0 ? ` of ${totalOrderedQty} ordered` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Order: {order.orderNumber}
            {order.isUnion && (
              <span className="ml-1 text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                UNION · {(order.sourceRequests?.length || 0)} PRs
              </span>
            )}
            {' • '}Supplier: {order.supplierName} • PR: {order.isUnion
              ? (order.sourceRequests || []).map(s => s.purchaseRequest?.requestNumber).filter(Boolean).join(', ') || '—'
              : (order.purchaseRequest?.requestNumber || '—')}
          </p>
        </div>
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
      </div>

      {latestInspection && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 grid grid-cols-2 md:grid-cols-5 gap-2">
          <div>
            <div className="text-[10px] uppercase text-amber-700 font-semibold">Lot</div>
            <div className="font-bold text-amber-900">#{lotNumber ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-amber-700 font-semibold">Batch No (locked)</div>
            <div className="font-bold font-mono text-amber-900">{lockedBatchNo || '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-amber-700 font-semibold">Arrived (this lot)</div>
            <div className="font-bold">{lotArrivedQty ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-amber-700 font-semibold">Arrived (total so far)</div>
            <div className="font-bold">{cumulativeSoFar} of {totalOrderedQty}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-amber-700 font-semibold">Invoice</div>
            {invoiceUrl ? (
              <a href={invoiceUrl} target="_blank" rel="noreferrer"
                className="font-bold text-navy-700 hover:underline inline-flex items-center gap-1">
                <FileText size={12} /> View
              </a>
            ) : (
              <div className="text-amber-700">—</div>
            )}
          </div>
        </div>
      )}

      {latestInspection && qcAccepted != null && (
        <div className={`mb-3 rounded-md border p-3 text-xs ${
          qcAccepted < (lotArrivedQty ?? qcOrdered)
            ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
            : 'bg-green-50 border-green-300 text-green-800'
        }`}>
          <strong>QC Report ({latestInspection.inspectionNumber}):</strong>{' '}
          Received <strong>{latestInspection.qtyReceived ?? lotArrivedQty ?? '—'}</strong>,{' '}
          Accepted <strong>{qcAccepted}</strong>,{' '}
          Rejected <strong>{latestInspection.qtyRejected ?? 0}</strong>.
          {qcAccepted < (lotArrivedQty ?? qcOrdered)
            ? ' Inward quantity is locked to the QC-accepted total — Stores Incharge cannot alter it.'
            : ' Full arrived quantity accepted by QC. Inward quantity is locked to this total.'}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-300">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Product</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Ordered</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Arrived (Lot {lotNumber ?? '—'})</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Received (locked — QC accepted)</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Batch No (locked)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="px-3 py-2 font-medium text-gray-700">{it.productName}</td>
                <td className="px-3 py-2 text-gray-600">{it.quantity} {it.productUnit}</td>
                <td className="px-3 py-2 text-amber-800 font-semibold">
                  {it.arrivedQty != null ? `${it.arrivedQty} ${it.productUnit}` : '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-block min-w-[3rem] px-2 py-1 bg-gray-100 border border-gray-200 rounded text-sm font-semibold text-gray-800">
                    {it.receivedQty || 0}
                  </span>
                  <span className="ml-1 text-xs text-gray-500">{it.productUnit}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-amber-800 font-semibold">
                  {lockedBatchNo || <span className="text-gray-400 italic">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {allLots.length > 1 && (
        <div className="mt-4 border border-gray-200 rounded">
          <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 border-b border-gray-200">
            All lots on this PO
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="px-3 py-1.5 text-left">Lot</th>
                <th className="px-3 py-1.5 text-left">Batch No</th>
                <th className="px-3 py-1.5 text-left">Arrived</th>
                <th className="px-3 py-1.5 text-left">Date</th>
                <th className="px-3 py-1.5 text-left">QC Result</th>
                <th className="px-3 py-1.5 text-left">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {allLots.map(l => (
                <tr key={l.id} className={`border-t border-gray-100 ${l.id === latestInspection?.id ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-3 py-1.5 font-semibold">#{l.lotNumber ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-amber-800">{l.batchNo || '—'}</td>
                  <td className="px-3 py-1.5">{l.arrivedQty ?? '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600">{l.createdAt ? formatDateTime(l.createdAt) : '—'}</td>
                  <td className="px-3 py-1.5">
                    <Badge color={l.result === 'PASSED' ? 'green' : l.result === 'PARTIAL' ? 'yellow' : l.result === 'FAILED' ? 'red' : 'gray'}>
                      {l.result || 'PENDING'}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5">
                    {l.invoiceFileUrl ? (
                      <a href={l.invoiceFileUrl} target="_blank" rel="noreferrer"
                        className="text-navy-700 hover:underline inline-flex items-center gap-1">
                        <FileText size={11} /> PDF
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
        {canEdit && (
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Record Inward Entry'}
          </Button>
        )}
      </div>
    </Card>
  );
}

// ─── Direct Entry Mode ───
// Non-unit departments Stores can buy for (global requesters). Stock stays in
// the general pool; the department is stamped on the batch for traceability.
const ASSIGN_DEPTS = ['Safety', 'QC', 'Designs', 'Lab', 'Metrology', 'NDT', 'Planning', 'R&D', 'Others'];

// "Assign to" select value is 'unit:<id>' | 'dept:<name>' | '' (general stock).
function assignmentPayload(assignTo) {
  if (assignTo.startsWith('unit:')) return { unitId: assignTo.slice('unit:'.length) };
  if (assignTo.startsWith('dept:')) return { assignedDept: assignTo.slice('dept:'.length) };
  return {};
}

function assignmentLabel(assignTo, units) {
  if (assignTo.startsWith('unit:')) {
    const u = units.find(u => u.id === assignTo.slice('unit:'.length));
    return u ? `${u.name} (${u.code})` : 'unit';
  }
  if (assignTo.startsWith('dept:')) return assignTo.slice('dept:'.length);
  return '';
}

function AssignToSelect({ units, value, onChange }) {
  return (
    <Select label="Assign to (bought for)" value={value} onChange={onChange}>
      <option value="">Stores — general stock</option>
      <optgroup label="Units">
        {units.map(u => <option key={u.id} value={`unit:${u.id}`}>{u.name} ({u.code})</option>)}
      </optgroup>
      <optgroup label="Departments">
        {ASSIGN_DEPTS.map(d => <option key={d} value={`dept:${d}`}>{d}</option>)}
      </optgroup>
    </Select>
  );
}

function SupplierDetailsFields({ form, setForm }) {
  return (
    <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-3">
      <p className="text-xs font-medium text-gray-600">
        Supplier details (optional) — fill these for cash / direct purchases so they
        appear in the product's supplier history.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Input label="Supplier Name" value={form.supplierName}
          onChange={(e) => setForm({ ...form, supplierName: e.target.value })} placeholder="e.g. Local vendor" />
        <Input label="Supplier Contact" value={form.supplierContact}
          onChange={(e) => setForm({ ...form, supplierContact: e.target.value })} placeholder="Person / phone" />
        <Input label="Supplier Address" value={form.supplierAddress}
          onChange={(e) => setForm({ ...form, supplierAddress: e.target.value })} />
        <Input label="Unit Price (₹)" type="number" min="0" step="any" value={form.unitPrice}
          onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
      </div>
    </div>
  );
}

// Shared submit payload bits for both direct-entry forms.
function directEntryExtras(form) {
  return {
    ...assignmentPayload(form.assignTo),
    supplierName: form.supplierName.trim() || undefined,
    supplierContact: form.supplierContact.trim() || undefined,
    supplierAddress: form.supplierAddress.trim() || undefined,
    unitPrice: form.unitPrice && parseFloat(form.unitPrice) > 0 ? parseFloat(form.unitPrice) : undefined,
    dateOfManufacturing: form.mfgDate || undefined,
    dateOfExpiry: form.expiryDate || undefined,
  };
}

const blankDirectExtras = {
  assignTo: '', supplierName: '', supplierContact: '', supplierAddress: '', unitPrice: '',
  mfgDate: '', expiryDate: '',
};

function DirectEntryMode({ onSuccess, canEdit }) {
  const [subMode, setSubMode] = useState('existing');
  const [units, setUnits] = useState([]);

  useEffect(() => {
    if (!canEdit) return;
    api.get('/units')
      .then(({ data }) => setUnits(Array.isArray(data) ? data : (data.units || [])))
      .catch(() => setUnits([]));
  }, [canEdit]);

  if (!canEdit) {
    return (
      <Card className="text-center text-gray-500 py-10">
        <ClipboardList size={28} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm">
          Direct / cash-purchase inward is handled by Stores.
          There's no list to view here — completed direct entries appear in the
          product's stock movements once recorded.
        </p>
      </Card>
    );
  }

  const subBtn = (key, label, Icon) => (
    <button onClick={() => setSubMode(key)}
      className={`px-3 py-1.5 text-sm rounded-md border transition-colors inline-flex items-center ${
        subMode === key ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}>
      <Icon size={14} className="mr-1" />{label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {subBtn('existing', 'Existing Product', Package)}
        {subBtn('new', 'New Product', Plus)}
      </div>

      {subMode === 'existing' && <ExistingProductForm onSuccess={onSuccess} units={units} />}
      {subMode === 'new' && <NewProductForm onSuccess={onSuccess} units={units} />}
    </div>
  );
}

function ExistingProductForm({ onSuccess, units }) {
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState({ productId: '', quantity: '', batchNumber: '', notes: '', ...blankDirectExtras });
  const [saving, setSaving] = useState(false);

  const loadProducts = () =>
    api.get('/products', { params: { limit: 'all' } }).then(({ data }) => setProducts(data.products));

  useEffect(() => { loadProducts(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.productId || !form.quantity) return;
    setSaving(true);
    try {
      const { data } = await api.post('/inventory/inward', {
        productId: form.productId,
        quantity: parseFloat(form.quantity),
        batchNumber: form.batchNumber || undefined,
        notes: form.notes || undefined,
        ...directEntryExtras(form),
      });
      const assignedLabel = assignmentLabel(form.assignTo, units);
      onSuccess({
        title: 'Inward entry recorded',
        message: `${data.product?.name} — ${data.movement?.quantity} ${data.product?.unit} added. New stock: ${data.product?.currentStock}.${assignedLabel ? ` Assigned to ${assignedLabel}.` : ''}`,
        pdfData: {
          mivNumber: `MIV-DIRECT-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString(),
          supplierName: form.supplierName.trim() || 'Direct Entry',
          batchNumber: form.batchNumber,
          notes: form.notes,
          items: [{
            productName: data.product?.name,
            receivedQty: data.movement?.quantity,
            productUnit: data.product?.unit,
            batchNumber: form.batchNumber,
          }],
        },
      });
      setForm({ productId: '', quantity: '', batchNumber: '', notes: '', ...blankDirectExtras });
      loadProducts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record inward entry');
    }
    setSaving(false);
  };

  const selectedProduct = products.find(p => p.id === form.productId);
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.materialCode || '').toLowerCase().includes(productSearch.toLowerCase()) ||
    p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Select Product *</label>
          <SearchBar value={productSearch} onChange={setProductSearch} placeholder="Search by name or ID No..." />
          <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
            {filteredProducts.map(p => (
              <div
                key={p.id}
                onClick={() => { setForm({ ...form, productId: p.id }); setProductSearch(''); }}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer border-b border-gray-100 last:border-0 transition-colors ${
                  form.productId === p.id ? 'bg-navy-50 border-navy-200' : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{p.materialCode || p.sku}</span>
                </div>
                <span className="text-xs text-gray-500">Stock: {p.currentStock} {p.unit}</span>
              </div>
            ))}
          </div>
          {selectedProduct && (
            <p className="mt-2 text-sm text-navy-700">
              Selected: <strong>{selectedProduct.name}</strong> (Current: {selectedProduct.currentStock} {selectedProduct.unit})
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Input label="Quantity *" type="number" min="0.01" step="any" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          <Input label="Batch Number" value={form.batchNumber}
            onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} />
          <AssignToSelect units={units} value={form.assignTo}
            onChange={(e) => setForm({ ...form, assignTo: e.target.value })} />
          <Input label="Mfg Date" type="date" value={form.mfgDate}
            onChange={(e) => setForm({ ...form, mfgDate: e.target.value })} />
          <Input label="Expiry Date" type="date" value={form.expiryDate} min={form.mfgDate || undefined}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
        </div>

        <SupplierDetailsFields form={form} setForm={setForm} />

        <Input label="Notes" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.productId || !form.quantity}>
            {saving ? 'Recording…' : 'Record Inward Entry'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function NewProductForm({ onSuccess, units }) {
  const [form, setForm] = useState({
    name: '', materialCode: '', category: 'Others', unit: 'pcs',
    quantity: '', batchNumber: '', notes: '', ...blankDirectExtras,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.materialCode.trim() || !form.quantity) return;
    setSaving(true);
    try {
      const { data } = await api.post('/inventory/inward-new', {
        name: form.name,
        materialCode: form.materialCode.trim(),
        materialType: form.category || undefined,
        unit: form.unit || 'pcs',
        quantity: parseFloat(form.quantity),
        batchNumber: form.batchNumber || undefined,
        notes: form.notes || undefined,
        ...directEntryExtras(form),
      });
      const assignedLabel = assignmentLabel(form.assignTo, units);
      onSuccess({
        title: 'New product created & stocked',
        message: `${data.product.name} (ID No. ${data.product.materialCode || data.product.sku}) — ${data.movement.quantity} ${data.product.unit} added.${assignedLabel ? ` Assigned to ${assignedLabel}.` : ''}`,
        pdfData: {
          mivNumber: `MIV-NEW-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString(),
          supplierName: form.supplierName.trim() || 'Direct Entry (New Product)',
          batchNumber: form.batchNumber,
          notes: form.notes,
          items: [{
            productName: data.product.name,
            receivedQty: data.movement.quantity,
            productUnit: data.product.unit,
            batchNumber: form.batchNumber,
          }],
        },
      });
      setForm({ name: '', materialCode: '', category: 'Others', unit: 'pcs', quantity: '', batchNumber: '', notes: '', ...blankDirectExtras });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create product');
    }
    setSaving(false);
  };

  const unitOptions = ['kg', 'litre', 'pcs', 'meter', 'Sq. mtr', 'ton', 'box', 'drum', 'bag', 'roll', 'set'];
  const materialTypes = ['Raw Material', 'Consumable', 'Hand Tools & Fastners', 'Tools & Fixtures', 'Stationery', 'Others'];

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Product Name *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <div>
            <Input label="ID No. *" value={form.materialCode}
              onChange={(e) => setForm({ ...form, materialCode: e.target.value })} required
              placeholder="e.g. 1000" />
            <p className="mt-1 text-xs text-gray-400">Identification number — same as the ID No. column in the Products list.</p>
          </div>
          <Select label="Category" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {materialTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select label="Unit" value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
          </Select>
          <Input label="Quantity *" type="number" min="0.01" step="any" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          <Input label="Batch Number" value={form.batchNumber}
            onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} />
          <Input label="Mfg Date" type="date" value={form.mfgDate}
            onChange={(e) => setForm({ ...form, mfgDate: e.target.value })} />
          <Input label="Expiry Date" type="date" value={form.expiryDate} min={form.mfgDate || undefined}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          <AssignToSelect units={units} value={form.assignTo}
            onChange={(e) => setForm({ ...form, assignTo: e.target.value })} />
        </div>

        <SupplierDetailsFields form={form} setForm={setForm} />

        <Input label="Notes" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.name || !form.materialCode.trim() || !form.quantity}>
            {saving ? 'Creating…' : 'Create Product & Record Inward'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── From Gate Pass (FIM) Mode ──────────────────────────────────────────
// Records customer-supplied material (FIM) and accepts it into Products.
// Created ProductBatches are tagged FIM and linked back to the originating
// inward entry so we can trace each batch back to the customer.
function FromGatePassMode({ onSuccess, refreshKey, canEdit }) {
  const [view, setView] = useState('pending'); // 'pending' | 'accepted'
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showRecord, setShowRecord] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);

  const load = () => {
    setLoading(true);
    const status = view === 'pending' ? 'PENDING_ACCEPTANCE' : 'ACCEPTED';
    api.get('/gatepasses', { params: { direction: 'INWARD', status, limit: 100 } })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [refreshKey, localRefresh, view]);

  if (selected) {
    return (
      <AcceptInwardForm
        gatePass={selected}
        canEdit={canEdit && view === 'pending'}
        onCancel={() => setSelected(null)}
        onComplete={(msg) => { setSelected(null); load(); onSuccess(msg); }}
      />
    );
  }

  const viewBtn = (key, label) => (
    <button
      onClick={() => setView(key)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        view === key
          ? 'bg-navy-700 text-white border-navy-700'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-800">
          {view === 'pending' ? 'FIM Awaiting Acceptance' : 'Already Accepted FIM'}
        </h3>
        <div className="flex items-center gap-2">
          {viewBtn('pending', 'Pending')}
          {viewBtn('accepted', 'Accepted')}
          {canEdit && (
            <Button onClick={() => setShowRecord(true)}>
              <Plus size={14} /> Record Inward (FIM)
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Items recorded here are added to stock immediately — no separate acceptance step. They show up under
        Products → FIM Status straight away.
      </p>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : gatePasses.length === 0 ? (
        <Card className="text-center text-gray-500 py-8">
          {view === 'pending'
            ? 'No legacy inward entries awaiting acceptance. New ones are inwarded automatically on submission.'
            : 'No accepted FIM gate passes yet.'}
        </Card>
      ) : view === 'pending' ? (
        <div className="mb-3 text-xs text-amber-700">
          The entries below were created before auto-acceptance was enabled and still need to be processed.
        </div>
      ) : null}
      {!loading && gatePasses.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {gatePasses.map(g => {
            const pending = (g.items || []).filter(i => (i.inwardedQty || 0) < (i.quantity || 0));
            const inwardedCount = (g.items || []).length - pending.length;
            return (
              <Card key={g.id} className="cursor-pointer hover:border-navy-400 hover:shadow-md transition-all border border-gray-200"
                onClick={() => setSelected(g)}>
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-navy-700">{g.passNumber}</h4>
                  <Badge color={view === 'pending' ? 'yellow' : 'green'}>
                    {view === 'pending' ? 'Pending Acceptance' : 'Accepted'}
                  </Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div><span className="text-gray-500">Customer:</span> {g.customerName || '—'}</div>
                  <div><span className="text-gray-500">Customer GP:</span> {g.customerGatePassNo || '—'}{g.customerGatePassDate ? ` (${formatDate(g.customerGatePassDate)})` : ''}</div>
                  <div>
                    <span className="text-gray-500">Items {view === 'pending' ? 'pending' : 'accepted'}:</span>{' '}
                    {view === 'pending' ? pending.length : inwardedCount} of {g.items?.length || 0}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showRecord && canEdit && (
        <RecordInwardModal
          onClose={() => setShowRecord(false)}
          onCreated={() => { setShowRecord(false); setLocalRefresh(k => k + 1); }}
        />
      )}
    </div>
  );
}

// ─── Record Inward Modal ────────────────────────────────────────────────
// Captures customer FIM details and posts an INWARD gate pass (inwardKind
// STORES). Once submitted the entry lands in the list above for the store
// manager to accept into the product list via AcceptInwardForm.
const blankInwardItem = () => ({
  description: '', quantity: 1, unit: 'pcs',
  dispatchedTo: '', itemPurpose: '', probableReturnDate: '',
  itemPassType: 'RETURNABLE', gatePassDetails: '', transportation: '',
  contactPersonDetails: '', remarks: '',
});

function RecordInwardModal({ onClose, onCreated }) {
  const [customerName, setCustomerName] = useState('');
  const [customerGatePassNo, setCustomerGatePassNo] = useState('');
  const [customerGatePassDate, setCustomerGatePassDate] = useState('');
  const [customerGpDocType, setCustomerGpDocType] = useState('ORIGINAL');
  const [customerGpPdf, setCustomerGpPdf] = useState(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [gpRequisitionNo, setGpRequisitionNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState([blankInwardItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, blankInwardItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (!customerName.trim()) return setError('Customer name is required');
    if (!customerGatePassNo.trim()) return setError("Customer's gate pass number is required");
    if (items.some(i => !i.description.trim())) return setError('Each item needs a name/description');
    if (items.some(i => !i.quantity || Number(i.quantity) <= 0)) return setError('Each item needs a positive quantity');
    if (items.some(i => i.itemPassType === 'RETURNABLE' && !i.probableReturnDate)) {
      return setError('Returnable items need a probable date of return');
    }

    setSaving(true);
    try {
      const itemsPayload = items.map(i => ({
        description: i.description.trim(),
        quantity: Number(i.quantity),
        unit: i.unit || 'pcs',
        dispatchedTo: i.dispatchedTo?.trim() || null,
        itemPurpose: i.itemPurpose?.trim() || null,
        probableReturnDate: i.probableReturnDate || null,
        itemPassType: i.itemPassType || null,
        gatePassDetails: i.gatePassDetails?.trim() || null,
        transportation: i.transportation?.trim() || null,
        contactPersonDetails: i.contactPersonDetails?.trim() || null,
        remarks: i.remarks?.trim() || null,
      }));

      // Use multipart when a PDF is attached so the server can store the file alongside the GP record.
      if (customerGpPdf) {
        const fd = new FormData();
        fd.append('direction', 'INWARD');
        fd.append('inwardKind', 'STORES');
        if (remarks.trim()) fd.append('remarks', remarks.trim());
        fd.append('customerName', customerName.trim());
        fd.append('customerGatePassNo', customerGatePassNo.trim());
        if (customerGatePassDate) fd.append('customerGatePassDate', customerGatePassDate);
        fd.append('customerGpDocType', customerGpDocType);
        if (vehicleNo.trim()) fd.append('vehicleNo', vehicleNo.trim());
        if (driverName.trim()) fd.append('driverName', driverName.trim());
        if (gpRequisitionNo.trim()) fd.append('gpRequisitionNo', gpRequisitionNo.trim());
        fd.append('customerGpPdf', customerGpPdf);
        fd.append('items', JSON.stringify(itemsPayload));
        await api.post('/gatepasses', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/gatepasses', {
          direction: 'INWARD',
          inwardKind: 'STORES',
          remarks: remarks.trim() || undefined,
          customerName: customerName.trim(),
          customerGatePassNo: customerGatePassNo.trim(),
          customerGatePassDate: customerGatePassDate || null,
          customerGpDocType,
          vehicleNo: vehicleNo.trim() || null,
          driverName: driverName.trim() || null,
          gpRequisitionNo: gpRequisitionNo.trim() || null,
          items: itemsPayload,
        });
      }
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record inward entry');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Modal isOpen onClose={onClose} title="FIM / Customer Property Register Entry" size="full">
      <div className="space-y-5">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <p className="text-xs text-gray-500">
          FIM No. (RAPS/FIM/&lt;FY&gt;/&lt;count&gt;) and Date are auto-generated on submit. Returned Date and Return-by Vehicle/Driver are filled later when the material is sent back.
        </p>

        {/* Register header — applies to every row in this entry */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">FIM No.</label>
              <div className="px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-500 bg-white">
                Auto: RAPS/FIM/&lt;FY&gt;/&lt;next&gt;
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <div className="px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-500 bg-white">
                {new Date().toLocaleDateString()}
              </div>
            </div>
            <Input label="Customer *" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. ABC Pvt. Ltd." />
            <Input label="Gate Pass Requisition No." value={gpRequisitionNo} onChange={e => setGpRequisitionNo(e.target.value)} placeholder="Internal reference (if any)" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input label="Vehicle No." value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="e.g. AP 31 CD 1234" />
            <Input label="Driver name / sign" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Driver name" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice / DC / Gate Pass Type *</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                value={customerGpDocType}
                onChange={e => setCustomerGpDocType(e.target.value)}
              >
                <option value="ORIGINAL">Original</option>
                <option value="DUPLICATE">Duplicate</option>
              </select>
            </div>
            <Input type="date" label="Customer's GP date" value={customerGatePassDate} onChange={e => setCustomerGatePassDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Invoice / DC / Gate Pass Details *" value={customerGatePassNo} onChange={e => setCustomerGatePassNo(e.target.value)} placeholder="Customer's GP / DC / Invoice number" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload GP / DC / Invoice PDF (optional)</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => {
                  const f = e.target.files?.[0] || null;
                  if (f && !checkFileSize(f)) { e.target.value = ''; return; }
                  setCustomerGpPdf(f);
                }}
                className="w-full text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-navy-700 file:text-white hover:file:bg-navy-800"
              />
              {customerGpPdf && (
                <div className="mt-1 text-xs text-gray-500 truncate" title={customerGpPdf.name}>
                  {customerGpPdf.name}
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800">Items</h4>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add row</Button>
          </div>

          <div className="border border-gray-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1200 }}>
              <colgroup>
                <col style={{ width: '36px' }} />
                <col style={{ width: '220px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '40px' }} />
              </colgroup>
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr className="text-left">
                  <th className="px-3 py-2.5 text-center font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Item Description</th>
                  <th className="px-3 py-2.5 text-center font-medium">Quantity</th>
                  <th className="px-3 py-2.5 text-center font-medium">UOM</th>
                  <th className="px-3 py-2.5 font-medium">Purpose</th>
                  <th className="px-3 py-2.5 font-medium">Probable Return Date</th>
                  <th className="px-3 py-2.5 font-medium">Issued to Dept / Person</th>
                  <th className="px-3 py-2.5 font-medium">Pass Type</th>
                  <th className="px-3 py-2.5 font-medium">Remarks</th>
                  <th className="px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min="0" step="any" className={`${cellInput} text-right`}
                        value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={`${cellInput} text-center`}
                        value={it.unit} onChange={e => updateItem(idx, 'unit', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.itemPurpose} onChange={e => updateItem(idx, 'itemPurpose', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" className={cellInput}
                        value={it.probableReturnDate} onChange={e => updateItem(idx, 'probableReturnDate', e.target.value)}
                        disabled={it.itemPassType !== 'RETURNABLE'} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        placeholder="Dept / person"
                        value={it.dispatchedTo} onChange={e => updateItem(idx, 'dispatchedTo', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <select className={cellInput}
                        value={it.itemPassType} onChange={e => updateItem(idx, 'itemPassType', e.target.value)}>
                        <option value="RETURNABLE">Returnable</option>
                        <option value="NON_RETURNABLE">Non-Returnable</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.remarks} onChange={e => updateItem(idx, 'remarks', e.target.value)} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 disabled:opacity-30"
                        disabled={items.length === 1} title="Remove row">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Returned Date and Return-by Vehicle / Driver columns appear in the FIM register once the material is sent back via Delivery Challan.
          </p>
        </div>

        <Textarea label="Entry-level remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Send size={14} /> {saving ? 'Submitting…' : 'Record Inward'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AcceptInwardForm({ gatePass, onCancel, onComplete, canEdit }) {
  const items = (gatePass.items || []).filter(i => (i.inwardedQty || 0) < (i.quantity || 0));
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState(
    items.map(i => ({
      itemId: i.id,
      description: i.description,
      quantity: i.quantity,
      inwardedQty: i.inwardedQty || 0,
      unit: i.unit || 'pcs',
      probableReturnDate: i.probableReturnDate,
      itemPassType: i.itemPassType,
      // Form state
      mode: 'new', // 'new' | 'existing'
      productId: '',
      newName: i.description,
      newMaterialType: 'Others',
      acceptQty: (i.quantity || 0) - (i.inwardedQty || 0),
      batchNumber: '',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products', { params: { limit: 'all' } })
      .then(({ data }) => setProducts(data.products || []))
      .catch(() => setProducts([]));
  }, []);

  const update = (idx, field, value) => {
    const copy = [...rows];
    copy[idx] = { ...copy[idx], [field]: value };
    setRows(copy);
  };

  const submit = async () => {
    setError('');
    for (const r of rows) {
      const qty = parseFloat(r.acceptQty);
      const remaining = r.quantity - r.inwardedQty;
      if (!qty || qty <= 0) return setError(`Enter accept qty for ${r.description}`);
      if (qty > remaining + 1e-9) return setError(`${r.description}: cannot accept ${qty} (only ${remaining} pending)`);
      if (r.mode === 'existing' && !r.productId) return setError(`${r.description}: select a product or switch to "New product"`);
      if (r.mode === 'new' && !r.newName.trim()) return setError(`${r.description}: new product name is required`);
    }

    setSaving(true);
    try {
      await api.put(`/gatepasses/${gatePass.id}/accept-inward`, {
        items: rows.map(r => ({
          itemId: r.itemId,
          quantity: parseFloat(r.acceptQty),
          batchNumber: r.batchNumber || undefined,
          productId: r.mode === 'existing' ? r.productId : undefined,
          newProduct: r.mode === 'new' ? {
            name: r.newName.trim(),
            materialType: r.newMaterialType,
            unit: r.unit || 'pcs',
          } : undefined,
        })),
      });
      onComplete({
        title: 'Inward gate pass accepted',
        message: `${rows.length} FIM item${rows.length === 1 ? '' : 's'} from ${gatePass.customerName || 'customer'} added to inventory.`,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept inward gate pass');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-navy-700">{gatePass.passNumber}</h3>
          <p className="text-xs text-gray-500">
            Customer: <strong>{gatePass.customerName}</strong> · Customer GP <strong>{gatePass.customerGatePassNo}</strong>
            {gatePass.customerGatePassDate ? ` (${formatDate(gatePass.customerGatePassDate)})` : ''}
            {' · '}
            Type: <strong>{gatePass.passType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}</strong>
          </p>
        </div>
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
      </div>

      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
        <strong>FIM (Free Issue Material):</strong> these items belong to the customer. Each accepted item creates (or adds to) a Product
        and marks the resulting batch as <em>FIM</em>, linked to this gate pass so the product can be traced back to the customer.
      </div>

      {error && <div className="p-3 mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

      <div className="space-y-4">
        {rows.map((r, idx) => (
          <div key={r.itemId} className="border border-gray-200 rounded p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-medium text-gray-800">{r.description}</span>
                <span className="ml-2 text-xs text-gray-500">
                  on gatepass: {r.quantity} {r.unit} · pending: {(r.quantity - r.inwardedQty).toFixed(2)} {r.unit}
                </span>
              </div>
              <Badge color={r.itemPassType === 'NON_RETURNABLE' ? 'orange' : 'blue'}>
                {r.itemPassType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}
              </Badge>
            </div>

            <div className="flex gap-3 text-xs mb-2">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={r.mode === 'new'} onChange={() => update(idx, 'mode', 'new')} />
                Create new product
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={r.mode === 'existing'} onChange={() => update(idx, 'mode', 'existing')} />
                Add to existing product
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
              {r.mode === 'new' ? (
                <>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Product name *</label>
                    <input className={cellInput}
                      value={r.newName} onChange={(e) => update(idx, 'newName', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Material type</label>
                    <select className={cellInput}
                      value={r.newMaterialType} onChange={(e) => update(idx, 'newMaterialType', e.target.value)}>
                      <option>Others</option>
                      <option>Raw Material</option>
                      <option>Consumable</option>
                      <option>Hand Tools & Fastners</option>
                      <option>Tools & Fixtures</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="md:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Pick product *</label>
                  <select className={cellInput}
                    value={r.productId} onChange={(e) => update(idx, 'productId', e.target.value)}>
                    <option value="">— Select existing product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Accept qty * ({r.unit})</label>
                <input type="number" min="0" step="any" className={cellInput}
                  value={r.acceptQty} onChange={(e) => update(idx, 'acceptQty', e.target.value)} />
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs text-gray-500 mb-1">Batch number (optional)</label>
                <input className={cellInput}
                  value={r.batchNumber} onChange={(e) => update(idx, 'batchNumber', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
        {canEdit && (
          <Button onClick={submit} disabled={saving || rows.length === 0}>
            {saving ? 'Saving…' : 'Accept & Inward FIM'}
          </Button>
        )}
      </div>
    </Card>
  );
}
