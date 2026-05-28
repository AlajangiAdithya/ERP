import { useState, useEffect } from 'react';
import {
  Plus, Trash2, RotateCcw, CheckCircle2, Truck, PackageCheck,
  Send, ShieldCheck, Calculator, Stamp, XCircle, Clock, AlertCircle, LayoutList,
  ArrowDownToLine, ArrowUpFromLine, Link2, Inbox,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Textarea } from '../components/ui/Input';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatDate, formatDateTime } from '../utils/formatters';
import GatePassPdf from '../components/pdf/GatePassPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

const OUTWARD_STATUS_TABS = [
  { key: 'ALL', label: 'All', Icon: LayoutList },
  { key: 'PENDING_STORE', label: 'Pending Store', Icon: Clock },
  { key: 'PENDING_ACCOUNTS', label: 'Pending Accounts', Icon: Calculator },
  { key: 'APPROVED', label: 'Approved', Icon: Stamp },
  { key: 'RETURNED', label: 'Returned', Icon: RotateCcw },
  { key: 'CLOSED', label: 'Closed', Icon: CheckCircle2 },
  { key: 'REJECTED', label: 'Rejected', Icon: XCircle },
];

const INWARD_STATUS_TABS = [
  { key: 'ALL', label: 'All', Icon: LayoutList },
  { key: 'PENDING_ACCEPTANCE', label: 'Pending Acceptance', Icon: Inbox },
  { key: 'ACCEPTED', label: 'Accepted', Icon: PackageCheck },
  { key: 'CLOSED', label: 'Closed', Icon: CheckCircle2 },
];

const STATUS_META = {
  DRAFT:               { color: 'gray',   label: 'Draft' },
  PENDING_STORE:       { color: 'yellow', label: 'Pending Store' },
  PENDING_ACCOUNTS:    { color: 'yellow', label: 'Pending Accounts' },
  PENDING_APPROVAL:    { color: 'yellow', label: 'Pending Approval' },
  PENDING_ACCEPTANCE:  { color: 'yellow', label: 'Pending Acceptance' },
  ACCEPTED:            { color: 'green',  label: 'Accepted' },
  APPROVED:            { color: 'blue',   label: 'Approved' },
  RETURNED:            { color: 'green',  label: 'Returned' },
  CLOSED:              { color: 'gray',   label: 'Closed' },
  REJECTED:            { color: 'red',    label: 'Rejected' },
  OPEN:                { color: 'yellow', label: 'Open (legacy)' },
};

const PASS_TYPE_LABEL = {
  RETURNABLE: 'Returnable',
  NON_RETURNABLE: 'Non-Returnable',
  DELIVERY_CHALLAN: 'Delivery Challan',
};

const blankItem = () => ({
  description: '', quantity: 1, unit: 'pcs',
  dispatchedTo: '', itemPurpose: '', probableReturnDate: '',
  itemPassType: 'RETURNABLE', gatePassDetails: '', transportation: '',
  contactPersonDetails: '',
  sourceInwardGatePassItemId: '', // Only used for OUTWARD DELIVERY_CHALLAN items linking back to FIM
});

