import { useState, useEffect } from 'react';
import {
  Building2, Calendar, Truck, User as UserIcon, ArrowRightLeft, AlertTriangle,
  Hash, PackageCheck, RotateCcw, FlaskConical, CheckCircle2, FileText, Pencil,
  Send, Package,
} from 'lucide-react';
import api from '../../api/axios';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Modal from '../ui/Modal';
import Input, { Select } from '../ui/Input';
import SearchBar from '../shared/SearchBar';

// ──── FIM / Customer Property register ────
// Lives on the Material Inward page: a FIM only exists because Stores recorded
// an INWARD gate pass for customer-owned material, so tracking what happened to
// it afterwards belongs next to that intake rather than in the stock list or on
// the outward gate pass registers.

// Uploaded docs (customer GP scans, FIM test reports) are served from the API
// origin, not the app origin — strip the trailing /api and prefix.
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '') || '';
const fileUrl = (u) => (u && u.startsWith('http') ? u : `${API_ORIGIN}${u || ''}`);

// Compute days-until-return for a FIM batch's probable return date.
// Returns { label, color } so the register can show a red countdown.
function returnCountdown(returnDate) {
  if (!returnDate) return null;
  const target = new Date(returnDate);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `OVERDUE by ${-diff} day${-diff === 1 ? '' : 's'}`, color: 'red', urgent: true };
  if (diff === 0) return { label: 'Due today', color: 'red', urgent: true };
  if (diff <= 3) return { label: `${diff} day${diff === 1 ? '' : 's'} left`, color: 'red', urgent: true };
  if (diff <= 7) return { label: `${diff} days left`, color: 'orange', urgent: false };
  return { label: `${diff} days left`, color: 'gray', urgent: false };
}

// FIM lifecycle stages, in order. Mirrors FIM_STAGES on the server — a batch's
// stage is derived from which columns are set, never stored separately.
const FIM_STATUS_ORDER = ['IN_STORES', 'ASSIGNED', 'ACCEPTED', 'READY_TO_SEND'];
const FIM_STATUS_LABELS = {
  IN_STORES: 'In stores (unassigned)',
  ASSIGNED: 'Assigned to unit — awaiting acceptance',
  ACCEPTED: 'Accepted by unit',
  READY_TO_SEND: 'Ready to collect / send out',
};

