import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, CheckSquare, Truck, PackagePlus } from 'lucide-react';
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
    if (tab === 'OFFSITE') fetchQueue();
    else if (tab === 'LOTS') fetchOffsiteGps();
    else fetchRequests();
  }, [tab, refreshKey]);

  // Units present in the dispatch queue (one GP targets one site).
  const queueUnits = [...new Map(queue.map((r) => [r.unit.id, r.unit])).values()];
  const queueForUnit = queue.filter((r) => r.unit.id === buildUnitId);
  const lineRemaining = (it) => (it.approvedQty ?? it.quantity) - (it.dispatchedQty || 0);

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
  };

  const acceptRequest = async () => {
    if (!selectedRequest) return;
    setProcessing(true);
    try {
      await api.put(`/requests/${selectedRequest.id}/approve`, {});
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
      await api.put(`/requests/${selectedRequest.id}/issue-available`, {});
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to issue');
    }
    setProcessing(false);
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
                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{r.issueNo || '—'}</td>
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

      {/* Offsite Dispatch — build a NON_RETURNABLE gate pass from approved offsite MIVs */}
      {tab === 'OFFSITE' && (
        <Card>
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>
          ) : queue.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No approved offsite MIVs awaiting dispatch.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Site (one gate pass per site)</label>
                <select
                  value={buildUnitId}
                  onChange={(e) => { setBuildUnitId(e.target.value); setPick({}); }}
                  className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
                >
                  <option value="">— Select a site —</option>
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
        </Card>
      )}

      {/* Dispatched Lots — GP ↔ MIV mapping, vehicle, dispatch + ack status */}
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
                      <td className="px-3 py-2 text-xs text-gray-600">{gpMivNumbers(gp).join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{(gp.items || []).map((it) => `${it.description} ×${it.quantity}`).join('; ')}</td>
                      <td className="px-3 py-2 text-gray-600">{gp.vehicleNo || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{gp.dispatchedAt ? formatDateTime(gp.dispatchedAt) : '—'}</td>
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
                        ) : <span className="text-xs text-gray-400">—</span>}
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
                  <option value="">— Select a vehicle —</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNumber}{v.driverName ? ` — ${v.driverName}` : ''}</option>)}
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
            </div>

            {selectedRequest.unit?.isOffsite && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                Offsite MIV — approved by Admin and dispatched on a gate pass, not issued from store stock. Build the gate pass from the <strong>Offsite Dispatch</strong> tab and track it under <strong>Dispatched Lots</strong>.
              </div>
            )}

            {selectedRequest.status === 'PENDING' && !selectedRequest.unit?.isOffsite && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
                Accept to issue whatever stock is available now — each item gets what's in stock (full or part), FIFO batch numbers and an Issue No are filled in automatically, and stock is reduced immediately. Any shortfall is left <strong>pending</strong>; the MIV moves to <strong>Partial</strong> and you can issue the rest from the Partial tab once stock arrives.
              </div>
            )}

            {selectedRequest.status === 'PARTIAL' && !selectedRequest.unit?.isOffsite && (
              <div className="bg-orange-50 border border-orange-200 rounded p-3 text-xs text-orange-900">
                This MIV is partly issued — some items are still waiting on stock. Click <strong>Issue available now</strong> to release whatever stock has since arrived against the pending quantities. It stays in Partial until every item is fully issued.
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
                          <td className="px-3 py-2 text-gray-500 text-xs">{item.purpose || '—'}</td>
                          <td className="px-3 py-2">
                            <span className={item.product?.currentStock < item.quantity ? 'text-red-600 font-medium' : 'text-gray-600'}>
                              {item.product?.currentStock} {item.product?.unit}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{item.quantity} {item.product?.unit}</td>
                          {selectedRequest.status !== 'PENDING' && (
                            <>
                              <td className="px-3 py-2 text-gray-600">{item.qtyIssued != null ? `${item.qtyIssued} ${item.product?.unit}` : '—'}</td>
                              <td className="px-3 py-2">
                                {pending > 0
                                  ? <span className="text-orange-600 font-medium">{pending} {item.product?.unit}</span>
                                  : <span className="text-green-600">0</span>}
                              </td>
                              <td className="px-3 py-2 text-xs font-mono text-amber-800">{item.materialBatchNo || '—'}</td>
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
