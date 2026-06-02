import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Trash2, RotateCcw, CheckCircle2, Truck, PackageCheck,
  Send, ShieldCheck, Calculator, Stamp, XCircle, Clock, AlertCircle, LayoutList,
  DoorOpen, MapPin, Building2, FileText, Upload, FileDown, ClipboardList, Briefcase,
} from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatDate, formatDateTime } from '../utils/formatters';
import GatePassPdf from '../components/pdf/GatePassPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

const REGISTERS = [
  { key: 'OUTWARD', label: 'Outward Register (RAMS/GPR/01)', Icon: DoorOpen },
  { key: 'LOCAL_JOB_REG', label: 'Local Job Work Register (RAPS/JL-JW)', Icon: Briefcase },
];

const STATUS_TABS = [
  { key: 'ALL', label: 'All', Icon: LayoutList },
  { key: 'PENDING_STORE', label: 'Pending Store', Icon: Clock },
  { key: 'PENDING_ACCOUNTS', label: 'Pending Accounts', Icon: Calculator },
  { key: 'PENDING_STORE_REVIEW', label: 'Pending Store Review', Icon: PackageCheck },
  { key: 'PENDING_LOGISTICS', label: 'Pending Logistics', Icon: Truck },
  { key: 'IN_TRANSIT', label: 'In Transit', Icon: Send },
  { key: 'CLOSED', label: 'Closed', Icon: CheckCircle2 },
  { key: 'REJECTED', label: 'Rejected', Icon: XCircle },
];

const STATUS_META = {
  DRAFT:                { color: 'gray',   label: 'Draft' },
  PENDING_STORE:        { color: 'yellow', label: 'Pending Store' },
  PENDING_ACCOUNTS:     { color: 'yellow', label: 'Pending Accounts' },
  PENDING_STORE_REVIEW: { color: 'yellow', label: 'Pending Store Review' },
  PENDING_LOGISTICS:    { color: 'yellow', label: 'Pending Logistics' },
  IN_TRANSIT:           { color: 'blue',   label: 'In Transit' },
  PENDING_RETURN:       { color: 'yellow', label: 'Pending Return' },
  PENDING_APPROVAL:     { color: 'yellow', label: 'Pending Approval' },
  APPROVED:             { color: 'blue',   label: 'Approved' },
  RETURNED:             { color: 'green',  label: 'Returned' },
  CLOSED:               { color: 'gray',   label: 'Closed' },
  REJECTED:             { color: 'red',    label: 'Rejected' },
  OPEN:                 { color: 'yellow', label: 'Open (legacy)' },
};

const KIND_META = {
  LOCAL_JOB: { color: 'purple', label: 'Local Job' },
  OUTSIDE:   { color: 'blue',   label: 'Outside' },
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
});

