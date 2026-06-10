import { useState, useEffect, useCallback } from 'react';
import { BookOpen, ListChecks, Upload, Pencil, Trash2, FileText } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/shared/PageHero';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import { formatDate } from '../../utils/formatters';

// Shared SOP / Work Instruction library page. Everyone views; only Unit-5
// uploads/edits/deletes (server returns canManage and enforces it).

const META = {
  SOP: {
    icon: BookOpen,
    title: 'Standard Operating Procedures',
    eyebrow: 'QMS — SOP',
    subtitle: 'Controlled SOP copies. Uploaded and maintained by Unit-5; view-only for everyone else.',
    noun: 'SOP',
  },
  WORK_INSTRUCTION: {
    icon: ListChecks,
    title: 'Work Instructions',
    eyebrow: 'QMS — Work Instructions',
    subtitle: 'Station and process-level work instructions. Uploaded and maintained by Unit-5; view-only for everyone else.',
    noun: 'Work Instruction',
  },
};

const EMPTY_FORM = { title: '', docNo: '', revision: '', notes: '' };

function DocModal({ open, category, doc, onClose, onSaved }) {
  const meta = META[category];
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError('');
    setForm(doc ? {
      title: doc.title || '',
      docNo: doc.docNo || '',
      revision: doc.revision || '',
      notes: doc.notes || '',
    } : EMPTY_FORM);
  }, [open, doc]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('category', category);
      if (file) fd.append('file', file);
      if (doc) await api.put(`/kpi-qms/documents/${doc.id}`, fd);
      else await api.post('/kpi-qms/documents', fd);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={doc ? `Edit ${meta.noun}` : `Upload ${meta.noun}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Document No." value={form.docNo} onChange={(e) => setForm({ ...form, docNo: e.target.value })} placeholder="e.g. RAPS/SOP/01" />
          <Input label="Revision" value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} placeholder="e.g. Rev 02" />
        </div>
        <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div>
          <label className="block text-[13px] font-semibold text-navy-700 mb-1.5">
            Document File (PDF / image){doc?.fileUrl ? ' — replaces the current file' : ''}
          </label>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-navy-100 file:text-navy-700 file:text-sm file:font-medium hover:file:bg-navy-200 file:cursor-pointer"
          />
        </div>
        {error && <p className="text-sm font-medium text-brand-red">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function QmsDocuments({ category }) {
  const meta = META[category];
  const [docs, setDocs] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { doc: null | doc }

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/kpi-qms/documents', { params: { category } });
      setDocs(data.documents || []);
      setCanManage(!!data.canManage);
    } catch (err) {
      console.error('QMS documents load error:', err);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api.delete(`/kpi-qms/documents/${doc.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete document');
    }
  };

  return (
    <div className="space-y-5">
      <PageHero
        title={meta.title}
        eyebrow={meta.eyebrow}
        subtitle={meta.subtitle}
        icon={meta.icon}
        actions={canManage && (
          <Button onClick={() => setModal({ doc: null })}>
            <Upload size={16} className="mr-1" /> Upload {meta.noun}
          </Button>
        )}
      />

      <Card>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <meta.icon size={40} className="mx-auto mb-3 opacity-50" />
            <p className="text-gray-500">No {meta.noun.toLowerCase()}s uploaded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Title</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Doc No.</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Revision</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Uploaded</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">File</th>
                  {canManage && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={d.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-3 py-2 font-medium text-navy-700">
                      <span className="inline-flex items-center gap-1.5"><FileText size={14} className="text-navy-400" /> {d.title}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{d.docNo || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{d.revision || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDate(d.createdAt)}{d.uploadedBy?.name ? ` · ${d.uploadedBy.name}` : ''}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[220px] truncate" title={d.notes || ''}>{d.notes || '—'}</td>
                    <td className="px-3 py-2">
                      {d.fileUrl
                        ? <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-navy-700 hover:underline">View</a>
                        : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button type="button" title="Edit" className="text-gray-400 hover:text-navy-700" onClick={() => setModal({ doc: d })}><Pencil size={14} /></button>
                          <button type="button" title="Delete" className="text-gray-400 hover:text-red-600" onClick={() => remove(d)}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">Maintained by Unit-5{canManage ? ' (you can upload)' : ''} · visible to everyone.</p>
      </Card>

      <DocModal
        open={!!modal}
        category={category}
        doc={modal?.doc || null}
        onClose={() => setModal(null)}
        onSaved={() => { setModal(null); load(); }}
      />
    </div>
  );
}