export default function GatePass() {
  const { user } = useAuth();
  const canCreateOutward = ['MANAGER', 'LOGISTICS', 'ADMIN'].includes(user?.role);
  // Inward FIM is captured by Stores Manager / Logistics (or Admin). Unit managers receive
  // direct-to-unit FIM via the Gate Pass list and mark it Collected from the detail modal.
  const canCreateInward = ['STORE_MANAGER', 'LOGISTICS', 'ADMIN'].includes(user?.role);
  const [direction, setDirection] = useState('OUTWARD');
  const STATUS_TABS = direction === 'INWARD' ? INWARD_STATUS_TABS : OUTWARD_STATUS_TABS;
  const defaultTab = direction === 'INWARD' ? 'PENDING_ACCEPTANCE' : 'PENDING_STORE';
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // When direction changes, reset to its sensible default tab
  useEffect(() => {
    setActiveTab(direction === 'INWARD' ? 'PENDING_ACCEPTANCE' : 'PENDING_STORE');
  }, [direction]);

  const load = () => {
    setLoading(true);
    api.get('/gatepasses', { params: {
      direction,
      status: activeTab === 'ALL' ? undefined : activeTab,
      limit: 200,
      fromDate: fromDate || undefined, toDate: toDate || undefined,
    } })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .catch(() => setGatePasses([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [direction, activeTab, refreshKey, fromDate, toDate]);

  const isInward = direction === 'INWARD';
  const canCreate = isInward ? canCreateInward : canCreateOutward;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gate Pass</h1>
          <p className="text-sm text-gray-500">
            {isInward
              ? 'INWARD — customer-supplied material (FIM). Returnable items return via Delivery Challan; non-returnable items are worked on and finished goods sent back via Delivery Challan.'
              : 'OUTWARD (RAMS/GPR/01) — Returnable, Non-Returnable, or Delivery Challan. Manager raises → Stores → Accounts.'}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> {isInward ? 'Record Inward' : 'Create Request'}
          </Button>
        )}
      </div>

      {/* Direction switcher */}
      <div className="inline-flex p-1 bg-gray-100 rounded-lg">
        <button
          onClick={() => setDirection('OUTWARD')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
            !isInward ? 'bg-white text-navy-700 shadow' : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <ArrowUpFromLine size={14} /> Outward
        </button>
        <button
          onClick={() => setDirection('INWARD')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
            isInward ? 'bg-white text-navy-700 shadow' : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <ArrowDownToLine size={14} /> Inward (FIM)
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap gap-2 border-b border-gray-200">
          {STATUS_TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={14} className="inline mr-1.5" />{label}
            </button>
          ))}
        </div>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : gatePasses.length === 0 ? (
        <Card className="text-center text-gray-500 py-10">
          {activeTab === 'ALL'
            ? `No ${isInward ? 'inward' : 'outward'} gate passes found.`
            : `No ${isInward ? 'inward' : 'outward'} gate passes in ${STATUS_META[activeTab]?.label.toLowerCase()}.`}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-2 font-medium">{isInward ? 'GP No.' : 'Request No.'}</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  {isInward ? (
                    <>
                      <th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Customer GP</th>
                      <th className="px-4 py-2 font-medium">Destination / Kind</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-2 font-medium">Site</th>
                      <th className="px-4 py-2 font-medium">Dispatched To</th>
                    </>
                  )}
                  <th className="px-4 py-2 font-medium">Items</th>
                  {!isInward && <th className="px-4 py-2 font-medium">Driver / Vehicle</th>}
                  <th className="px-4 py-2 font-medium">{isInward ? 'Recorded By' : 'Raised By'}</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {gatePasses.map(g => (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-navy-700">{g.passNumber}</td>
                    <td className="px-4 py-2">{formatDate(g.date)}</td>
                    {isInward ? (
                      <>
                        <td className="px-4 py-2">{g.customerName || g.partyName || '—'}</td>
                        <td className="px-4 py-2 text-gray-600 font-mono text-xs">{g.customerGatePassNo || '—'}</td>
                        <td className="px-4 py-2">
                          {g.inwardKind === 'DIRECT_TO_UNIT' ? (
                            <div className="space-y-0.5">
                              <Badge color="purple">Direct to unit</Badge>
                              <div className="text-xs text-gray-700">{g.destinationUnit?.name || '—'}</div>
                              {g.collectedAt && (
                                <Badge color="green">Collected · {formatDate(g.collectedAt)}</Badge>
                              )}
                            </div>
                          ) : (
                            <Badge color="gray">Into stores</Badge>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 text-gray-600">{g.siteName || '—'}</td>
                        <td className="px-4 py-2">{g.partyName || '—'}</td>
                      </>
                    )}
                    <td className="px-4 py-2 text-gray-500">{g.items?.length || 0}</td>
                    {!isInward && (
                      <td className="px-4 py-2 text-gray-600">
                        {g.driverName || g.vehicleNo
                          ? `${g.driverName || '—'} / ${g.vehicleNo || '—'}`
                          : <span className="text-gray-400">Pending</span>}
                      </td>
                    )}
                    <td className="px-4 py-2 text-gray-600">{g.createdBy?.name || '—'}</td>
                    <td className="px-4 py-2">
                      <Badge color={STATUS_META[g.status]?.color || 'gray'}>
                        {STATUS_META[g.status]?.label || g.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(g)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showCreate && (
        <CreateGatePassModal
          direction={direction}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setRefreshKey(k => k + 1); }}
        />
      )}

      {detail && (
        <DetailModal
          gatePass={detail}
          onClose={() => setDetail(null)}
          onAction={() => { setDetail(null); setRefreshKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

function CreateGatePassModal({ direction = 'OUTWARD', onClose, onCreated }) {
  const isInward = direction === 'INWARD';
  const [siteName, setSiteName] = useState('');
  const [remarks, setRemarks] = useState('');
  // INWARD-only fields
  const [customerName, setCustomerName] = useState('');
  const [customerGatePassNo, setCustomerGatePassNo] = useState('');
  const [customerGatePassDate, setCustomerGatePassDate] = useState('');
  // INWARD kind: stores-bound (existing) or direct-to-unit (no product-list step)
  const [inwardKind, setInwardKind] = useState('STORES');
  const [destinationUnitId, setDestinationUnitId] = useState('');
  const [units, setUnits] = useState([]);
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // INWARD: load active units so stores manager can pick a destination unit for DIRECT_TO_UNIT.
  useEffect(() => {
    if (!isInward) return;
    api.get('/units', { params: { limit: 100 } })
      .then(({ data }) => setUnits((data.units || data || []).filter(u => u.isActive !== false)))
      .catch(() => setUnits([]));
  }, [isInward]);

  // For OUTWARD DELIVERY_CHALLAN items: list of inward FIM items available to map.
  const [fimSources, setFimSources] = useState([]); // [{ id, label }]
  useEffect(() => {
    if (isInward) return;
    api.get('/gatepasses', { params: { direction: 'INWARD', status: 'ACCEPTED', limit: 100 } })
      .then(({ data }) => {
        const all = data.gatePasses || [];
        const flat = [];
        for (const gp of all) {
          for (const it of (gp.items || [])) {
            flat.push({
              id: it.id,
              label: `${gp.passNumber} · ${gp.customerName || ''} (Cust GP ${gp.customerGatePassNo || '—'}) · ${it.description} · ${it.quantity} ${it.unit}`,
            });
          }
        }
        setFimSources(flat);
      })
      .catch(() => setFimSources([]));
  }, [isInward]);

  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, blankItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (isInward) {
      if (!customerName.trim()) return setError('Customer name is required');
      if (!customerGatePassNo.trim()) return setError("Customer's gate pass number is required");
      if (items.some(i => i.itemPassType === 'DELIVERY_CHALLAN'))
        return setError('Delivery Challan is outward-only; inward items must be Returnable or Non-Returnable');
      if (inwardKind === 'DIRECT_TO_UNIT' && !destinationUnitId)
        return setError('Pick the destination unit for direct-to-unit inward');
    }
    if (items.some(i => !i.description.trim())) return setError('Each item needs a name/description');
    if (items.some(i => !i.quantity || Number(i.quantity) <= 0)) return setError('Each item needs a positive quantity');
    if (items.some(i => i.itemPassType === 'RETURNABLE' && !i.probableReturnDate)) {
      return setError('Returnable items need a probable date of return');
    }

    setSaving(true);
    try {
      await api.post('/gatepasses', {
        direction,
        siteName: siteName.trim() || undefined,
        remarks: remarks.trim() || undefined,
        ...(isInward ? {
          customerName: customerName.trim(),
          customerGatePassNo: customerGatePassNo.trim(),
          customerGatePassDate: customerGatePassDate || null,
          inwardKind,
          destinationUnitId: inwardKind === 'DIRECT_TO_UNIT' ? destinationUnitId : null,
        } : {}),
        items: items.map(i => ({
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
          sourceInwardGatePassItemId: !isInward && i.itemPassType === 'DELIVERY_CHALLAN' && i.sourceInwardGatePassItemId
            ? i.sourceInwardGatePassItemId : undefined,
        })),
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create gate pass request');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Modal isOpen onClose={onClose} title={isInward ? 'Record Inward Gate Pass (FIM)' : 'Gate Pass Request'} size="full">
      <div className="space-y-6">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <p className="text-xs text-gray-500">
          {isInward
            ? 'GP No. and Date are auto-generated. Capture the customer\'s own gate pass details below — these stay with the FIM product so it can always be traced back.'
            : 'Request No. and Date are auto-generated. The Store Incharge will add the driver and vehicle details after you submit.'}
        </p>

        {isInward ? (
          <div className="space-y-3 p-3 bg-blue-50 border border-blue-200 rounded">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Where is this material going?</label>
              <div className="flex flex-wrap gap-2">
                <label className={`px-3 py-1.5 text-sm rounded border cursor-pointer ${inwardKind === 'STORES' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                  <input type="radio" className="sr-only" checked={inwardKind === 'STORES'} onChange={() => setInwardKind('STORES')} />
                  Into stores (adds to product list)
                </label>
                <label className={`px-3 py-1.5 text-sm rounded border cursor-pointer ${inwardKind === 'DIRECT_TO_UNIT' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white border-gray-300 text-gray-700'}`}>
                  <input type="radio" className="sr-only" checked={inwardKind === 'DIRECT_TO_UNIT'} onChange={() => setInwardKind('DIRECT_TO_UNIT')} />
                  Direct to a unit (unit manager collects)
                </label>
              </div>
              <p className="mt-1 text-[11px] text-blue-800">
                {inwardKind === 'STORES'
                  ? 'Stores will accept these items into the product list (existing flow).'
                  : 'No product-list entry. The selected unit\'s manager will see this on their Gate Pass tab and mark it Collected — collection status stays on the gatepass itself.'}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label="Customer name *" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. ABC Pvt. Ltd." />
              <Input label="Customer's gate pass no. *" value={customerGatePassNo} onChange={e => setCustomerGatePassNo(e.target.value)} placeholder="As printed on customer's GP" />
              <Input type="date" label="Customer's gate pass date" value={customerGatePassDate} onChange={e => setCustomerGatePassDate(e.target.value)} />
              {inwardKind === 'DIRECT_TO_UNIT' && (
                <div className="md:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Destination unit *</label>
                  <select className={cellInput} value={destinationUnitId} onChange={e => setDestinationUnitId(e.target.value)}>
                    <option value="">— Select unit —</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-md">
            <Input label="Site" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="Site / Unit" />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800">Components</h4>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add row</Button>
          </div>

          <div className="border border-gray-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: isInward ? 1100 : 1280 }}>
              <colgroup>
                <col style={{ width: '36px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '140px' }} />
                {!isInward && <col style={{ width: '150px' }} />}
                <col style={{ width: '120px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '40px' }} />
              </colgroup>
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr className="text-left">
                  <th className="px-3 py-2.5 text-center font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Name of component</th>
                  <th className="px-3 py-2.5 text-center font-medium">Qty</th>
                  <th className="px-3 py-2.5 text-center font-medium">UOM</th>
                  <th className="px-3 py-2.5 font-medium">Dispatched to</th>
                  <th className="px-3 py-2.5 font-medium">Purpose</th>
                  <th className="px-3 py-2.5 font-medium">Probable return</th>
                  <th className="px-3 py-2.5 font-medium">Pass type</th>
                  {!isInward && <th className="px-3 py-2.5 font-medium">Pass details</th>}
                  <th className="px-3 py-2.5 font-medium">Transport</th>
                  <th className="px-3 py-2.5 font-medium">Remarks / Contact</th>
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
                        value={it.dispatchedTo} onChange={e => updateItem(idx, 'dispatchedTo', e.target.value)} />
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
                      <select className={cellInput}
                        value={it.itemPassType} onChange={e => updateItem(idx, 'itemPassType', e.target.value)}>
                        <option value="RETURNABLE">Returnable</option>
                        <option value="NON_RETURNABLE">Non-Returnable</option>
                        {!isInward && <option value="DELIVERY_CHALLAN">Delivery Challan</option>}
                      </select>
                    </td>
                    {!isInward && (
                      <td className="px-2 py-2">
                        {it.itemPassType === 'DELIVERY_CHALLAN' ? (
                          <select className={cellInput}
                            value={it.sourceInwardGatePassItemId || ''}
                            onChange={e => updateItem(idx, 'sourceInwardGatePassItemId', e.target.value)}
                            title="Map this finished good to the inward FIM it was made from">
                            <option value="">— No FIM source —</option>
                            {fimSources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                        ) : (
                          <input className={cellInput}
                            value={it.gatePassDetails} onChange={e => updateItem(idx, 'gatePassDetails', e.target.value)} />
                        )}
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.transportation} onChange={e => updateItem(idx, 'transportation', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.contactPersonDetails} onChange={e => updateItem(idx, 'contactPersonDetails', e.target.value)} />
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
        </div>

        <Textarea label="Remarks" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Send size={14} /> {saving ? 'Submitting…' : 'Submit to Stores'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ gatePass: initial, onClose, onAction }) {
  const { user } = useAuth();
  const [g, setG] = useState(initial);
  const isInward = g.direction === 'INWARD';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [returnedBy, setReturnedBy] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [driverName, setDriverName] = useState(initial.driverName || '');
  const [vehicleNo, setVehicleNo] = useState(initial.vehicleNo || '');

  const act = async (url, body) => {
    setError(''); setBusy(true);
    try {
      const { data } = await api.put(url, body || {});
      setG(data);
      onAction();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    }
    setBusy(false);
  };

  const role = user?.role;
  const isAdmin = role === 'ADMIN';
  const canStoreApprove = !isInward && g.status === 'PENDING_STORE' && (role === 'STORE_MANAGER' || role === 'LOGISTICS' || isAdmin);
  const canAccountsApprove = !isInward && g.status === 'PENDING_ACCOUNTS' && (role === 'ACCOUNTING' || role === 'FINANCE' || isAdmin);
  const canReject = !isInward && ['PENDING_STORE', 'PENDING_ACCOUNTS'].includes(g.status) &&
    (canStoreApprove || canAccountsApprove);

  const hasReturnable = g.passType === 'RETURNABLE' || (g.items || []).some(i => i.itemPassType === 'RETURNABLE');
  const canReturn = !isInward && hasReturnable && ['APPROVED', 'OPEN'].includes(g.status) && (role === 'STORE_MANAGER' || isAdmin);
  const canClose = !['CLOSED', 'REJECTED'].includes(g.status) && (role === 'STORE_MANAGER' || isAdmin);

  // DIRECT_TO_UNIT inward: the destination unit's manager (or admin) marks Collected from this modal.
  const canMarkCollected = isInward
    && g.inwardKind === 'DIRECT_TO_UNIT'
    && g.status === 'PENDING_ACCEPTANCE'
    && !g.collectedAt
    && (isAdmin || (role === 'MANAGER' && user?.unitId && user.unitId === g.destinationUnitId));

  return (
    <Modal isOpen onClose={onClose} title={`${isInward ? 'Inward Gate Pass' : 'Gate Pass Request'} ${g.passNumber}`} size="xl">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge color={isInward ? 'blue' : 'gray'}>
              {isInward ? <><ArrowDownToLine size={10} className="inline mr-1" /> Inward (FIM)</> : <><ArrowUpFromLine size={10} className="inline mr-1" /> Outward</>}
            </Badge>
            <Badge color={STATUS_META[g.status]?.color || 'gray'}>{STATUS_META[g.status]?.label || g.status}</Badge>
          </div>
          {!isInward && (
            <DownloadPdfButton
              document={<GatePassPdf data={g} />}
              fileName={`${g.passNumber}.pdf`}
              label="View Gate Pass PDF"
            />
          )}
        </div>

        {/* Approval trail (outward only) */}
        {!isInward && <ApprovalTrail g={g} />}

        {isInward ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm p-3 bg-blue-50 border border-blue-200 rounded">
            <Field label="Date received" value={formatDate(g.date)} />
            <Field label="Customer" value={g.customerName} />
            <Field label="Customer GP No." value={g.customerGatePassNo} />
            {g.customerGatePassDate && <Field label="Customer GP date" value={formatDate(g.customerGatePassDate)} />}
            {g.inwardKind === 'DIRECT_TO_UNIT' && (
              <>
                <Field label="Destination unit" value={g.destinationUnit?.name || '—'} />
                <Field
                  label="Collected"
                  value={g.collectedAt
                    ? `${formatDateTime(g.collectedAt)}${g.collectedBy?.name ? ` · by ${g.collectedBy.name}` : ''}`
                    : 'Not yet collected'}
                />
              </>
            )}
            <Field label="Recorded by" value={g.createdBy?.name} />
            <Field label="Recorded at" value={formatDateTime(g.createdAt)} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <Field label="Date" value={formatDate(g.date)} />
            <Field label="Site" value={g.siteName} />
            <Field label="Dispatched-to (summary)" value={g.partyName} />
            <Field label="Driver" value={g.driverName} />
            <Field label="Vehicle No." value={g.vehicleNo} />
            {g.actualReturnDate && <Field label="Actual Return" value={formatDate(g.actualReturnDate)} />}
            <Field label="Raised By" value={g.createdBy?.name} />
            <Field label="Raised At" value={formatDateTime(g.createdAt)} />
          </div>
        )}

        <div>
          <h4 className="font-medium text-gray-800 mb-2">Components</h4>
          <div className="border border-gray-200 rounded overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-600">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Component</th>
                  <th className="px-2 py-1.5">Qty</th>
                  <th className="px-2 py-1.5">UOM</th>
                  <th className="px-2 py-1.5">Type</th>
                  {isInward ? (
                    <>
                      <th className="px-2 py-1.5">Probable return</th>
                      <th className="px-2 py-1.5">Inwarded</th>
                      <th className="px-2 py-1.5">FIM Products</th>
                      <th className="px-2 py-1.5">Returned via DC</th>
                    </>
                  ) : (
                    <>
                      <th className="px-2 py-1.5">Dispatched to</th>
                      <th className="px-2 py-1.5">Purpose</th>
                      <th className="px-2 py-1.5">Probable return</th>
                      <th className="px-2 py-1.5">Pass / FIM details</th>
                      <th className="px-2 py-1.5">Transport</th>
                      <th className="px-2 py-1.5">Remarks / Contact</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {(g.items || []).map((it, idx) => {
                  const linkedOutwards = it.outwardLinkedItems || [];
                  return (
                    <tr key={it.id || idx} className="border-t border-gray-100">
                      <td className="px-2 py-1.5">{idx + 1}</td>
                      <td className="px-2 py-1.5">{it.description}</td>
                      <td className="px-2 py-1.5">{it.quantity}</td>
                      <td className="px-2 py-1.5">{it.unit}</td>
                      <td className="px-2 py-1.5 text-gray-600">{it.itemPassType ? PASS_TYPE_LABEL[it.itemPassType] : '—'}</td>
                      {isInward ? (
                        <>
                          <td className="px-2 py-1.5 text-gray-600">{it.probableReturnDate ? formatDate(it.probableReturnDate) : '—'}</td>
                          <td className="px-2 py-1.5 text-gray-700 font-medium">{(it.inwardedQty || 0)} / {it.quantity}</td>
                          <td className="px-2 py-1.5 text-gray-600">
                            {(it.fimBatches || []).length === 0 ? '—' : (
                              <ul className="space-y-0.5">
                                {(it.fimBatches || []).map(b => (
                                  <li key={b.id} className="leading-tight">
                                    <span className="font-medium text-navy-700">{b.product?.name}</span>
                                    <span className="text-gray-500"> · {b.quantity} {b.product?.unit}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600">
                            {linkedOutwards.length === 0 ? '—' : (
                              <ul className="space-y-0.5">
                                {linkedOutwards.map(lo => (
                                  <li key={lo.id} className="leading-tight">
                                    <Link2 size={10} className="inline mr-0.5" />
                                    <span className="font-mono">{lo.gatePass?.passNumber}</span>
                                    <span className="text-gray-500"> · {lo.quantity} {lo.unit}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-1.5 text-gray-600">{it.dispatchedTo || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{it.itemPurpose || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{it.probableReturnDate ? formatDate(it.probableReturnDate) : '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">
                            {it.sourceInwardGatePassItem ? (
                              <span className="inline-flex items-center gap-1 text-blue-700">
                                <Link2 size={10} />
                                FIM from <span className="font-mono">{it.sourceInwardGatePassItem.gatePass?.passNumber}</span>
                                <span className="text-gray-500">(Cust GP {it.sourceInwardGatePassItem.gatePass?.customerGatePassNo || '—'})</span>
                              </span>
                            ) : (it.gatePassDetails || '—')}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600">{it.transportation || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{it.contactPersonDetails || it.remarks || '—'}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {isInward && g.status === 'PENDING_ACCEPTANCE' && g.inwardKind !== 'DIRECT_TO_UNIT' && (
            <p className="mt-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
              Stores: open <strong>Inward Entry → From Gate Pass (FIM)</strong> to accept these items into the product list.
            </p>
          )}
          {isInward && g.inwardKind === 'DIRECT_TO_UNIT' && g.status === 'PENDING_ACCEPTANCE' && (
            <p className="mt-2 text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded p-2">
              Direct-to-unit FIM: the destination unit's manager marks this <strong>Collected</strong> from this page. It is not added to the product list.
            </p>
          )}
        </div>

        {g.remarks && (
          <div>
            <h4 className="font-medium text-gray-800 mb-1">Remarks</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{g.remarks}</p>
          </div>
        )}

        {g.rejectedReason && (
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-xs font-medium text-red-700 mb-1">Rejected</p>
            <p className="text-sm text-red-800">{g.rejectedReason}</p>
          </div>
        )}

        <div className="border-t border-gray-200 pt-4 space-y-3">
          {canStoreApprove && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
              <p className="text-xs font-medium text-amber-800">
                Arrange vehicle and forward to Accounts
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  label="Driver name *"
                  value={driverName}
                  onChange={e => setDriverName(e.target.value)}
                  placeholder="Driver's full name"
                />
                <Input
                  label="Vehicle number *"
                  value={vehicleNo}
                  onChange={e => setVehicleNo(e.target.value)}
                  placeholder="e.g. AP 16 AB 1234"
                />
              </div>
            </div>
          )}

          {(canStoreApprove || canAccountsApprove) && (
            <div className="flex flex-wrap gap-2 justify-end">
              {canStoreApprove && (
                <Button
                  disabled={busy || !driverName.trim() || !vehicleNo.trim()}
                  onClick={() => act(`/gatepasses/${g.id}/store-approve`, {
                    driverName: driverName.trim(),
                    vehicleNo: vehicleNo.trim(),
                  })}>
                  <Truck size={14} /> Forward to Accounts
                </Button>
              )}
              {canAccountsApprove && (
                <Button disabled={busy} onClick={() => act(`/gatepasses/${g.id}/accounts-approve`)}>
                  <ShieldCheck size={14} /> Accounts — Approve Payment
                </Button>
              )}
              {canReject && !showRejectBox && (
                <Button variant="danger" disabled={busy} onClick={() => setShowRejectBox(true)}>
                  <XCircle size={14} /> Reject
                </Button>
              )}
            </div>
          )}

          {showRejectBox && (
            <div className="p-3 bg-red-50 border border-red-200 rounded space-y-2">
              <Textarea
                label="Rejection reason *"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={2}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => { setShowRejectBox(false); setRejectReason(''); }}>Cancel</Button>
                <Button variant="danger" size="sm" disabled={busy || !rejectReason.trim()}
                  onClick={() => act(`/gatepasses/${g.id}/reject`, { reason: rejectReason.trim() })}>
                  Confirm Reject
                </Button>
              </div>
            </div>
          )}

          {canReturn && (
            <div className="flex items-end gap-2">
              <Input
                label="Returned By (receiver name)"
                value={returnedBy}
                onChange={e => setReturnedBy(e.target.value)}
                className="flex-1"
              />
              <Button variant="secondary" disabled={busy}
                onClick={() => act(`/gatepasses/${g.id}/return`, { returnedBy: returnedBy.trim() || undefined })}>
                <RotateCcw size={14} /> Mark as Returned
              </Button>
            </div>
          )}

          {canMarkCollected && (
            <div className="flex justify-end">
              <Button disabled={busy}
                onClick={() => act(`/gatepasses/${g.id}/collect`)}>
                <PackageCheck size={14} /> Mark as Collected
              </Button>
            </div>
          )}

          {canClose && (
            <div className="flex justify-end">
              <Button variant="danger" disabled={busy}
                onClick={() => act(`/gatepasses/${g.id}/close`)}>
                <CheckCircle2 size={14} /> Close Gate Pass
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ApprovalTrail({ g }) {
  const stages = [
    { label: 'Site Incharge', user: g.siteIncharge, at: g.siteInchargeAt, icon: Send },
    { label: 'Store Incharge', user: g.storeIncharge, at: g.storeInchargeAt, icon: PackageCheck },
    { label: 'Accounts (Final)', user: g.accountsApprover, at: g.accountsAt, icon: ShieldCheck },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {stages.map(({ label, user, at, icon: Icon }) => (
        <div key={label} className={`p-2 rounded border text-xs ${at ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-gray-700 font-medium">
            <Icon size={12} /> {label}
          </div>
          {at ? (
            <>
              <p className="text-gray-800 mt-0.5">{user?.name || '—'}</p>
              <p className="text-gray-500">{formatDateTime(at)}</p>
            </>
          ) : (
            <p className="text-gray-400 mt-0.5 flex items-center gap-1"><AlertCircle size={10} /> Pending</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-gray-800">{value || '—'}</p>
    </div>
  );
}