export default function GatePass() {
  const { user } = useAuth();
  const canCreate = ['MANAGER', 'LOGISTICS', 'ADMIN'].includes(user?.role);
  const [register, setRegister] = useState('OUTWARD');
  const [activeTab, setActiveTab] = useState('PENDING_STORE');
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const load = () => {
    setLoading(true);
    const params = {
      direction: 'OUTWARD',
      limit: 200,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    };
    if (register === 'OUTWARD' && activeTab !== 'ALL') params.status = activeTab;
    api.get('/gatepasses', { params })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .catch(() => setGatePasses([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [register, activeTab, refreshKey, fromDate, toDate]);

  const localJobRows = useMemo(
    () => gatePasses.filter((g) => g.kind === 'LOCAL_JOB'),
    [gatePasses]
  );

  return (
    <div className="space-y-6">
      <PageHero
        title="Gate Pass"
        subtitle="OUTWARD movement — Local Job (returns to stores) or Outside (delivered to a site office). Two registers as per RAMS/GPR/01 and RAPS/JL-JW."
        eyebrow="Outward Movement"
        icon={DoorOpen}
        actions={
          canCreate && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Create Gate Pass
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {REGISTERS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setRegister(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              register === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={14} className="inline mr-1.5" />{label}
          </button>
        ))}
      </div>

      {register === 'OUTWARD' ? (
        <>
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
                ? 'No outward gate passes found.'
                : `No outward gate passes in ${STATUS_META[activeTab]?.label.toLowerCase()}.`}
            </Card>
          ) : (
            <OutwardTable rows={gatePasses} onView={setDetail} />
          )}
        </>
      ) : (
        <LocalJobRegister rows={localJobRows} loading={loading} onView={setDetail} />
      )}

      {showCreate && (
        <CreateGatePassModal
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

function OutwardTable({ rows, onView }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-gray-600">
              <th className="px-4 py-2 font-medium">Pass No.</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">Dispatched To / Destination</th>
              <th className="px-4 py-2 font-medium">Items</th>
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th className="px-4 py-2 font-medium">Raised By</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g, i) => (
              <tr key={g.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                <td className="px-4 py-2 font-medium text-navy-700">{g.passNumber}</td>
                <td className="px-4 py-2">{formatDate(g.date)}</td>
                <td className="px-4 py-2">
                  {g.kind ? (
                    <Badge color={KIND_META[g.kind]?.color}>{KIND_META[g.kind]?.label}</Badge>
                  ) : <span className="text-gray-400 text-xs">Legacy / FIM</span>}
                </td>
                <td className="px-4 py-2">{g.destinationOffice || g.partyName || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{g.items?.length || 0}</td>
                <td className="px-4 py-2 text-gray-600">
                  {g.assignedVehicle ? (
                    <span className="text-xs">
                      <span className="font-mono">{g.assignedVehicle.regNumber}</span>
                      {g.assignedVehicle.driverName && <span className="text-gray-500"> · {g.assignedVehicle.driverName}</span>}
                    </span>
                  ) : g.vehicleNo
                    ? <span className="text-xs">{g.vehicleNo}{g.driverName ? ` · ${g.driverName}` : ''}</span>
                    : <span className="text-gray-400">Pending</span>}
                </td>
                <td className="px-4 py-2 text-gray-600">{g.createdBy?.name || '—'}</td>
                <td className="px-4 py-2">
                  <Badge color={STATUS_META[g.status]?.color || 'gray'}>
                    {STATUS_META[g.status]?.label || g.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => onView(g)}>View</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function LocalJobRegister({ rows, loading, onView }) {
  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (rows.length === 0) {
    return <Card className="text-center text-gray-500 py-10">No local job work gate passes yet.</Card>;
  }

  // The Local Job Work Register flattens items so each row is one component
  // (matching the RAPS/JL-JW form layout).
  const flat = [];
  rows.forEach((g) => {
    (g.items || []).forEach((it) => flat.push({ g, it }));
  });

  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 1500 }}>
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-gray-600">
              <th className="px-2 py-2 font-medium">JW No.</th>
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="px-2 py-2 font-medium">Gate Pass No.</th>
              <th className="px-2 py-2 font-medium">Item Description</th>
              <th className="px-2 py-2 font-medium">Qty</th>
              <th className="px-2 py-2 font-medium">Vendor Details</th>
              <th className="px-2 py-2 font-medium">Purpose</th>
              <th className="px-2 py-2 font-medium">Probable Rtn. Dt</th>
              <th className="px-2 py-2 font-medium">Requested By</th>
              <th className="px-2 py-2 font-medium">Stores Sign (Issue)</th>
              <th className="px-2 py-2 font-medium">Return Date</th>
              <th className="px-2 py-2 font-medium">Issued To Dept</th>
              <th className="px-2 py-2 font-medium">Receiver Sign</th>
              <th className="px-2 py-2 font-medium">Stores Sign (Recv)</th>
              <th className="px-2 py-2 font-medium">Remarks</th>
              <th className="px-2 py-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {flat.map(({ g, it }, idx) => (
              <tr key={`${g.id}-${it.id || idx}`} className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                <td className="px-2 py-1.5 font-mono">{g.jobWorkNo || '—'}</td>
                <td className="px-2 py-1.5">{formatDate(g.date)}</td>
                <td className="px-2 py-1.5 font-mono text-navy-700">{g.passNumber}</td>
                <td className="px-2 py-1.5">{it.description}</td>
                <td className="px-2 py-1.5">{it.quantity} {it.unit}</td>
                <td className="px-2 py-1.5">{g.vendorDetails || '—'}</td>
                <td className="px-2 py-1.5">{it.itemPurpose || '—'}</td>
                <td className="px-2 py-1.5">{it.probableReturnDate ? formatDate(it.probableReturnDate) : '—'}</td>
                <td className="px-2 py-1.5">{g.requestedBy?.name || g.createdBy?.name || '—'}</td>
                <td className="px-2 py-1.5">{g.storeIncharge?.name || '—'}</td>
                <td className="px-2 py-1.5">{g.actualReturnDate ? formatDate(g.actualReturnDate) : '—'}</td>
                <td className="px-2 py-1.5">{it.dispatchedTo || '—'}</td>
                <td className="px-2 py-1.5">{g.localReturnedBy?.name || '—'}</td>
                <td className="px-2 py-1.5">{g.localReturnedBy?.name || g.storeIncharge?.name || '—'}</td>
                <td className="px-2 py-1.5">{it.contactPersonDetails || g.remarks || '—'}</td>
                <td className="px-2 py-1.5 text-right">
                  <Button variant="ghost" size="sm" onClick={() => onView(g)}>View</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CreateGatePassModal({ onClose, onCreated }) {
  const [kind, setKind] = useState('LOCAL_JOB');
  const [siteName, setSiteName] = useState('');
  const [destinationOffice, setDestinationOffice] = useState('');
  const [jobWorkNo, setJobWorkNo] = useState('');
  const [vendorDetails, setVendorDetails] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, blankItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (kind === 'OUTSIDE' && !destinationOffice.trim()) {
      return setError('Destination office is required for Outside gate passes');
    }
    if (items.some(i => !i.description.trim())) return setError('Each item needs a name/description');
    if (items.some(i => !i.quantity || Number(i.quantity) <= 0)) return setError('Each item needs a positive quantity');
    if (items.some(i => i.itemPassType === 'RETURNABLE' && !i.probableReturnDate)) {
      return setError('Returnable items need a probable date of return');
    }

    setSaving(true);
    try {
      await api.post('/gatepasses', {
        direction: 'OUTWARD',
        kind,
        siteName: siteName.trim() || undefined,
        destinationOffice: kind === 'OUTSIDE' ? destinationOffice.trim() : undefined,
        jobWorkNo: kind === 'LOCAL_JOB' ? (jobWorkNo.trim() || undefined) : undefined,
        vendorDetails: kind === 'LOCAL_JOB' ? (vendorDetails.trim() || undefined) : undefined,
        remarks: remarks.trim() || undefined,
        items: items.map(i => ({
          description: i.description.trim(),
          quantity: Number(i.quantity),
          unit: i.unit || 'pcs',
          dispatchedTo: i.dispatchedTo?.trim() || null,
          itemPurpose: i.itemPurpose?.trim() || null,
          probableReturnDate: i.probableReturnDate || null,
          itemPassType: i.itemPassType === 'DELIVERY_CHALLAN' ? 'NON_RETURNABLE' : (i.itemPassType || null),
          gatePassDetails: i.gatePassDetails?.trim() || null,
          transportation: i.transportation?.trim() || null,
          contactPersonDetails: i.contactPersonDetails?.trim() || null,
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
    <Modal isOpen onClose={onClose} title="Gate Pass Request" size="full">
      <div className="space-y-6">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div>
          <p className="text-xs font-medium text-gray-700 mb-2">Gate Pass Type</p>
          <div className="flex gap-2">
            {['LOCAL_JOB', 'OUTSIDE'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                  kind === k
                    ? 'bg-navy-700 text-white border-navy-700'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}>
                {KIND_META[k].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {kind === 'LOCAL_JOB'
              ? 'Local Job: material/work going to a vendor — returns to stores when work is done.'
              : 'Outside: material being delivered to another RAPS office — site office confirms arrival.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Site / Unit" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="Site or unit" />
          {kind === 'OUTSIDE' && (
            <Input
              label="Destination Office *"
              value={destinationOffice}
              onChange={e => setDestinationOffice(e.target.value)}
              placeholder="e.g. Hyderabad Office"
            />
          )}
          {kind === 'LOCAL_JOB' && (
            <>
              <Input
                label="Job Work No."
                value={jobWorkNo}
                onChange={e => setJobWorkNo(e.target.value)}
                placeholder="e.g. JW/2026/001"
              />
              <Input
                label="Vendor Details"
                value={vendorDetails}
                onChange={e => setVendorDetails(e.target.value)}
                placeholder="Vendor name / contact"
              />
            </>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Pass No. and Date are auto-generated. The Store Incharge will approve, then Logistics assigns the vehicle.
        </p>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800">Components (RAMS/GPR/01)</h4>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add row</Button>
          </div>

          <div className="border border-gray-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1280 }}>
              <colgroup>
                <col style={{ width: '36px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '150px' }} />
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
                  <th className="px-3 py-2.5 font-medium">Pass details</th>
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
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.gatePassDetails} onChange={e => updateItem(idx, 'gatePassDetails', e.target.value)} />
                    </td>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  const reload = async () => {
    try {
      const { data } = await api.get(`/gatepasses/${g.id}`);
      setG(data);
    } catch { /* ignore */ }
  };

  const act = async (url, body, method = 'put') => {
    setError(''); setBusy(true);
    try {
      const { data } = await api[method](url, body || {});
      setG(data);
      onAction();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    }
    setBusy(false);
  };

  const role = user?.role;
  const isAdmin = role === 'ADMIN';
  const isV2 = !!g.kind;
  const isOutside = g.kind === 'OUTSIDE';
  const isLocalJob = g.kind === 'LOCAL_JOB';

  const canStoreApprove = g.status === 'PENDING_STORE' && (role === 'STORE_MANAGER' || isAdmin);
  const canAccountsInvoice = g.status === 'PENDING_ACCOUNTS' && isOutside && (role === 'ACCOUNTING' || role === 'FINANCE' || isAdmin);
  const canStoreReview = g.status === 'PENDING_STORE_REVIEW' && (role === 'STORE_MANAGER' || isAdmin);
  const canLogistics = g.status === 'PENDING_LOGISTICS' && isV2 && (role === 'LOGISTICS' || isAdmin);
  const canSiteAck = g.status === 'IN_TRANSIT' && isOutside && (role === 'SITE_OFFICE' || isAdmin);
  const canStoresAck = g.status === 'IN_TRANSIT' && isLocalJob && (role === 'STORE_MANAGER' || isAdmin);

  const canReject =
    ['PENDING_STORE', 'PENDING_ACCOUNTS', 'PENDING_STORE_REVIEW', 'PENDING_LOGISTICS'].includes(g.status) &&
    (canStoreApprove || canAccountsInvoice || canStoreReview || canLogistics);

  return (
    <Modal isOpen onClose={onClose} title={`Gate Pass ${g.passNumber}`} size="xl">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge color={STATUS_META[g.status]?.color || 'gray'}>{STATUS_META[g.status]?.label || g.status}</Badge>
            {g.kind && <Badge color={KIND_META[g.kind]?.color}>{KIND_META[g.kind]?.label}</Badge>}
          </div>
          <DownloadPdfButton
            document={<GatePassPdf data={g} />}
            fileName={`${g.passNumber}.pdf`}
            label="View Gate Pass PDF"
          />
        </div>

        <ApprovalTrail g={g} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="Date" value={formatDate(g.date)} />
          <Field label="Site / Unit" value={g.siteName} />
          {isOutside && <Field label="Destination Office" value={g.destinationOffice} icon={MapPin} />}
          {isLocalJob && <Field label="Job Work No." value={g.jobWorkNo} icon={FileText} />}
          {isLocalJob && <Field label="Vendor" value={g.vendorDetails} icon={Building2} />}
          <Field label="Dispatched-to (summary)" value={g.partyName} />
          {(g.assignedVehicle || g.vehicleNo) && (
            <Field
              label="Vehicle"
              value={g.assignedVehicle
                ? `${g.assignedVehicle.regNumber}${g.assignedVehicle.driverName ? ` · ${g.assignedVehicle.driverName}` : ''}`
                : `${g.vehicleNo || '—'}${g.driverName ? ` · ${g.driverName}` : ''}`}
            />
          )}
          {g.invoiceNo && <Field label="Invoice No." value={g.invoiceNo} />}
          {g.dcNo && <Field label="DC No." value={g.dcNo} />}
          {g.dispatchedAt && <Field label="Dispatched At" value={formatDateTime(g.dispatchedAt)} />}
          {g.reachedDate && <Field label="Reached On" value={formatDate(g.reachedDate)} />}
          {g.actualReturnDate && <Field label="Actual Return" value={formatDate(g.actualReturnDate)} />}
          <Field label="Raised By" value={g.createdBy?.name} />
          <Field label="Raised At" value={formatDateTime(g.createdAt)} />
        </div>

        {g.signedDeliveryPdfUrl && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-800 text-sm">
              <FileText size={16} /> Driver-signed delivery PDF available
            </div>
            <a
              href={g.signedDeliveryPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
            >
              <FileDown size={12} /> Download
            </a>
          </div>
        )}

        <ItemsTable items={g.items || []} />

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
            <StoreApproveBox g={g} busy={busy} onSubmit={(body) => act(`/gatepasses/${g.id}/store-approve`, body)} />
          )}

          {canAccountsInvoice && (
            <AccountsInvoiceBox busy={busy} onSubmit={(body) => act(`/gatepasses/${g.id}/accounts-invoice`, body)} />
          )}

          {canStoreReview && (
            <StoreReviewBox busy={busy} onSubmit={(body) => act(`/gatepasses/${g.id}/store-review`, body)} />
          )}

          {canLogistics && (
            <LogisticsBox
              g={g}
              busy={busy}
              onAssigned={reload}
              onDispatched={() => { onAction(); reload(); }}
              setError={setError}
            />
          )}

          {canSiteAck && (
            <SiteOfficeAckBox busy={busy} onSubmit={(body) => act(`/gatepasses/${g.id}/site-office-ack`, body)} />
          )}

          {canStoresAck && (
            <StoresAckBox g={g} busy={busy} onSubmit={(body) => act(`/gatepasses/${g.id}/stores-ack`, body)} />
          )}

          {canReject && !showRejectBox && (
            <div className="flex justify-end">
              <Button variant="danger" disabled={busy} onClick={() => setShowRejectBox(true)}>
                <XCircle size={14} /> Reject
              </Button>
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
        </div>
      </div>
    </Modal>
  );
}

function ItemsTable({ items }) {
  return (
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
              <th className="px-2 py-1.5">Dispatched to</th>
              <th className="px-2 py-1.5">Purpose</th>
              <th className="px-2 py-1.5">Probable return</th>
              <th className="px-2 py-1.5">Pass details</th>
              <th className="px-2 py-1.5">Transport</th>
              <th className="px-2 py-1.5">Remarks / Contact</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id || idx} className="border-t border-gray-100">
                <td className="px-2 py-1.5">{idx + 1}</td>
                <td className="px-2 py-1.5">{it.description}</td>
                <td className="px-2 py-1.5">{it.quantity}</td>
                <td className="px-2 py-1.5">{it.unit}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.itemPassType ? PASS_TYPE_LABEL[it.itemPassType] : '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.dispatchedTo || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.itemPurpose || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.probableReturnDate ? formatDate(it.probableReturnDate) : '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.gatePassDetails || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.transportation || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.contactPersonDetails || it.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StoreApproveBox({ g, busy, onSubmit }) {
  const isLegacy = !g.kind;
  const [driverName, setDriverName] = useState(g.driverName || '');
  const [vehicleNo, setVehicleNo] = useState(g.vehicleNo || '');
  const [remarks, setRemarks] = useState('');

  const submit = () => {
    const body = { remarks: remarks.trim() || undefined };
    if (isLegacy) {
      body.driverName = driverName.trim();
      body.vehicleNo = vehicleNo.trim();
    }
    onSubmit(body);
  };

  const disabled = busy || (isLegacy && (!driverName.trim() || !vehicleNo.trim()));

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">
        {isLegacy
          ? 'Legacy FIM gate pass — capture driver/vehicle and forward to Accounts'
          : g.kind === 'OUTSIDE'
            ? 'Approve and forward to Accounts for invoice details'
            : 'Approve and forward to Stores Review'}
      </p>
      {isLegacy && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input label="Driver name *" value={driverName} onChange={e => setDriverName(e.target.value)} />
          <Input label="Vehicle number *" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
        </div>
      )}
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={disabled} onClick={submit}>
          <ShieldCheck size={14} /> Approve & Forward
        </Button>
      </div>
    </div>
  );
}

function AccountsInvoiceBox({ busy, onSubmit }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');

  const submit = () => onSubmit({
    invoiceNo: invoiceNo.trim() || undefined,
    dcNo: dcNo.trim() || undefined,
    remarks: remarks.trim() || undefined,
  });

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">Add invoice / DC details and forward to Stores for final review</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input label="Invoice No." value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="e.g. INV/2026/001" />
        <Input label="Delivery Challan No." value={dcNo} onChange={e => setDcNo(e.target.value)} placeholder="e.g. DC/2026/001" />
      </div>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy || (!invoiceNo.trim() && !dcNo.trim())} onClick={submit}>
          <Calculator size={14} /> Save Invoice & Forward
        </Button>
      </div>
    </div>
  );
}

function StoreReviewBox({ busy, onSubmit }) {
  const [remarks, setRemarks] = useState('');
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">Confirm review and forward to Logistics for vehicle assignment</p>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => onSubmit({ remarks: remarks.trim() || undefined })}>
          <PackageCheck size={14} /> Forward to Logistics
        </Button>
      </div>
    </div>
  );
}

function LogisticsBox({ g, busy, onAssigned, onDispatched, setError }) {
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState(g.assignedVehicleId || '');
  const [signedPdf, setSignedPdf] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    api.get('/vehicles', { params: { status: 'ACTIVE' } })
      .then(({ data }) => setVehicles(data.vehicles || []))
      .catch(() => setVehicles([]));
  }, []);

  const assign = async () => {
    if (!vehicleId) return setError('Pick a vehicle');
    setError(''); setLocalBusy(true);
    try {
      await api.put(`/gatepasses/${g.id}/logistics-assign`, { vehicleId });
      onAssigned();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign vehicle');
    }
    setLocalBusy(false);
  };

  const dispatch = async () => {
    if (g.kind === 'OUTSIDE' && !signedPdf) {
      return setError('Driver-signed delivery PDF is required for Outside dispatches');
    }
    setError(''); setLocalBusy(true);
    try {
      const fd = new FormData();
      if (signedPdf) fd.append('signedPdf', signedPdf);
      if (remarks.trim()) fd.append('remarks', remarks.trim());
      await api.post(`/gatepasses/${g.id}/logistics-dispatch`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onDispatched();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to dispatch');
    }
    setLocalBusy(false);
  };

  const assigned = !!g.assignedVehicleId;
  const working = busy || localBusy;

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-3">
      <p className="text-xs font-medium text-amber-800">
        {assigned ? 'Vehicle assigned — confirm dispatch' : 'Assign a vehicle from the register'}
      </p>

      {!assigned && (
        <>
          <Select label="Vehicle *" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
            <option value="">— Select a vehicle —</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.regNumber} · {v.vehicleType || 'Vehicle'} · {v.driverName || 'No driver'}
              </option>
            ))}
          </Select>
          <div className="flex justify-end">
            <Button disabled={working || !vehicleId} onClick={assign}>
              <Truck size={14} /> Assign Vehicle
            </Button>
          </div>
        </>
      )}

      {assigned && (
        <>
          <div className="text-sm text-gray-700">
            <span className="font-mono">{g.assignedVehicle?.regNumber}</span>
            {g.assignedVehicle?.driverName && <span className="text-gray-500"> · {g.assignedVehicle.driverName}</span>}
            {g.assignedVehicle?.driverPhone && <span className="text-gray-500"> · {g.assignedVehicle.driverPhone}</span>}
          </div>
          {g.kind === 'OUTSIDE' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Driver-signed delivery PDF *</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => setSignedPdf(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:text-gray-700 file:text-xs hover:file:bg-gray-100"
              />
            </div>
          )}
          <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
          <div className="flex justify-end">
            <Button disabled={working || (g.kind === 'OUTSIDE' && !signedPdf)} onClick={dispatch}>
              <Upload size={14} /> Confirm Dispatch
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SiteOfficeAckBox({ busy, onSubmit }) {
  const [reachedDate, setReachedDate] = useState('');
  const [remarks, setRemarks] = useState('');
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">Acknowledge arrival at the site office</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          type="date"
          label="Reached date *"
          value={reachedDate}
          onChange={e => setReachedDate(e.target.value)}
        />
      </div>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy || !reachedDate} onClick={() => onSubmit({ reachedDate, remarks: remarks.trim() || undefined })}>
          <CheckCircle2 size={14} /> Acknowledge Arrival
        </Button>
      </div>
    </div>
  );
}

function StoresAckBox({ g, busy, onSubmit }) {
  const [remarks, setRemarks] = useState('');
  const isReturnable = g.passType === 'RETURNABLE';
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">
        {isReturnable
          ? 'Confirm material has been returned to stores'
          : 'Confirm material has reached destination'}
      </p>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => onSubmit({ remarks: remarks.trim() || undefined })}>
          {isReturnable ? <><RotateCcw size={14} /> Acknowledge Return & Close</> : <><CheckCircle2 size={14} /> Acknowledge Arrival & Close</>}
        </Button>
      </div>
    </div>
  );
}

function ApprovalTrail({ g }) {
  const kind = g.kind;
  const stages = [];

  // Common: Raised by
  stages.push({ label: 'Raised', user: g.createdBy, at: g.createdAt, icon: Send });
  // Stores approval
  stages.push({ label: 'Stores Approval', user: g.storeIncharge, at: g.storeInchargeAt, icon: PackageCheck });
  // Accounts (OUTSIDE only)
  if (kind === 'OUTSIDE' || !kind) {
    stages.push({ label: kind === 'OUTSIDE' ? 'Accounts (Invoice)' : 'Accounts', user: g.accountsApprover, at: g.accountsAt, icon: Calculator });
  }
  // Stores Review (v2 only) — backend has no separate timestamp; show as complete
  // once status has moved past PENDING_STORE_REVIEW.
  if (kind) {
    const pastStoreReview = !['PENDING_STORE', 'PENDING_ACCOUNTS', 'PENDING_STORE_REVIEW'].includes(g.status);
    stages.push({ label: 'Stores Review', user: g.storeIncharge, at: pastStoreReview ? (g.logisticsAt || g.storeInchargeAt) : null, icon: ClipboardList });
    stages.push({ label: 'Logistics Dispatch', user: g.logisticsBy, at: g.dispatchedAt, icon: Truck });
    if (kind === 'OUTSIDE') {
      stages.push({ label: 'Site Office Ack', user: g.siteOfficeAckBy, at: g.siteOfficeAckAt, icon: Stamp });
    } else {
      stages.push({ label: 'Stores Ack', user: g.localReturnedBy, at: g.localReturnedAt || (g.status === 'CLOSED' ? g.approvedAt : null), icon: CheckCircle2 });
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {stages.map(({ label, user, at, icon: Icon }, idx) => (
        <div key={`${label}-${idx}`} className={`p-2 rounded border text-xs ${at ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-gray-700 font-medium">
            <Icon size={12} /> {label}
          </div>
          {at ? (
            <>
              <p className="text-gray-800 mt-0.5 truncate">{user?.name || '—'}</p>
              <p className="text-gray-500 truncate">{formatDateTime(at)}</p>
            </>
          ) : (
            <p className="text-gray-400 mt-0.5 flex items-center gap-1"><AlertCircle size={10} /> Pending</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, icon: Icon }) {
  return (
    <div>
      <p className="text-xs text-gray-500 flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </p>
      <p className="text-gray-800">{value || '—'}</p>
    </div>
  );
}
