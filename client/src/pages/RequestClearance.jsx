import { useState, useEffect } from 'react';
import {
  CheckCircle, XCircle, CheckSquare, Truck, PackagePlus,
  Info, ChevronDown, ClipboardList, ShieldCheck, PackageCheck,
} from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import { useAutoRefresh } from '../context/NotificationContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import MaterialIssuePdf from '../components/pdf/MaterialIssuePdf';
import PrNumberPicker from '../components/shared/PrNumberPicker';
import { formatDateTime } from '../utils/formatters';

export default function RequestClearance() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState('PENDING');
  // Offsite dispatch state.
  const [queue, setQueue] = useState([]);            // APPROVED/PARTIAL offsite MIVs awaiting dispatch
  const [offsiteGps, setOffsiteGps] = useState([]);  // dispatched-lot tracker
  const [buildUnitId, setBuildUnitId] = useState(''); // which site the GP is being built for
  const [pick, setPick] = useState({});              // requestItemId -> qty to dispatch (string)
  const [building, setBuilding] = useState(false);
  const [dispatchGp, setDispatchGp] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [usePrivate, setUsePrivate] = useState(false);
  const [pv, setPv] = useState({ regNumber: '', driverName: '', driverPhone: '' });
  // "Issued against PR" - Stores records which purchase request this material is
  // going out against. `linkedPr` is the picked { id, requestNumber }; `typedPr`
  // is whatever they typed without picking, which the server resolves by number.
  const [linkedPr, setLinkedPr] = useState(null);
  const [typedPr, setTypedPr] = useState('');
  const [savingPr, setSavingPr] = useState(false);
  // One-shot send: convert a single approved MIV straight into a gate pass and
  // put it on a vehicle, without hand-typing a quantity per line first.
  const [sendFor, setSendFor] = useState(null);     // the MIV being sent
  const [sendLines, setSendLines] = useState({});   // requestItemId -> qty (string)
  const [sending, setSending] = useState(false);
  const [showCombine, setShowCombine] = useState(false);
  const STATUS_TABS = ['PENDING', 'PARTIAL', 'COLLECTED', 'REJECTED', 'ALL'];
  const refreshKey = useAutoRefresh();

  const fetchRequests = () => {
    setLoading(true);
    api.get('/requests', { params: { status: tab === 'ALL' ? undefined : tab, limit: 50 } })
      .then(({ data }) => setRequests(data.requests))
      .finally(() => setLoading(false));
  };

  const fetchQueue = () => {
    setLoading(true);
    api.get('/requests/offsite/queue')
      .then(({ data }) => setQueue(data || []))
      .finally(() => setLoading(false));
  };

  const fetchOffsiteGps = () => {
    setLoading(true);
    api.get('/requests/offsite/gatepasses')
      .then(({ data }) => setOffsiteGps(data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Both offsite tabs load both lists: the guide above them counts what is
    // waiting at every stage, so it can't be built from one list alone.
    if (tab === 'OFFSITE' || tab === 'LOTS') { fetchQueue(); fetchOffsiteGps(); }
    else fetchRequests();
  }, [tab, refreshKey]);

  // Units present in the dispatch queue (one GP targets one site).
  const queueUnits = [...new Map(queue.map((r) => [r.unit.id, r.unit])).values()];
  const queueForUnit = queue.filter((r) => r.unit.id === buildUnitId);
  const lineRemaining = (it) => (it.approvedQty ?? it.quantity) - (it.dispatchedQty || 0);
  // What can actually go out today: never more than what is on the shelf.
  const readyQty = (it) => Math.max(0, Math.min(lineRemaining(it), it.product?.currentStock ?? 0));

  // ── Live state of the offsite pipeline, for the guide panel ──
  const gpAwaitingVehicle = offsiteGps.filter((g) => g.status === 'PENDING_LOGISTICS');
  const gpInTransit = offsiteGps.filter((g) => g.status === 'IN_TRANSIT');

  // ── One-shot: a single MIV → gate pass → on a vehicle ──
  const openSend = (r) => {
    const seed = {};
    (r.items || []).forEach((it) => {
      const q = readyQty(it);
      if (q > 0) seed[it.id] = String(q);
    });
    setSendLines(seed);
    setSendFor(r);
    setVehicleId(''); setUsePrivate(false); setPv({ regNumber: '', driverName: '', driverPhone: '' });
    api.get('/vehicles').then(({ data }) => setVehicles((data.vehicles || []).filter((v) => v.status === 'ACTIVE'))).catch(() => setVehicles([]));
  };

  const submitSend = async (dispatchNow) => {
    const items = Object.entries(sendLines)
      .map(([requestItemId, v]) => ({ requestItemId, quantity: Number(v) }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
    if (items.length === 0) return alert('Nothing to send - every line is either fully dispatched or out of stock.');

    setSending(true);
    try {
      const { data: gp } = await api.post('/requests/offsite/gatepass', { unitId: sendFor.unit.id, items });
      if (dispatchNow) {
        const body = usePrivate ? { privateVehicle: pv } : { vehicleId };
        await api.post(`/requests/offsite/gatepass/${gp.id}/dispatch`, body);
        alert(`Gate pass ${gp.passNumber} created and dispatched to ${sendFor.unit.name}. The site acknowledges it on arrival.`);
      } else {
        alert(`Gate pass ${gp.passNumber} created. Add the vehicle from "Dispatched Lots" when it is ready to leave.`);
      }
      setSendFor(null);
      setSendLines({});
      fetchQueue();
      fetchOffsiteGps();
      if (!dispatchNow) setTab('LOTS');
    } catch (err) {
      alert(err.response?.data?.error || 'Could not send this MIV out');
    }
    setSending(false);
  };

  const buildGatePass = async () => {
    const items = [];
    queueForUnit.forEach((r) => (r.items || []).forEach((it) => {
      const qty = Number(pick[it.id]);
      if (Number.isFinite(qty) && qty > 0) items.push({ requestItemId: it.id, quantity: qty });
    }));
    if (items.length === 0) return alert('Enter a quantity for at least one line');
    setBuilding(true);
    try {
      const { data } = await api.post('/requests/offsite/gatepass', { unitId: buildUnitId, items });
      setPick({});
      setBuildUnitId('');
      alert(`Gate pass ${data.passNumber} created. Attach a vehicle from the Dispatched Lots tab.`);
      setTab('LOTS');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to build gate pass');
    }
    setBuilding(false);
  };

  const openDispatch = (gp) => {
    setDispatchGp(gp);
    setVehicleId(''); setUsePrivate(false); setPv({ regNumber: '', driverName: '', driverPhone: '' });
    api.get('/vehicles').then(({ data }) => setVehicles((data.vehicles || []).filter((v) => v.status === 'ACTIVE'))).catch(() => setVehicles([]));
  };

  const submitDispatch = async () => {
    setProcessing(true);
    try {
      const body = usePrivate ? { privateVehicle: pv } : { vehicleId };
      await api.post(`/requests/offsite/gatepass/${dispatchGp.id}/dispatch`, body);
      setDispatchGp(null);
      fetchOffsiteGps();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to dispatch');
    }
    setProcessing(false);
  };

  const gpMivNumbers = (gp) => [...new Set((gp.items || []).flatMap((it) =>
    (it.mivLinks || []).map((l) => l.requestItem?.request?.requestNumber).filter(Boolean)))];

  const openRequest = (request) => {
    setSelectedRequest(request);
    setRejectMode(false);
    setRejectNote('');
    // Pre-load whatever PR is already recorded so re-opening shows the link.
    setLinkedPr(request.purchaseRequest
      ? { id: request.purchaseRequest.id, requestNumber: request.purchaseRequest.requestNumber }
      : null);
    setTypedPr('');
  };

  // Body fragment carrying the PR link. A picked PR sends its id; a bare typed
  // number goes as-is for the server to resolve. Nothing typed = field omitted,
  // which leaves any existing link untouched.
  const prLinkBody = () => {
    if (linkedPr) return { purchaseRequestId: linkedPr.id };
    if (typedPr.trim()) return { purchaseRequestNumber: typedPr.trim() };
    return {};
  };

  const acceptRequest = async () => {
    if (!selectedRequest) return;
    setProcessing(true);
    try {
      await api.put(`/requests/${selectedRequest.id}/approve`, prLinkBody());
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to accept');
    }
    setProcessing(false);
  };

  // Top up a partially-issued MIV: issue whatever stock has arrived against the
  // still-pending items.
  const issueAvailable = async () => {
    if (!selectedRequest) return;
    setProcessing(true);
    try {
      await api.put(`/requests/${selectedRequest.id}/issue-available`, prLinkBody());
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to issue');
    }
    setProcessing(false);
  };

  // Record / correct / clear the PR number on an MIV that is already issued -
  // Stores often issues first and matches the PR afterwards.
  const savePrLink = async () => {
    if (!selectedRequest) return;
    setSavingPr(true);
    try {
      const body = linkedPr
        ? { purchaseRequestId: linkedPr.id }
        : { purchaseRequestNumber: typedPr.trim() };
      const { data } = await api.put(`/requests/${selectedRequest.id}/purchase-request`, body);
      setSelectedRequest(data);
      setLinkedPr(data.purchaseRequest
        ? { id: data.purchaseRequest.id, requestNumber: data.purchaseRequest.requestNumber }
        : null);
      setTypedPr('');
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save the PR number');
    }
    setSavingPr(false);
  };

  const rejectRequest = async () => {
    if (!selectedRequest) return;
    if (!rejectNote.trim()) return alert('Please provide a reason for rejection');
    setProcessing(true);
    try {
      await api.put(`/requests/${selectedRequest.id}/reject`, { clearanceNotes: rejectNote.trim() });
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
    setProcessing(false);
  };

  const statusColor = (s) => ({
    PENDING: 'yellow', APPROVED: 'green', PARTIAL: 'orange', COLLECTED: 'blue', REJECTED: 'red', CANCELLED: 'gray'
  }[s] || 'gray');

  const tabs = [...STATUS_TABS, 'OFFSITE', 'LOTS'];
  const tabLabel = (t) => ({ OFFSITE: 'Offsite Dispatch', LOTS: 'Dispatched Lots' }[t] || t);

  return (
    <div className="space-y-6">
      <PageHero
        title="MIV Clearance"
        subtitle="Approve, reject, and clear Material Issue Voucher requests raised by departments."
        eyebrow="Stores"
        icon={CheckSquare}
      />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tab === t ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >{tabLabel(t)}</button>
        ))}
      </div>

      {!['OFFSITE', 'LOTS'].includes(tab) && (
      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No {tab.toLowerCase()} requests</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">MIV #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Issue No</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Against PR</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r, i) => (
                  <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-3 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => openRequest(r)}>{r.requestNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{r.manager?.name}</td>
                    <td className="px-3 py-2"><Badge color="blue">{r.unit?.code}</Badge></td>
                    <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                    <td className="px-3 py-2"><Badge color={statusColor(r.status)}>{r.status}</Badge></td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{r.issueNo || '-'}</td>
                    <td className="px-3 py-2 text-xs font-mono">
                      {r.purchaseRequest
                        ? <span className="text-green-800 font-semibold">{r.purchaseRequest.requestNumber}</span>
                        : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openRequest(r)}>
                          {r.status === 'PENDING' ? 'Review' : 'View'}
                        </Button>
                        <DownloadPdfButton
                          document={<MaterialIssuePdf data={r} />}
                          fileName={`MIV-${r.issueNo || r.requestNumber}.pdf`}
                          label="MIV PDF"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      )}

      {/* The on-site flow - the everyday one. Shown on the status tabs so the
          store sees how a normal MIV differs from an offsite one. */}
      {tab !== 'OFFSITE' && tab !== 'LOTS' && (
        <StoresOnsiteGuide pendingCount={requests.filter((r) => r.status === 'PENDING').length} />
      )}

      {/* How the offsite flow works from the store's side, with live counts of
          what is sitting at each stage and a button straight to the action. */}
      {(tab === 'OFFSITE' || tab === 'LOTS') && (
        <StoresOffsiteGuide
          awaitingDispatch={queue.length}
          awaitingVehicle={gpAwaitingVehicle.length}
          inTransit={gpInTransit.length}
          onGoDispatch={() => setTab('OFFSITE')}
          onGoLots={() => setTab('LOTS')}
        />
      )}

      {/* Offsite Dispatch - build a NON_RETURNABLE gate pass from approved offsite MIVs */}
      {tab === 'OFFSITE' && (
        <Card>
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>
          ) : queue.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No approved offsite MIVs awaiting dispatch.</div>
          ) : (
            <div className="space-y-4">
              {/* The normal path: one MIV, one click, out the door. Quantities are
                  pre-filled with what is actually on the shelf, so Stores only
                  touches a number when they want to send less. */}
              <div className="space-y-2">
                {queue.map((r) => {
                  const lines = (r.items || []).filter((it) => lineRemaining(it) > 0.001);
                  const ready = lines.filter((it) => readyQty(it) > 0);
                  const waiting = lines.length - ready.length;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                      <div className="min-w-[200px] flex-1">
                        <div className="font-semibold text-navy-800 text-sm">{r.requestNumber}</div>
                        <div className="text-[11px] text-gray-500">
                          {r.unit?.name} ({r.unit?.code}) · {r.manager?.name || '-'}
                          {r.workOrder?.workOrderNumber ? ` · WO ${r.workOrder.workOrderNumber}` : ''}
                        </div>
                      </div>
                      <div className="text-[11px]">
                        <span className="font-semibold text-emerald-700">{ready.length} line{ready.length === 1 ? '' : 's'} ready</span>
                        {waiting > 0 && (
                          <span className="text-amber-700"> · {waiting} waiting on stock</span>
                        )}
                      </div>
                      <Button size="sm" onClick={() => openSend(r)} disabled={ready.length === 0}>
                        <Truck size={14} className="mr-1" />
                        {ready.length === 0 ? 'No stock yet' : 'Convert to gate pass'}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Kept for the case the quick path cannot cover: several MIVs for
                  the same site riding out on ONE gate pass. */}
              <button
                type="button"
                onClick={() => setShowCombine((v) => !v)}
                className="text-[12px] font-semibold text-navy-600 hover:text-navy-800"
              >
                {showCombine ? '− Hide' : '+ Combine several MIVs for one site into a single gate pass'}
              </button>

              {showCombine && (
              <div className="space-y-4 rounded-lg border border-gray-200 p-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Site (one gate pass per site)</label>
                <select
                  value={buildUnitId}
                  onChange={(e) => { setBuildUnitId(e.target.value); setPick({}); }}
                  className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                >
                  <option value="">- Select a site -</option>
                  {queueUnits.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select>
              </div>

              {buildUnitId && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">MIV #</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">In Stock</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Remaining</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Dispatch Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueForUnit.flatMap((r) => (r.items || [])
                        .filter((it) => lineRemaining(it) > 0.001)
                        .map((it) => {
                          const rem = lineRemaining(it);
                          const short = (it.product?.currentStock ?? 0) < Number(pick[it.id] || 0);
                          return (
                            <tr key={it.id} className="border-b border-gray-50 hover:bg-navy-50">
                              <td className="px-3 py-2 text-navy-700 font-medium">{r.requestNumber}</td>
                              <td className="px-3 py-2 text-gray-700">{it.product?.name}</td>
                              <td className={`px-3 py-2 ${short ? 'text-red-600 font-medium' : 'text-gray-600'}`}>{it.product?.currentStock} {it.product?.unit}</td>
                              <td className="px-3 py-2 text-gray-600">{rem} {it.product?.unit}</td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number" min={0} max={rem} className="w-24 text-center"
                                  value={pick[it.id] ?? ''}
                                  placeholder="0"
                                  onChange={(e) => setPick((m) => ({ ...m, [it.id]: e.target.value }))}
                                />
                              </td>
                            </tr>
                          );
                        }))}
                    </tbody>
                  </table>
                  <div className="flex justify-end pt-3">
                    <Button onClick={buildGatePass} disabled={building}>
                      <PackagePlus size={16} className="mr-1" /> {building ? 'Creating…' : 'Raise Gate Pass'}
                    </Button>
                  </div>
                </div>
              )}
              </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Dispatched Lots - GP ↔ MIV mapping, vehicle, dispatch + ack status */}
      {tab === 'LOTS' && (
        <Card>
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>
          ) : offsiteGps.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No offsite gate passes yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">GP No.</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Site</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Against MIV(s)</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Vehicle</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Dispatched</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {offsiteGps.map((gp, i) => (
                    <tr key={gp.id} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                      <td className="px-3 py-2 font-medium text-navy-700">{gp.passNumber}</td>
                      <td className="px-3 py-2"><Badge color="blue">{gp.destinationUnit?.code}</Badge></td>
                      <td className="px-3 py-2 text-xs text-gray-600">{gpMivNumbers(gp).join(', ') || '-'}</td>
                      <td className="px-3 py-2 text-gray-600">{(gp.items || []).map((it) => `${it.description} ×${it.quantity}`).join('; ')}</td>
                      <td className="px-3 py-2 text-gray-600">{gp.vehicleNo || '-'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{gp.dispatchedAt ? formatDateTime(gp.dispatchedAt) : '-'}</td>
                      <td className="px-3 py-2">
                        <Badge color={gp.status === 'CLOSED' ? 'blue' : gp.status === 'IN_TRANSIT' ? 'orange' : 'gray'}>
                          {gp.status === 'CLOSED' ? 'RECEIVED' : gp.status === 'IN_TRANSIT' ? 'IN TRANSIT' : gp.status === 'PENDING_LOGISTICS' ? 'AWAITING VEHICLE' : gp.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        {gp.status === 'PENDING_LOGISTICS' ? (
                          <Button size="sm" onClick={() => openDispatch(gp)}><Truck size={14} className="mr-1" /> Dispatch</Button>
                        ) : gp.status === 'IN_TRANSIT' ? (
                          <span className="text-xs text-gray-500">Awaiting site ack</span>
                        ) : gp.reachedDate ? (
                          <span className="text-xs text-gray-500">{formatDateTime(gp.reachedDate)}</span>
                        ) : <span className="text-xs text-gray-400">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Dispatch (attach vehicle) modal */}
      <Modal isOpen={!!dispatchGp} onClose={() => setDispatchGp(null)} title={`Dispatch ${dispatchGp?.passNumber || ''}`} size="md">
        {dispatchGp && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Attach a vehicle and dispatch to <strong>{dispatchGp.destinationUnit?.name}</strong>.</p>
            <div className="flex gap-2 text-sm">
              <button onClick={() => setUsePrivate(false)} className={`px-3 py-1.5 rounded-md ${!usePrivate ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-600'}`}>Registered vehicle</button>
              <button onClick={() => setUsePrivate(true)} className={`px-3 py-1.5 rounded-md ${usePrivate ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-600'}`}>Private / hired</button>
            </div>
            {!usePrivate ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle</label>
                <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                  <option value="">- Select a vehicle -</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNumber}{v.driverName ? ` - ${v.driverName}` : ''}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                <Input label="Vehicle No." value={pv.regNumber} onChange={(e) => setPv({ ...pv, regNumber: e.target.value })} />
                <Input label="Driver Name" value={pv.driverName} onChange={(e) => setPv({ ...pv, driverName: e.target.value })} />
                <Input label="Driver Phone" value={pv.driverPhone} onChange={(e) => setPv({ ...pv, driverPhone: e.target.value })} />
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setDispatchGp(null)} disabled={processing}>Cancel</Button>
              <Button onClick={submitDispatch} disabled={processing || (!usePrivate && !vehicleId) || (usePrivate && (!pv.regNumber || !pv.driverName))}>
                <Truck size={16} className="mr-1" /> {processing ? 'Dispatching…' : 'Dispatch'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Convert one MIV into a gate pass and put it on a vehicle, in one pass. */}
      <Modal
        isOpen={!!sendFor}
        onClose={() => { setSendFor(null); setSendLines({}); }}
        title={sendFor ? `Send out ${sendFor.requestNumber} → ${sendFor.unit?.name}` : ''}
        size="lg"
      >
        {sendFor && (
          <div className="space-y-4">
            <div className="rounded-lg border border-navy-200 bg-navy-50/50 p-3 text-[12px] text-navy-800">
              Quantities below are already filled in with what is on the shelf right now. Change a number to
              send less, or leave it. A line with no stock is skipped and stays on the MIV - the MIV goes to
              <strong> Partial</strong> and you can send the rest on another gate pass later.
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">In stock</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Still owed</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Sending now</th>
                  </tr>
                </thead>
                <tbody>
                  {(sendFor.items || []).filter((it) => lineRemaining(it) > 0.001).map((it) => {
                    const rem = lineRemaining(it);
                    const canSend = readyQty(it);
                    return (
                      <tr key={it.id} className="border-b border-gray-50">
                        <td className="px-2 py-2 text-gray-800">{it.product?.name}</td>
                        <td className={`px-2 py-2 ${canSend === 0 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                          {it.product?.currentStock ?? 0} {it.product?.unit}
                        </td>
                        <td className="px-2 py-2 text-gray-600">{rem} {it.product?.unit}</td>
                        <td className="px-2 py-2">
                          {canSend === 0 ? (
                            <Badge color="amber">waiting on stock</Badge>
                          ) : (
                            <Input
                              type="number" min={0} max={canSend} className="w-24 text-center"
                              value={sendLines[it.id] ?? ''}
                              onChange={(e) => setSendLines((m) => ({ ...m, [it.id]: e.target.value }))}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t pt-3">
              <p className="text-[12px] font-semibold text-gray-700 mb-2">Vehicle (fill this in to send it out now)</p>
              <div className="flex gap-2 text-sm mb-2">
                <button type="button" onClick={() => setUsePrivate(false)} className={`px-3 py-1.5 rounded-md ${!usePrivate ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-600'}`}>Registered vehicle</button>
                <button type="button" onClick={() => setUsePrivate(true)} className={`px-3 py-1.5 rounded-md ${usePrivate ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-600'}`}>Private / hired</button>
              </div>
              {!usePrivate ? (
                <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                  <option value="">- Select a vehicle -</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNumber}{v.driverName ? ` - ${v.driverName}` : ''}</option>)}
                </select>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input label="Vehicle No." value={pv.regNumber} onChange={(e) => setPv({ ...pv, regNumber: e.target.value })} />
                  <Input label="Driver Name" value={pv.driverName} onChange={(e) => setPv({ ...pv, driverName: e.target.value })} />
                  <Input label="Driver Phone" value={pv.driverPhone} onChange={(e) => setPv({ ...pv, driverPhone: e.target.value })} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
              <Button variant="secondary" onClick={() => { setSendFor(null); setSendLines({}); }} disabled={sending}>Cancel</Button>
              <Button variant="secondary" onClick={() => submitSend(false)} disabled={sending}>
                <PackagePlus size={15} className="mr-1" /> Create gate pass only
              </Button>
              <Button
                onClick={() => submitSend(true)}
                disabled={sending || (!usePrivate && !vehicleId) || (usePrivate && (!pv.regNumber || !pv.driverName))}
              >
                <Truck size={15} className="mr-1" /> {sending ? 'Sending…' : 'Create & dispatch now'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Review Modal */}
      <Modal isOpen={!!selectedRequest} onClose={() => setSelectedRequest(null)} title={`Review ${selectedRequest?.requestNumber}`} size="lg">
        {selectedRequest && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
              <div><span className="text-gray-500">Manager:</span> <span className="font-medium">{selectedRequest.manager?.name}</span></div>
              <div><span className="text-gray-500">Unit:</span> <Badge color="blue">{selectedRequest.unit?.name}</Badge></div>
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(selectedRequest.status)}>{selectedRequest.status}</Badge></div>
              <div><span className="text-gray-500">Date:</span> <span>{formatDateTime(selectedRequest.createdAt)}</span></div>
              <div><span className="text-gray-500">Reference No:</span> <span className="font-mono text-xs">{selectedRequest.referenceNo || selectedRequest.requestNumber}</span></div>
              {selectedRequest.remarks && <div><span className="text-gray-500">Remarks:</span> <span>{selectedRequest.remarks}</span></div>}
              {selectedRequest.issueNo && <div><span className="text-gray-500">Issue No:</span> <span className="font-mono text-xs">{selectedRequest.issueNo}</span></div>}
              {selectedRequest.issueDate && <div><span className="text-gray-500">Issue Date:</span> <span>{formatDateTime(selectedRequest.issueDate)}</span></div>}
              {selectedRequest.workOrder?.workOrderNumber && (
                <div><span className="text-gray-500">Work Order:</span> <span className="font-mono text-xs">{selectedRequest.workOrder.workOrderNumber}</span></div>
              )}
              <div>
                <span className="text-gray-500">Issued against PR:</span>{' '}
                {selectedRequest.purchaseRequest
                  ? <span className="font-mono text-xs font-semibold text-green-800">{selectedRequest.purchaseRequest.requestNumber}</span>
                  : <span className="text-gray-400 text-xs">Not recorded</span>}
              </div>
            </div>

            {/* Stores records which PR this material goes out against. Shown on
                PENDING/PARTIAL so it can be set as part of issuing, and on
                already-issued MIVs so it can be added or corrected afterwards. */}
            {!selectedRequest.unit?.isOffsite && (
              <div className="border border-gray-200 rounded-md p-3">
                <PrNumberPicker
                  value={linkedPr}
                  onChange={setLinkedPr}
                  onTypedNumber={setTypedPr}
                  disabled={processing || savingPr}
                  help={
                    selectedRequest.status === 'PENDING' || selectedRequest.status === 'PARTIAL'
                      ? 'Optional - saved when you issue below. Leave blank if this material is not against any purchase request.'
                      : 'Optional - use Save PR number to record or correct it on this issued MIV.'
                  }
                />
                {/* On an already-issued MIV there is no issue button to piggyback
                    on, so give the link its own save. */}
                {!['PENDING', 'PARTIAL'].includes(selectedRequest.status) && (
                  <div className="flex justify-end mt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={savePrLink}
                      disabled={savingPr || (!linkedPr && !typedPr.trim() && !selectedRequest.purchaseRequest)}
                    >
                      {savingPr ? 'Saving…' : 'Save PR number'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {selectedRequest.unit?.isOffsite && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                Offsite MIV - approved by Admin and dispatched on a gate pass, not issued from store stock. Build the gate pass from the <strong>Offsite Dispatch</strong> tab and track it under <strong>Dispatched Lots</strong>.
              </div>
            )}

            {selectedRequest.status === 'PENDING' && !selectedRequest.unit?.isOffsite && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
                Accept to issue whatever stock is available now - each item gets what's in stock (full or part), FIFO batch numbers and an Issue No are filled in automatically, and stock is reduced immediately. Any shortfall is left <strong>pending</strong>; the MIV moves to <strong>Partial</strong> and you can issue the rest from the Partial tab once stock arrives.
              </div>
            )}

            {selectedRequest.status === 'PARTIAL' && !selectedRequest.unit?.isOffsite && (
              <div className="bg-orange-50 border border-orange-200 rounded p-3 text-xs text-orange-900">
                This MIV is partly issued - some items are still waiting on stock. Click <strong>Issue available now</strong> to release whatever stock has since arrived against the pending quantities. It stays in Partial until every item is fully issued.
              </div>
            )}

            {selectedRequest.notes && (
              <div className="bg-yellow-50 rounded-md p-3 text-sm">
                <span className="text-yellow-700 font-medium">Manager's Note:</span> <span>{selectedRequest.notes}</span>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Requested Items</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Purpose</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Available</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                      {selectedRequest.status !== 'PENDING' && (
                        <>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty Issued</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Pending</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">FIFO Batch No.</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRequest.items?.map((item) => {
                      const approved = item.approvedQty ?? item.quantity;
                      const pending = Math.max(0, approved - (item.qtyIssued || 0));
                      return (
                        <tr key={item.id} className="border-b border-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-700">{item.product?.name}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{item.purpose || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={item.product?.currentStock < item.quantity ? 'text-red-600 font-medium' : 'text-gray-600'}>
                              {item.product?.currentStock} {item.product?.unit}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{item.quantity} {item.product?.unit}</td>
                          {selectedRequest.status !== 'PENDING' && (
                            <>
                              <td className="px-3 py-2 text-gray-600">{item.qtyIssued != null ? `${item.qtyIssued} ${item.product?.unit}` : '-'}</td>
                              <td className="px-3 py-2">
                                {pending > 0
                                  ? <span className="text-orange-600 font-medium">{pending} {item.product?.unit}</span>
                                  : <span className="text-green-600">0</span>}
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-amber-800">{item.materialBatchNo || '-'}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRequest.status === 'PENDING' && !rejectMode && !selectedRequest.unit?.isOffsite && (
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="danger" onClick={() => setRejectMode(true)} disabled={processing}>
                  <XCircle size={16} className="mr-1" /> Reject
                </Button>
                <Button onClick={acceptRequest} disabled={processing}>
                  <CheckCircle size={16} className="mr-1" /> {processing ? 'Accepting…' : 'Accept & issue available'}
                </Button>
              </div>
            )}

            {selectedRequest.status === 'PARTIAL' && !selectedRequest.unit?.isOffsite && (
              <div className="flex justify-end gap-3 pt-2">
                <Button onClick={issueAvailable} disabled={processing}>
                  <CheckCircle size={16} className="mr-1" /> {processing ? 'Issuing…' : 'Issue available now'}
                </Button>
              </div>
            )}

            {selectedRequest.status === 'PENDING' && rejectMode && !selectedRequest.unit?.isOffsite && (
              <div className="space-y-3 border-t pt-3">
                <label className="block text-sm font-medium text-gray-700">Reason for rejection <span className="text-red-600">*</span></label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="e.g. Insufficient stock and no transfer raised, or duplicate request…"
                />
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => { setRejectMode(false); setRejectNote(''); }} disabled={processing}>Cancel</Button>
                  <Button variant="danger" onClick={rejectRequest} disabled={processing || !rejectNote.trim()}>
                    {processing ? 'Rejecting…' : 'Confirm reject & notify manager'}
                  </Button>
                </div>
              </div>
            )}

            {selectedRequest.clearanceNotes && selectedRequest.status !== 'PENDING' && (
              <div className={`rounded-md p-3 text-sm ${selectedRequest.status === 'REJECTED' ? 'bg-red-50 text-red-800' : 'bg-blue-50'}`}>
                <span className={`font-medium ${selectedRequest.status === 'REJECTED' ? 'text-red-700' : 'text-blue-600'}`}>
                  {selectedRequest.status === 'REJECTED' ? 'Rejection reason:' : 'Notes:'}
                </span>{' '}
                <span>{selectedRequest.clearanceNotes}</span>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t">
              <DownloadPdfButton
                document={<MaterialIssuePdf data={selectedRequest} />}
                fileName={`MIV-${selectedRequest.issueNo || selectedRequest.requestNumber}.pdf`}
                label="View / Download MIV PDF"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── The everyday MIV, from the store's side ──
// Deliberately sits next to the offsite guide: the two paths diverge at who
// approves and how the material travels, and confusing them is what sends people
// hunting for an Accept button that offsite MIVs will never have.
function StoresOnsiteGuide({ pendingCount }) {
  const [open, setOpen] = useState(false);

  const steps = [
    {
      icon: ClipboardList,
      tone: 'bg-navy-50 text-navy-700 ring-navy-100',
      title: '1. A unit raises the MIV',
      body: 'An on-site unit asks for material. It lands straight in your Pending tab - no admin approval in between.',
    },
    {
      icon: CheckSquare,
      tone: 'bg-green-50 text-green-700 ring-green-100',
      title: '2. You accept it',
      body: 'Accepting issues whatever is in stock right now. FIFO batch numbers and an Issue No are filled in for you and stock drops immediately. You can record the PR number it is issued against at the same time.',
    },
    {
      icon: PackagePlus,
      tone: 'bg-amber-50 text-amber-700 ring-amber-100',
      title: '3. Short lines wait',
      body: 'Anything you could not cover stays pending and the MIV moves to Partial. Top it up from the Partial tab once the stock arrives - no need to raise anything new.',
    },
    {
      icon: PackageCheck,
      tone: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
      title: '4. It closes',
      body: 'The MIV reads COLLECTED once every line has been issued. Rejecting instead needs a reason, which goes back to the requester.',
    },
    {
      icon: Truck,
      tone: 'bg-blue-50 text-blue-700 ring-blue-100',
      title: 'Offsite units are different',
      body: 'A MIV from ANSP, Adibatla, CPDC, RCI or another offsite site never gets an Accept button here - Admin approves it and you send the material out on a gate pass. Use the Offsite Dispatch tab for those.',
    },
  ];

  return (
    <Card className="border-l-4 border-l-gray-300">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg ring-1 bg-gray-50 text-gray-600 ring-gray-200 flex-shrink-0">
            <Info size={16} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-800">How a normal MIV works (what the store does)</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {pendingCount > 0
                ? `${pendingCount} pending on this tab. Offsite MIVs follow a different path - see the Offsite Dispatch tab.`
                : 'Accept → issue from stock → closes. Offsite MIVs follow a different path.'}
            </p>
          </div>
        </div>
        <ChevronDown size={18} className={`text-navy-600 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ol className="mt-4 space-y-3">
          {steps.map((s) => (
            <li key={s.title} className="flex items-start gap-3">
              <div className={`p-1.5 rounded-lg ring-1 flex-shrink-0 ${s.tone}`}>
                <s.icon size={15} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-gray-800">{s.title}</p>
                <p className="text-[12px] text-gray-600 leading-relaxed mt-0.5">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ── How the offsite flow works, from the store's side ──
// The offsite unit has its own explainer on My Requests; this is the matching
// half for the people who actually move the material. Each step carries the live
// count of what is sitting there right now and a button to the screen that clears
// it, so "what do I do next" is answered on the page rather than in a manual.
function StoresOffsiteGuide({ awaitingDispatch, awaitingVehicle, inTransit, onGoDispatch, onGoLots }) {
  const [open, setOpen] = useState(true);

  const steps = [
    {
      icon: ClipboardList,
      tone: 'bg-navy-50 text-navy-700 ring-navy-100',
      title: '1. The site raises the MIV',
      body: 'An offsite unit (ANSP, Adibatla, CPDC, RCI …) raises a MIV for material it needs. It does not come to you yet.',
    },
    {
      icon: ShieldCheck,
      tone: 'bg-blue-50 text-blue-700 ring-blue-100',
      title: '2. Admin approves it - not you',
      body: 'Offsite MIVs are approved by an Admin, who can adjust the quantities. You cannot issue one from store stock; it only reaches you once it is APPROVED.',
    },
    {
      icon: Truck,
      tone: 'bg-amber-50 text-amber-700 ring-amber-100',
      title: '3. You convert it to a gate pass',
      body: 'On the Offsite Dispatch tab, hit "Convert to gate pass" on the MIV. Quantities are pre-filled with what is in stock - a line with no stock is skipped and waits for the next pass. Enter the vehicle and driver in the same window and send it out.',
      count: awaitingDispatch,
      countLabel: 'MIV(s) approved and waiting for you',
      action: onGoDispatch,
      actionLabel: 'Open dispatch',
    },
    {
      icon: PackagePlus,
      tone: 'bg-orange-50 text-orange-700 ring-orange-100',
      title: '4. Gate passes still without a vehicle',
      body: 'If you created a gate pass without dispatching it, it waits here. Open Dispatched Lots and add the vehicle and driver when the load is ready to leave.',
      count: awaitingVehicle,
      countLabel: 'gate pass(es) need vehicle details',
      action: onGoLots,
      actionLabel: 'Add vehicle',
    },
    {
      icon: CheckCircle,
      tone: 'bg-green-50 text-green-700 ring-green-100',
      title: '5. The site acknowledges receipt',
      body: 'Once dispatched, the receiving unit acknowledges arrival and the gate pass closes. Nothing comes back - these are non-returnable dispatches.',
      count: inTransit,
      countLabel: 'in transit, waiting on the site to acknowledge',
      action: onGoLots,
      actionLabel: 'Track lots',
    },
    {
      icon: PackageCheck,
      tone: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
      title: '6. The MIV closes itself',
      body: 'When every line has gone out and every gate pass is acknowledged, the MIV turns COLLECTED on its own. Until then it sits at PARTIAL - that is normal for a load that travels in more than one trip.',
    },
  ];

  const pending = awaitingDispatch + awaitingVehicle;

  return (
    <Card className="border-l-4 border-l-navy-600 bg-navy-50/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg ring-1 bg-navy-50 text-navy-700 ring-navy-100 flex-shrink-0">
            <Info size={16} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-800">How offsite MIVs work (what the store does)</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {pending > 0
                ? `${pending} item${pending === 1 ? '' : 's'} waiting on you - the steps below show exactly where.`
                : 'Nothing waiting on you right now. Here is the full flow.'}
            </p>
          </div>
        </div>
        <ChevronDown size={18} className={`text-navy-600 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ol className="mt-4 space-y-3">
          {steps.map((s) => (
            <li key={s.title} className="flex items-start gap-3">
              <div className={`p-1.5 rounded-lg ring-1 flex-shrink-0 ${s.tone}`}>
                <s.icon size={15} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-gray-800">{s.title}</p>
                <p className="text-[12px] text-gray-600 leading-relaxed mt-0.5">{s.body}</p>
                {s.count > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge color={s.count > 0 ? 'amber' : 'gray'}>{s.count} {s.countLabel}</Badge>
                    {s.action && (
                      <button
                        type="button"
                        onClick={s.action}
                        className="text-[11px] font-semibold text-navy-700 underline underline-offset-2 hover:text-navy-900"
                      >
                        {s.actionLabel} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
