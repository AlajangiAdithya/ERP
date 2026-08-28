import { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import api from '../../api/axios';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input, { Select } from '../ui/Input';
import { UOM_OPTIONS } from '../../utils/units';

// ─── Add a material to Master Data ───
// A purchase-request line may only name a material that already exists in Master
// Data, so the requisition form needs a way to put one there without losing the
// form. This is the same POST /products the Master Data screen uses — the entry
// is a real master-data record, stamped with whoever added it, and only they and
// the Unit 1–5 managers can change it afterwards.
//
// `initialName` pre-fills what the requester had already typed. `onCreated` gets
// the created product back so the caller can link the row straight away.
const FALLBACK_TYPES = [
  'Raw Material', 'Consumable', 'Hand Tools', 'Fasteners',
  'Tools & Fixtures', 'Machinery', 'Stationery', 'Others',
];

export default function AddMasterMaterialModal({ initialName = '', onClose, onCreated }) {
  const [form, setForm] = useState({
    materialCode: '',
    name: initialName || '',
    description: '',
    category: 'Raw Material',
    unit: 'pcs',
    shelfLife: '',
    storageTemp: '',
  });
  const [materialTypes, setMaterialTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products/material-types')
      .then(({ data }) => setMaterialTypes(Array.isArray(data) ? data : []))
      .catch(() => setMaterialTypes([]));
  }, []);

  const typeOptions = materialTypes.length ? materialTypes : FALLBACK_TYPES;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.materialCode.trim()) { setError('ID No. is required'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/products', {
        materialCode: form.materialCode.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        unit: form.unit,
        shelfLife: form.shelfLife.trim() || null,
        storageTemp: form.storageTemp.trim() || null,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add the material');
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Add material to Master Data" size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border-l-4 border-navy-500 bg-navy-50 p-3 text-sm text-navy-900">
          <Package size={18} className="mt-0.5 shrink-0 text-navy-700" />
          <div>
            <div className="font-semibold">A requisition can only ask for a material that is in Master Data.</div>
            <div className="mt-0.5 text-xs">
              Fill in what you know now — the entry is saved under your name, and you (or a
              Unit 1–5 manager) can complete the specification, spec PDFs and MSDS later from
              the Master Data screen.
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-brand-red">{error}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="ID No. *"
            value={form.materialCode}
            onChange={(e) => set({ materialCode: e.target.value })}
            placeholder="e.g. 1000"
          />
          <Input label="Name *" value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!initialName} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Material Type *" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {typeOptions.map((mt) => <option key={mt} value={mt}>{mt}</option>)}
          </Select>
          <Select label="Unit (UOM)" value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
            {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Specification</label>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-navy-700 focus:outline-none focus:ring-1 focus:ring-navy-700"
            rows={3}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Material specification details (grade, dimensions, standard…)"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Shelf Life"
            value={form.shelfLife}
            onChange={(e) => set({ shelfLife: e.target.value })}
            placeholder="e.g. 12 months from manufacture"
          />
          <Input
            label="Storage Temperature"
            value={form.storageTemp}
            onChange={(e) => set({ storageTemp: e.target.value })}
            placeholder="e.g. 2–8°C, store dry"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 pt-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add & use on this line'}</Button>
        </div>
      </form>
    </Modal>
  );
}