// Lists every FIM batch (customer-owned material inwarded via INWARD gate pass)
// with assignment + acceptance controls and a red return-date countdown.
// `onOpenProduct` is optional — the register links to the product page when the
// host screen can navigate there.
export default function FimStatusRegister({ user, onOpenProduct }) {
  const [batches, setBatches] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [assignTarget, setAssignTarget] = useState(null); // { batchId, productName }
  const [acceptTarget, setAcceptTarget] = useState(null); // { batchId, productName }
  const [editRemarkTarget, setEditRemarkTarget] = useState(null); // { batchId, productName, existing }
  const [readyTarget, setReadyTarget] = useState(null); // batch (unit manager marks ready)
  const [sendOutTarget, setSendOutTarget] = useState(null); // batch (stores ships)
  // ADMIN status override — the normal transitions are one-way, so this is the
  // only route back when a FIM ends up on the wrong unit or accepted in error.
  const [statusTarget, setStatusTarget] = useState(null); // batch
  const [statusForm, setStatusForm] = useState({ status: '', unitId: '', remark: '', note: '', reason: '' });
  // Probable return date — lives on the source inward gate pass line, and drives
  // the overdue countdown, so changing it is reasoned + logged.
  const [returnTarget, setReturnTarget] = useState(null); // batch
  const [returnForm, setReturnForm] = useState({ date: '', reason: '' });
  const [assigningUnitId, setAssigningUnitId] = useState('');
  const [acceptRemark, setAcceptRemark] = useState('');
  const [editRemarkText, setEditRemarkText] = useState('');
  const [readyNote, setReadyNote] = useState('');
  const [sendOutForm, setSendOutForm] = useState({ vehicleNo: '', driverName: '', remarks: '' });
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const isStores = user?.role === 'STORE_MANAGER' || user?.role === 'ADMIN';
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const fetchBatches = () => {
    setLoading(true);
    api.get('/products/fim-status', { params: { search: search || undefined, unitId: unitFilter || undefined } })
      .then(({ data }) => setBatches(data))
      .catch(() => setBatches([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBatches(); }, [search, unitFilter]);
  useEffect(() => {
    api.get('/units').then(({ data }) => setUnits(Array.isArray(data) ? data : (data.units || []))).catch(() => setUnits([]));
  }, []);

  const submitAssign = async () => {
    setActionError('');
    if (!assigningUnitId) return setActionError('Choose a unit');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${assignTarget.batchId}/assign`, { unitId: assigningUnitId });
      setAssignTarget(null);
      setAssigningUnitId('');
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to assign batch');
    }
    setActionBusy(false);
  };

  const submitAccept = async () => {
    setActionError('');
    if (!acceptRemark.trim()) return setActionError('A remark is required');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${acceptTarget.batchId}/unit-accept`, { remark: acceptRemark.trim() });
      setAcceptTarget(null);
      setAcceptRemark('');
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to accept batch');
    }
    setActionBusy(false);
  };

  const submitRemarkEdit = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${editRemarkTarget.batchId}/remarks`, { remark: editRemarkText });
      setEditRemarkTarget(null);
      setEditRemarkText('');
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to save remark');
    }
    setActionBusy(false);
  };

  const submitMarkReady = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${readyTarget.id}/mark-ready`, { note: readyNote.trim() || undefined });
      setReadyTarget(null);
      setReadyNote('');
      setFlash('Marked Ready to Collect — Stores has been notified.');
      setTimeout(() => setFlash(''), 6000);
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to mark ready');
    }
    setActionBusy(false);
  };

  const withdrawReady = async (batch) => {
    if (!window.confirm(`Withdraw the "ready to send out" flag on ${batch.product.name}?`)) return;
    try {
      await api.put(`/gatepasses/fim-batches/${batch.id}/unmark-ready`);
      fetchBatches();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to withdraw ready flag');
    }
  };

  // Current lifecycle stage of a batch, mirroring the server's fimStageOf().
  const stageOf = (b) => {
    if (b.readyToSendOutAt) return 'READY_TO_SEND';
    if (b.unitAcceptedAt) return 'ACCEPTED';
    if (b.assignedToUnitId) return 'ASSIGNED';
    return 'IN_STORES';
  };

  const openStatusOverride = (b) => {
    setStatusTarget(b);
    setStatusForm({
      status: stageOf(b),
      unitId: b.assignedToUnitId || '',
      remark: b.unitAcceptedRemarks || '',
      note: b.readyToSendOutNote || '',
      reason: '',
    });
    setActionError('');
  };

  const submitStatusOverride = async () => {
    setActionError('');
    const { status, unitId, remark, note, reason } = statusForm;
    if (!status) return setActionError('Choose a status');
    if (status !== 'IN_STORES' && !unitId) return setActionError('Choose the unit this FIM sits with');
    if ((status === 'ACCEPTED' || status === 'READY_TO_SEND') && !remark.trim()) {
      return setActionError('An acceptance remark is required for this status');
    }
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${statusTarget.id}/status`, {
        status,
        unitId: status === 'IN_STORES' ? undefined : unitId,
        remark: remark.trim() || undefined,
        note: note.trim() || undefined,
        reason: reason.trim(),
      });
      setStatusTarget(null);
      setFlash('FIM status updated — the unit and Stores have been notified.');
      setTimeout(() => setFlash(''), 6000);
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to change status');
    }
    setActionBusy(false);
  };

  const openReturnEdit = (b) => {
    const existing = b.sourceInwardGatePassItem?.probableReturnDate;
    setReturnTarget(b);
    setReturnForm({ date: existing ? String(existing).slice(0, 10) : '', reason: '' });
    setActionError('');
  };

  const submitReturnDate = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${returnTarget.id}/probable-return`, {
        probableReturnDate: returnForm.date || null,
        reason: returnForm.reason.trim(),
      });
      setReturnTarget(null);
      setFlash('Probable return date updated — the unit and Stores have been notified.');
      setTimeout(() => setFlash(''), 6000);
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to change the return date');
    }
    setActionBusy(false);
  };

  const submitSendOut = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      const { data } = await api.post(
        `/gatepasses/fim-batches/${sendOutTarget.id}/send-out`,
        {
          vehicleNo: sendOutForm.vehicleNo.trim() || undefined,
          driverName: sendOutForm.driverName.trim() || undefined,
          remarks: sendOutForm.remarks.trim() || undefined,
        },
      );
      setSendOutTarget(null);
      setSendOutForm({ vehicleNo: '', driverName: '', remarks: '' });
      setFlash(`Return gate pass ${data.passNumber} created — pending Store Incharge.`);
      setTimeout(() => setFlash(''), 8000);
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to create return gate pass');
    }
    setActionBusy(false);
  };

  // Section divider style — used between column groups in the table header
  const groupBorder = 'border-r-2 border-navy-300';

  return (
    <Card>
      {/* Filter + register banner */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <SearchBar value={search} onChange={setSearch} placeholder="Search product, customer, GP no…" />
          </div>
          <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-full sm:w-56">
            <option value="">All units (assigned or not)</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name || u.code}</option>)}
          </Select>
        </div>
        {flash && (
          <div className="px-3 py-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded flex items-center gap-2">
            <CheckCircle2 size={16} /> {flash}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Package size={36} className="mx-auto mb-3 opacity-40" />
          <div className="text-sm">No FIM batches found.</div>
          <div className="text-xs mt-1">FIM appears here after Stores records an INWARD gate pass.</div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
          {/* Register title bar */}
          <div className="px-4 py-3 bg-gradient-to-r from-navy-700 to-navy-800 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={16} className="opacity-90" />
              <h3 className="font-semibold tracking-wide text-sm">FIM / Customer Property Register</h3>
            </div>
            <div className="text-[11px] text-navy-100 font-medium">
              {batches.length} batch{batches.length === 1 ? '' : 'es'}
            </div>
          </div>

          {/* Scrollable table */}
          <div className="overflow-x-auto bg-white">
            <table className="w-full text-xs" style={{ minWidth: 2160 }}>
              <thead>
                {/* Grouping row (visual headers above the columns) */}
                <tr className="bg-navy-50 text-navy-700 border-b border-navy-200">
                  <th colSpan={6} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Hash size={11} /> Inward Details</span>
                  </th>
                  <th colSpan={4} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Package size={11} /> Item</span>
                  </th>
                  <th colSpan={3} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Calendar size={11} /> Return Tracking</span>
                  </th>
                  <th colSpan={2} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Building2 size={11} /> Unit</span>
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800">
                    <span className="flex items-center gap-1.5"><Pencil size={11} /> Remarks (live)</span>
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>

                {/* Column headers */}
                <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <th className="px-3 py-2 font-medium text-left">FIM No.</th>
                  <th className="px-3 py-2 font-medium text-left">Date</th>
                  <th className="px-3 py-2 font-medium text-left">Vehicle / Driver</th>
                  <th className="px-3 py-2 font-medium text-left">Cust. GP Type</th>
                  <th className="px-3 py-2 font-medium text-left">Cust. GP No.</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`} style={{ minWidth: 160 }}>Test Reports</th>

                  <th className="px-3 py-2 font-medium text-left">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Quantity</th>
                  <th className="px-3 py-2 font-medium text-left">Customer</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Purpose / Pass Type</th>

                  <th className="px-3 py-2 font-medium text-left">Probable Return</th>
                  <th className="px-3 py-2 font-medium text-left">Returned On</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Return Vehicle / Driver</th>

                  <th className="px-3 py-2 font-medium text-left">Assigned Unit</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Status</th>

                  <th className="px-3 py-2 font-medium text-left bg-amber-50/40" style={{ minWidth: 340 }}>Notes</th>
                  <th className="px-3 py-2 font-medium text-left" style={{ minWidth: 180 }}>—</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b, rowIdx) => {
                  const gp = b.sourceInwardGatePass || {};
                  const it = b.sourceInwardGatePassItem || {};
                  const cd = returnCountdown(it.probableReturnDate);
                  // Customer test reports for this line first, then the entry-wide
                  // ones (the API already filters those to gatePassItemId = null).
                  const testReports = [
                    ...(it.testReports || []).map(r => ({ ...r, scope: 'item' })),
                    ...(gp.testReports || []).map(r => ({ ...r, scope: 'entry' })),
                  ];
                  const acceptedByThisUnit = b.assignedToUnitId && (user?.role === 'ADMIN' || user?.unitId === b.assignedToUnitId);
                  const canAssign = isStores && !b.unitAcceptedAt;
                  const canAccept = isManager && b.assignedToUnitId && !b.unitAcceptedAt && acceptedByThisUnit;
                  const canEditRemark = isStores
                    || (user?.role === 'MANAGER' && user?.unitId && user.unitId === b.assignedToUnitId);
                  const isReturnable = it.itemPassType === 'RETURNABLE';
                  // outwardLinkedItems is the array of OUTWARD DC items linked back to this inward item.
                  const outwardLinks = Array.isArray(it.outwardLinkedItems) ? it.outwardLinkedItems : [];
                  const lastOutward = outwardLinks[0]?.gatePass;
                  const alreadySentOut = outwardLinks.length > 0;
                  // Stores own the return leg; Admin oversees. Pointless once the
                  // material has physically gone back to the customer.
                  const canEditReturnDate = isStores && !!it.id && !lastOutward?.actualReturnDate;
                  const isReady = !!b.readyToSendOutAt;
                  // Unit manager (or admin) marks the FIM ready first.
                  const canMarkReady = isReturnable
                    && b.unitAcceptedAt
                    && !isReady
                    && !alreadySentOut
                    && (user?.role === 'ADMIN' || (user?.role === 'MANAGER' && user?.unitId === b.assignedToUnitId));
                  // Unit manager (or admin) can withdraw the flag until Stores ships.
                  const canWithdrawReady = isReady
                    && !alreadySentOut
                    && (user?.role === 'ADMIN' || (user?.role === 'MANAGER' && user?.unitId === b.assignedToUnitId));
                  // Stores can only send out after the unit marks ready.
                  const canSendOut = isReturnable
                    && b.unitAcceptedAt
                    && isReady
                    && !alreadySentOut
                    && isStores;

                  return (
                    <tr
                      key={b.id}
                      className={`border-b border-gray-100 hover:bg-blue-50/20 align-top transition-colors ${
                        rowIdx % 2 === 1 ? 'bg-gray-50/40' : ''
                      } ${cd?.urgent ? 'ring-1 ring-inset ring-red-100' : ''}`}
                    >
                      {/* ── Inward Details ── */}
                      <td className="px-3 py-3">
                        <div className="font-mono text-[11px] font-bold text-navy-700">
                          {gp.fimNumber || <span className="text-gray-400 font-normal">—</span>}
                        </div>
                        {gp.passNumber && (
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">{gp.passNumber}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-700">
                        {gp.date ? (
                          <div className="text-[11px]">{new Date(gp.date).toLocaleDateString()}</div>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-[11px] text-gray-800 flex items-center gap-1">
                          <Truck size={11} className="text-gray-400" />
                          {gp.vehicleNo || <span className="text-gray-400">—</span>}
                        </div>
                        {gp.driverName && (
                          <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                            <UserIcon size={9} /> {gp.driverName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {gp.customerGpDocType ? (
                          <Badge color={gp.customerGpDocType === 'ORIGINAL' ? 'green' : 'yellow'}>
                            {gp.customerGpDocType === 'ORIGINAL' ? 'Original' : 'Duplicate'}
                          </Badge>
                        ) : <span className="text-gray-400 text-[11px]">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-[11px] text-gray-800">{gp.customerGatePassNo || '—'}</div>
                        {gp.customerGatePassDate && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{new Date(gp.customerGatePassDate).toLocaleDateString()}</div>
                        )}
                        {gp.customerGpPdfUrl && (
                          <a
                            href={gp.customerGpPdfUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-navy-700 hover:underline text-[10px] mt-0.5"
                          >
                            <FileText size={10} /> View PDF
                          </a>
                        )}
                      </td>
                      {/* Customer test reports: this item's own, plus any that cover the whole FIM entry. */}
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        {testReports.length === 0 ? (
                          <span className="text-gray-400 text-[11px]">—</span>
                        ) : (
                          <div className="space-y-0.5">
                            {testReports.map((r, ri) => (
                              <a
                                key={r.id || r.url || ri}
                                href={fileUrl(r.url)} target="_blank" rel="noreferrer"
                                title={`${r.name || 'Test report'}${r.scope === 'entry' ? ' (whole FIM entry)' : ''}`}
                                className="flex items-center gap-1 text-navy-700 hover:underline text-[10px]"
                              >
                                <FlaskConical size={10} className="shrink-0" />
                                <span className="truncate max-w-[130px]">{r.name || 'Test report'}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* ── Item ── */}
                      <td className="px-3 py-3">
                        <button
                          onClick={() => onOpenProduct?.(b.product.id)}
                          className="font-medium text-navy-700 hover:underline text-left text-[12px]"
                        >
                          {b.product.name}
                        </button>
                        <div className="text-[10px] text-gray-500 font-mono mt-0.5">{b.product.sku}</div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="font-semibold text-gray-900 text-[12px]">{b.quantity}</span>
                        <span className="text-[10px] text-gray-500 ml-1">{b.product.unit}</span>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-gray-800">{gp.customerName || '—'}</td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        <div className="text-[11px] text-gray-700">{it.itemPurpose || '—'}</div>
                        {it.itemPassType && (
                          <Badge color={isReturnable ? 'blue' : 'gray'} className="mt-1">
                            {it.itemPassType === 'RETURNABLE' ? 'Returnable' : 'Non-Returnable'}
                          </Badge>
                        )}
                      </td>

                      {/* ── Return Tracking ── */}
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-1">
                          {it.probableReturnDate ? (
                            <div className="text-[11px] text-gray-800">{new Date(it.probableReturnDate).toLocaleDateString()}</div>
                          ) : <span className="text-gray-400 text-[11px]">—</span>}
                          {canEditReturnDate && (
                            <button
                              onClick={() => openReturnEdit(b)}
                              title="Change probable return date"
                              className="p-0.5 rounded hover:bg-navy-50 text-navy-700 shrink-0"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                        {cd && (
                          <div
                            className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              cd.color === 'red' ? 'bg-red-50 text-red-700 border border-red-200' :
                              cd.color === 'orange' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                              'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {cd.urgent && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                            {cd.label}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {lastOutward?.actualReturnDate ? (
                          <div className="text-[11px] text-green-700 font-medium">
                            {new Date(lastOutward.actualReturnDate).toLocaleDateString()}
                          </div>
                        ) : lastOutward ? (
                          <div className="text-[10px] text-blue-700">In transit</div>
                        ) : (
                          <span className="text-gray-400 text-[11px]">—</span>
                        )}
                        {lastOutward?.passNumber && (
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">{lastOutward.passNumber}</div>
                        )}
                      </td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        {lastOutward?.vehicleNo ? (
                          <>
                            <div className="text-[11px] text-gray-800 flex items-center gap-1">
                              <Truck size={11} className="text-gray-400" /> {lastOutward.vehicleNo}
                            </div>
                            {lastOutward.driverName && (
                              <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                <UserIcon size={9} /> {lastOutward.driverName}
                              </div>
                            )}
                          </>
                        ) : <span className="text-gray-400 text-[11px]">—</span>}
                      </td>

                      {/* ── Unit ── */}
                      <td className="px-3 py-3">
                        {b.assignedToUnit ? (
                          <span className="inline-flex items-center gap-1 font-medium text-navy-700 text-[11px]">
                            <Building2 size={11} />
                            {b.assignedToUnit.name || b.assignedToUnit.code}
                          </span>
                        ) : <span className="text-gray-400 text-[11px]">Unassigned</span>}
                      </td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        {b.unitAcceptedAt ? (
                          <Badge color="green"><CheckCircle2 size={10} className="inline mr-0.5" />Accepted</Badge>
                        ) : b.assignedToUnitId ? (
                          <Badge color="yellow">Awaiting</Badge>
                        ) : (
                          <Badge color="gray">In stores</Badge>
                        )}
                        {isReady && !alreadySentOut && (
                          <div className="mt-1">
                            <Badge color="amber"><PackageCheck size={10} className="inline mr-0.5" />Ready to Collect</Badge>
                          </div>
                        )}
                        {alreadySentOut && (
                          <div className="mt-1">
                            <Badge color="blue"><ArrowRightLeft size={10} className="inline mr-0.5" />Sent out</Badge>
                          </div>
                        )}
                      </td>

                      {/* ── Remarks (live, editable) ── */}
                      <td className="px-3 py-3 bg-amber-50/30 align-top" style={{ minWidth: 340 }}>
                        <div className="relative">
                          <div className="text-[11px] text-gray-700 whitespace-pre-wrap min-h-[1.25rem] pr-7">
                            {b.unitAcceptedRemarks ? (
                              <span>{b.unitAcceptedRemarks}</span>
                            ) : it.remarks ? (
                              <span className="text-gray-500 italic">{it.remarks}</span>
                            ) : (
                              <span className="text-gray-400 italic">No remarks yet…</span>
                            )}
                          </div>
                          {canEditRemark && (
                            <button
                              onClick={() => {
                                setEditRemarkTarget({ batchId: b.id, productName: b.product.name, existing: b.unitAcceptedRemarks || '' });
                                setEditRemarkText(b.unitAcceptedRemarks || '');
                                setActionError('');
                              }}
                              title="Edit remark"
                              className="absolute top-0 right-0 p-1 rounded hover:bg-amber-100 text-amber-700"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {b.unitAcceptedBy?.name && (
                            <div className="text-[9px] text-gray-500 mt-1 flex items-center gap-1">
                              <CheckCircle2 size={9} className="text-green-600" />
                              Accepted by {b.unitAcceptedBy.name}
                              {b.unitAcceptedAt && ` · ${new Date(b.unitAcceptedAt).toLocaleDateString()}`}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* ── Actions ── */}
                      <td className="px-3 py-3 whitespace-nowrap align-top">
                        <div className="flex flex-col gap-1.5">
                          {canAssign && (
                            <button
                              onClick={() => { setAssignTarget({ batchId: b.id, productName: b.product.name }); setAssigningUnitId(b.assignedToUnitId || ''); setActionError(''); }}
                              className="text-[11px] px-2 py-1 rounded border border-navy-700 text-navy-700 hover:bg-navy-50"
                            >
                              {b.assignedToUnitId ? 'Reassign' : 'Assign'}
                            </button>
                          )}
                          {canAccept && (
                            <button
                              onClick={() => { setAcceptTarget({ batchId: b.id, productName: b.product.name }); setAcceptRemark(''); setActionError(''); }}
                              className="text-[11px] px-2 py-1 rounded bg-navy-700 text-white hover:bg-navy-800"
                            >
                              Accept
                            </button>
                          )}
                          {canMarkReady && (
                            <button
                              onClick={() => { setReadyTarget(b); setReadyNote(''); setActionError(''); }}
                              className="text-[11px] px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1 justify-center"
                            >
                              <PackageCheck size={11} /> Ready to Collect
                            </button>
                          )}
                          {canWithdrawReady && (
                            <button
                              onClick={() => withdrawReady(b)}
                              className="text-[11px] px-2 py-1 rounded border border-amber-500 text-amber-700 hover:bg-amber-50 inline-flex items-center gap-1 justify-center"
                            >
                              <RotateCcw size={11} /> Withdraw
                            </button>
                          )}
                          {canSendOut && (
                            <button
                              onClick={() => {
                                setSendOutTarget(b);
                                setSendOutForm({ vehicleNo: gp.vehicleNo || '', driverName: gp.driverName || '', remarks: '' });
                                setActionError('');
                              }}
                              className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1 justify-center"
                            >
                              <Send size={11} /> Send Out
                            </button>
                          )}
                          {alreadySentOut && !canSendOut && (
                            <span className="text-[10px] text-blue-700 inline-flex items-center gap-1">
                              <ArrowRightLeft size={10} /> {lastOutward?.passNumber}
                            </span>
                          )}
                          {/* Admin override — the only way back once a stage has
                              been passed. Hidden once the return gate pass exists,
                              since the server refuses to rewind past that. */}
                          {user?.role === 'ADMIN' && !alreadySentOut && (
                            <button
                              onClick={() => openStatusOverride(b)}
                              className="text-[11px] px-2 py-1 rounded border border-purple-500 text-purple-700 hover:bg-purple-50 inline-flex items-center gap-1 justify-center"
                              title="Set this FIM to any status"
                            >
                              <Pencil size={11} /> Change Status
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-500 flex items-center gap-2">
            <AlertTriangle size={11} className="text-amber-500" />
            Unit managers can update Remarks at any time. Acceptance is one-shot and final.
          </div>
        </div>
      )}

      {assignTarget && (
        <Modal isOpen onClose={() => setAssignTarget(null)} title="Assign FIM to unit">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Product: <strong>{assignTarget.productName}</strong>
            </div>
            <Select label="Destination unit *" value={assigningUnitId} onChange={(e) => setAssigningUnitId(e.target.value)}>
              <option value="">Select a unit…</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name || u.code}</option>)}
            </Select>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setAssignTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitAssign} disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Assign'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {acceptTarget && (
        <Modal isOpen onClose={() => setAcceptTarget(null)} title="Accept FIM at unit">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Accepting <strong>{acceptTarget.productName}</strong>. This is final — once accepted, the batch cannot be re-accepted (you can still edit Remarks afterwards).
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remark *</label>
              <textarea
                rows={3}
                value={acceptRemark}
                onChange={(e) => setAcceptRemark(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="e.g. Received in good condition, stored in Bay 2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setAcceptTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitAccept} disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Accept (final)'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {editRemarkTarget && (
        <Modal isOpen onClose={() => setEditRemarkTarget(null)} title="Edit FIM remark">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Product: <strong>{editRemarkTarget.productName}</strong>
            </div>
            <p className="text-xs text-gray-500">
              Remarks are visible to Stores and any unit. You can update them at any time without losing the acceptance state.
            </p>
            <textarea
              rows={5}
              value={editRemarkText}
              onChange={(e) => setEditRemarkText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
              placeholder="e.g. Bay 2, condition good, scheduled for grinding on Friday"
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setEditRemarkTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitRemarkEdit} disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Save Remark'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {sendOutTarget && (
        <Modal isOpen onClose={() => setSendOutTarget(null)} title="Send FIM back to customer" size="lg">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}

            <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-sm space-y-1">
              <div className="flex items-center gap-2 text-blue-900 font-medium">
                <ArrowRightLeft size={14} /> Same gate-pass cycle
              </div>
              <p className="text-xs text-blue-800">
                This creates an OUTWARD gate pass (Delivery Challan) linked back to
                FIM <strong className="font-mono">{sendOutTarget.sourceInwardGatePass?.fimNumber || sendOutTarget.sourceInwardGatePass?.passNumber}</strong>{' '}
                so the cycle closes against the same record.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">Customer</div>
                <div className="font-medium">{sendOutTarget.sourceInwardGatePass?.customerName || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Cust. GP No.</div>
                <div className="font-mono text-[12px]">{sendOutTarget.sourceInwardGatePass?.customerGatePassNo || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Item</div>
                <div className="font-medium">{sendOutTarget.product?.name}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Quantity</div>
                <div className="font-medium">{sendOutTarget.quantity} {sendOutTarget.product?.unit}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Vehicle No." value={sendOutForm.vehicleNo} onChange={(e) => setSendOutForm({ ...sendOutForm, vehicleNo: e.target.value })} placeholder="e.g. AP 31 CD 1234" />
              <Input label="Driver name" value={sendOutForm.driverName} onChange={(e) => setSendOutForm({ ...sendOutForm, driverName: e.target.value })} placeholder="Driver's full name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Send-out remarks</label>
              <textarea
                rows={3}
                value={sendOutForm.remarks}
                onChange={(e) => setSendOutForm({ ...sendOutForm, remarks: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="Optional — e.g. Returned after grinding; packed in original crate"
              />
            </div>

            <p className="text-[11px] text-gray-500">
              The Store Incharge will arrange vehicle confirmation and Accounts will give final approval, same as a standard gate pass.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setSendOutTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitSendOut} disabled={actionBusy}>
                <Send size={14} /> {actionBusy ? 'Creating…' : 'Create Return Gate Pass'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {readyTarget && (
        <Modal isOpen onClose={() => setReadyTarget(null)} title="Mark FIM ready to collect">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Marking <strong>{readyTarget.product?.name}</strong> ready for Stores to collect from your unit. Stores will be notified immediately.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note for Stores (optional)</label>
              <textarea
                rows={3}
                value={readyNote}
                onChange={(e) => setReadyNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="e.g. Work complete, packed in original crate, available after 4 PM"
              />
            </div>
            <p className="text-[11px] text-gray-500">
              You can withdraw this flag any time before Stores creates the return gate pass.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setReadyTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitMarkReady} disabled={actionBusy}>
                <PackageCheck size={14} /> {actionBusy ? 'Saving…' : 'Mark Ready to Collect'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Probable return date. Stored on the source inward gate pass line, so a
          change here also moves the overdue countdown on this register. */}
      {returnTarget && (
        <Modal isOpen onClose={() => setReturnTarget(null)} title="Change probable return date">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}

            <div className="text-sm text-gray-700">
              <strong>{returnTarget.product?.name}</strong>
              <span className="text-gray-500"> · currently </span>
              <span className="font-medium">
                {returnTarget.sourceInwardGatePassItem?.probableReturnDate
                  ? new Date(returnTarget.sourceInwardGatePassItem.probableReturnDate).toLocaleDateString()
                  : 'not set'}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New probable return date</label>
              <input
                type="date"
                value={returnForm.date}
                onChange={(e) => setReturnForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
              />
              <p className="text-[11px] text-gray-500 mt-1">Leave empty to clear the date and stop the countdown.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for the change</label>
              <textarea
                rows={2}
                value={returnForm.reason}
                onChange={(e) => setReturnForm((f) => ({ ...f, reason: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="e.g. Customer extended the loan period by one month over email"
              />
            </div>

            <p className="text-[11px] text-gray-500">
              This date drives the overdue countdown on the register, so the old and new dates are recorded in the
              audit log with your reason, and the assigned unit and Stores are notified.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setReturnTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitReturnDate} disabled={actionBusy}>
                {actionBusy ? 'Saving…' : 'Save date'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ADMIN status override. Sets the batch to any stage and rewrites every
          dependent field to match, so it can't be left half-way between two. */}
      {statusTarget && (
        <Modal isOpen onClose={() => setStatusTarget(null)} title="Change FIM status">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}

            <div className="text-sm text-gray-700">
              <strong>{statusTarget.product?.name}</strong>
              <span className="text-gray-500"> · currently </span>
              <span className="font-medium">{FIM_STATUS_LABELS[stageOf(statusTarget)]}</span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New status</label>
              <Select
                value={statusForm.status}
                onChange={(e) => setStatusForm((f) => ({ ...f, status: e.target.value }))}
              >
                {FIM_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{FIM_STATUS_LABELS[s]}</option>
                ))}
              </Select>
            </div>

            {statusForm.status !== 'IN_STORES' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <Select
                  value={statusForm.unitId}
                  onChange={(e) => setStatusForm((f) => ({ ...f, unitId: e.target.value }))}
                >
                  <option value="">Select a unit…</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name || u.code}</option>)}
                </Select>
              </div>
            )}

            {(statusForm.status === 'ACCEPTED' || statusForm.status === 'READY_TO_SEND') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Acceptance remark</label>
                <textarea
                  rows={2}
                  value={statusForm.remark}
                  onChange={(e) => setStatusForm((f) => ({ ...f, remark: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                  placeholder="What the unit recorded on acceptance"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  The unit&apos;s original remark is kept unless you change it here.
                </p>
              </div>
            )}

            {statusForm.status === 'READY_TO_SEND' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note for Stores (optional)</label>
                <textarea
                  rows={2}
                  value={statusForm.note}
                  onChange={(e) => setStatusForm((f) => ({ ...f, note: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for the change</label>
              <textarea
                rows={2}
                value={statusForm.reason}
                onChange={(e) => setStatusForm((f) => ({ ...f, reason: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="e.g. Assigned to Unit 2 by mistake, material was physically received by Unit 3"
              />
            </div>

            <p className="text-[11px] text-gray-500">
              Every field behind this status is rewritten to match, so the record stays consistent everywhere it
              appears. Whoever originally assigned or accepted the FIM stays credited unless that stage changes.
              The unit and Stores are notified, and the change is recorded in the audit log.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setStatusTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitStatusOverride} disabled={actionBusy}>
                {actionBusy ? 'Saving…' : 'Change status'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
