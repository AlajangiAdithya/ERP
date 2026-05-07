import { useState, useEffect } from 'react';
import { Plus, Trash2, RotateCcw, CheckCircle2, FileText, Truck, PackageCheck } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatDate, formatDateTime } from '../utils/formatters';
import GatePassPdf from '../components/pdf/GatePassPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

const PASS_TABS = [
  { key: 'RETURNABLE', label: 'Returnable', Icon: RotateCcw },
  { key: 'NON_RETURNABLE', label: 'Non-Returnable', Icon: Truck },
  { key: 'DELIVERY_CHALLAN', label: 'Delivery Challan', Icon: PackageCheck },
];

const statusColor = (s) => ({ OPEN: 'yellow', RETURNED: 'green', CLOSED: 'gray' }[s] || 'gray');
const statusLabel = (s) => ({ OPEN: 'Open', RETURNED: 'Returned', CLOSED: 'Closed' }[s] || s);

export default function GatePass() {
  const [activeTab, setActiveTab] = useState('RETURNABLE');
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/gatepasses', { params: { passType: activeTab, limit: 100, fromDate: fromDate || undefined, toDate: toDate || undefined } })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .catch(() => setGatePasses([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [activeTab, refreshKey, fromDate, toDate]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gate Pass</h1>
          <p className="text-sm text-gray-500">Track materials leaving the premises — returnable, non-returnable, and delivery challans.</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Create Gate Pass
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-2 border-b border-gray-200">
          {PASS_TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={16} className="inline mr-2" />{label}
            </button>
          ))}
        </div>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : gatePasses.length === 0 ? (
        <Card className="text-center text-gray-500 py-10">
          No {PASS_TABS.find(t => t.key === activeTab)?.label.toLowerCase()} gate passes yet.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-2 font-medium">Pass No.</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">{activeTab === 'RETURNABLE' ? 'Vendor' : 'Customer'}</th>
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Items</th>
                  {activeTab === 'RETURNABLE' && <th className="px-4 py-2 font-medium">Expected Return</th>}
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {gatePasses.map(g => (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-navy-700">{g.passNumber}</td>
                    <td className="px-4 py-2">{formatDate(g.date)}</td>
                    <td className="px-4 py-2">{g.partyName}</td>
                    <td className="px-4 py-2 text-gray-500">{g.vehicleNo || '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{g.items?.length || 0}</td>
                    {activeTab === 'RETURNABLE' && (
                      <td className="px-4 py-2 text-gray-500">{g.expectedReturnDate ? formatDate(g.expectedReturnDate) : '—'}</td>
                    )}
                    <td className="px-4 py-2"><Badge color={statusColor(g.status)}>{statusLabel(g.status)}</Badge></td>
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
          defaultType={activeTab}
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

function CreateGatePassModal({ defaultType, onClose, onCreated }) {
  const [form, setForm] = useState({
    passType: defaultType || 'RETURNABLE',
    partyName: '',
    partyContact: '',
    vehicleNo: '',
    invoiceNo: '',
    dcNo: '',
    requisitionNo: '',
    purpose: '',
    expectedReturnDate: '',
    issuedToName: '',
    issuedToDept: '',
    remarks: '',
  });
  const [items, setItems] = useState([{ description: '', quantity: 1, unit: 'pcs', remarks: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, { description: '', quantity: 1, unit: 'pcs', remarks: '' }]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (!form.partyName.trim()) return setError('Party (Vendor/Customer) name is required');
    if (items.some(i => !i.description.trim())) return setError('Each item needs a description');
    if (items.some(i => !i.quantity || Number(i.quantity) <= 0)) return setError('Each item needs a positive quantity');

    setSaving(true);
    try {
      await api.post('/gatepasses', {
        ...form,
        expectedReturnDate: form.expectedReturnDate || null,
        items: items.map(i => ({
          description: i.description.trim(),
          quantity: Number(i.quantity),
          unit: i.unit || 'pcs',
          remarks: i.remarks || null,
        })),
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create gate pass');
    }
    setSaving(false);
  };

  const isReturnable = form.passType === 'RETURNABLE';

  return (
    <Modal isOpen onClose={onClose} title="Create Gate Pass" size="full">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select label="Pass Type" value={form.passType} onChange={e => update('passType', e.target.value)}>
            <option value="RETURNABLE">Returnable</option>
            <option value="NON_RETURNABLE">Non-Returnable (FIM)</option>
            <option value="DELIVERY_CHALLAN">Delivery Challan</option>
          </Select>
          <Input
            label={isReturnable ? 'Vendor Name *' : 'Customer Name *'}
            value={form.partyName}
            onChange={e => update('partyName', e.target.value)}
            placeholder={isReturnable ? 'Vendor / supplier' : 'Customer name'}
          />
          <Input label="Contact" value={form.partyContact} onChange={e => update('partyContact', e.target.value)} placeholder="Phone / email" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Vehicle No." value={form.vehicleNo} onChange={e => update('vehicleNo', e.target.value)} />
          <Input label="Invoice No." value={form.invoiceNo} onChange={e => update('invoiceNo', e.target.value)} />
          <Input label="DC No." value={form.dcNo} onChange={e => update('dcNo', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Requisition No." value={form.requisitionNo} onChange={e => update('requisitionNo', e.target.value)} placeholder="FIM / Gate Pass Req No." />
          <Input label="Issued To (Name)" value={form.issuedToName} onChange={e => update('issuedToName', e.target.value)} />
          <Input label="Issued To (Dept)" value={form.issuedToDept} onChange={e => update('issuedToDept', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input label="Purpose" value={form.purpose} onChange={e => update('purpose', e.target.value)} placeholder="Calibration, testing, delivery…" />
          {isReturnable && (
            <Input type="date" label="Probable Return Date" value={form.expectedReturnDate} onChange={e => update('expectedReturnDate', e.target.value)} />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-gray-800">Items</h4>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add item</Button>
          </div>
          <div className="border border-gray-200 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-600 text-xs">
                  <th className="px-2 py-1.5 w-10">#</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5 w-24">Qty</th>
                  <th className="px-2 py-1.5 w-20">UOM</th>
                  <th className="px-2 py-1.5">Remarks</th>
                  <th className="px-2 py-1.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 text-gray-500">{idx + 1}</td>
                    <td className="px-2 py-1">
                      <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min="0" step="any" className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        value={it.unit} onChange={e => updateItem(idx, 'unit', e.target.value)} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        value={it.remarks} onChange={e => updateItem(idx, 'remarks', e.target.value)} />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 disabled:opacity-30"
                        disabled={items.length === 1}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Textarea label="Remarks" value={form.remarks} onChange={e => update('remarks', e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create Gate Pass'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ gatePass: initial, onClose, onAction }) {
  const [g, setG] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [returnedBy, setReturnedBy] = useState('');

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

  const isReturnable = g.passType === 'RETURNABLE';
  const canReturn = isReturnable && g.status === 'OPEN';
  const canClose = g.status !== 'CLOSED';

  return (
    <Modal isOpen onClose={onClose} title={`Gate Pass ${g.passNumber}`} size="xl">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center justify-between">
          <Badge color={statusColor(g.status)}>{statusLabel(g.status)}</Badge>
          <DownloadPdfButton
            document={<GatePassPdf data={g} />}
            fileName={`${g.passNumber}.pdf`}
            label="Download Gate Pass PDF"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="Date" value={formatDate(g.date)} />
          <Field label={isReturnable ? 'Vendor' : 'Customer'} value={g.partyName} />
          <Field label="Contact" value={g.partyContact} />
          <Field label="Vehicle No." value={g.vehicleNo} />
          <Field label="Invoice No." value={g.invoiceNo} />
          <Field label="DC No." value={g.dcNo} />
          <Field label="Requisition No." value={g.requisitionNo} />
          <Field label="Issued To" value={g.issuedToName} />
          <Field label="Department" value={g.issuedToDept} />
          <Field label="Purpose" value={g.purpose} />
          {isReturnable && <Field label="Expected Return" value={g.expectedReturnDate ? formatDate(g.expectedReturnDate) : '—'} />}
          {isReturnable && <Field label="Actual Return" value={g.actualReturnDate ? formatDate(g.actualReturnDate) : '—'} />}
          <Field label="Created By" value={g.createdBy?.name} />
          <Field label="Created At" value={formatDateTime(g.createdAt)} />
        </div>

        <div>
          <h4 className="font-medium text-gray-800 mb-2">Items</h4>
          <div className="border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-600 text-xs">
                  <th className="px-3 py-1.5">#</th>
                  <th className="px-3 py-1.5">Description</th>
                  <th className="px-3 py-1.5">Qty</th>
                  <th className="px-3 py-1.5">UOM</th>
                  <th className="px-3 py-1.5">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {(g.items || []).map((it, idx) => (
                  <tr key={it.id || idx} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{idx + 1}</td>
                    <td className="px-3 py-1.5">{it.description}</td>
                    <td className="px-3 py-1.5">{it.quantity}</td>
                    <td className="px-3 py-1.5">{it.unit}</td>
                    <td className="px-3 py-1.5 text-gray-500">{it.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {g.remarks && (
          <div>
            <h4 className="font-medium text-gray-800 mb-1">Remarks</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{g.remarks}</p>
          </div>
        )}

        {(canReturn || canClose) && (
          <div className="border-t border-gray-200 pt-4 space-y-3">
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
            {canClose && (
              <div className="flex justify-end">
                <Button variant="danger" disabled={busy}
                  onClick={() => act(`/gatepasses/${g.id}/close`)}>
                  <CheckCircle2 size={14} /> Close Gate Pass
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
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
