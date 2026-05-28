import { useEffect, useState, useRef } from 'react';
import { Plus, Upload, FileText, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';

export default function Suppliers() {
  const { user } = useAuth();
  const canEdit = user?.role === 'PURCHASE_OFFICER' || user?.role === 'ADMIN';

  const [suppliers, setSuppliers] = useState([]);
  const [currentFY, setCurrentFY] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', contact: '', address: '', gstNumber: '', email: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [uploadingFor, setUploadingFor] = useState(null); // { supplier, kind }
  const [uploadError, setUploadError] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchSuppliers = () => {
    setLoading(true);
    const params = { page, limit: 25, search: search || undefined };
    api.get('/suppliers', { params })
      .then(({ data }) => {
        setSuppliers(data.suppliers);
        setTotalPages(data.totalPages || 1);
        setCurrentFY(data.currentFinancialYear || '');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSuppliers(); }, [page, search]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.post('/suppliers', form);
      setShowAdd(false);
      setForm({ name: '', contact: '', address: '', gstNumber: '', email: '', notes: '' });
      fetchSuppliers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create supplier');
    } finally {
      setSaving(false);
    }
  };

  const openUpload = (supplier, kind) => {
    setUploadingFor({ supplier, kind });
    setUploadFile(null);
    setUploadError('');
  };

  const submitUpload = async () => {
    if (!uploadFile) { setUploadError('Choose a PDF file first'); return; }
    if (uploadFile.type !== 'application/pdf') { setUploadError('Only PDF files are allowed'); return; }
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const endpoint = uploadingFor.kind === 'vendor-evaluation'
        ? `/suppliers/${uploadingFor.supplier.id}/vendor-evaluation`
        : `/suppliers/${uploadingFor.supplier.id}/supplier-assessment`;
      await api.post(endpoint, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setUploadingFor(null);
      setUploadFile(null);
      fetchSuppliers();
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Supplier', render: (v, row) => (
      <div className="flex flex-col">
        <span className="font-medium text-navy-700">{v}</span>
        {row.gstNumber && <span className="text-xs text-gray-500">GST: {row.gstNumber}</span>}
      </div>
    ) },
    { key: 'contact', label: 'Contact', render: (v) => v || '—' },
    { key: 'email', label: 'Email', render: (v) => v || '—' },
    {
      key: 'vendorEvaluationPdfUrl', label: 'Vendor Evaluation',
      render: (v, row) => (
        <div className="flex items-center gap-2">
          {row.hasVendorEvaluation ? (
            <>
              <Badge color="green"><CheckCircle2 size={12} className="inline mr-1" />On file</Badge>
              <a href={v} target="_blank" rel="noreferrer" className="text-xs text-navy-700 hover:underline">
                <FileText size={12} className="inline" /> View
              </a>
            </>
          ) : (
            <Badge color="red"><AlertCircle size={12} className="inline mr-1" />Missing</Badge>
          )}
          {canEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); openUpload(row, 'vendor-evaluation'); }}
              className="text-xs text-navy-700 hover:underline ml-auto"
            >
              <Upload size={12} className="inline" /> {row.hasVendorEvaluation ? 'Replace' : 'Upload'}
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'supplierAssessmentPdfUrl', label: `Assessment (FY ${currentFY})`,
      render: (v, row) => (
        <div className="flex items-center gap-2">
          {row.assessmentValidForCurrentFY ? (
            <>
              <Badge color="green"><CheckCircle2 size={12} className="inline mr-1" />Valid</Badge>
              <a href={v} target="_blank" rel="noreferrer" className="text-xs text-navy-700 hover:underline">
                <FileText size={12} className="inline" /> View
              </a>
            </>
          ) : v ? (
            <Badge color="amber">Expired (FY {row.assessmentFiscalYear})</Badge>
          ) : (
            <Badge color="red"><AlertCircle size={12} className="inline mr-1" />Missing</Badge>
          )}
          {canEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); openUpload(row, 'supplier-assessment'); }}
              className="text-xs text-navy-700 hover:underline ml-auto"
            >
              <Upload size={12} className="inline" /> {row.assessmentValidForCurrentFY ? 'Replace' : 'Upload'}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={22} /> Suppliers
          </h1>
          {currentFY && (
            <p className="text-xs text-gray-500 mt-0.5">
              Current financial year: <span className="font-semibold text-navy-700">FY {currentFY}</span>.
              Annual assessment must be re-uploaded at the start of each FY.
            </p>
          )}
        </div>
        {canEdit && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Supplier
          </Button>
        )}
      </div>

      <Card>
        <div className="mb-4">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search suppliers by name..." />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Table columns={columns} data={suppliers} emptyMessage="No suppliers yet" />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      {/* Add Supplier */}
      {canEdit && (
        <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Supplier" size="lg">
          <form onSubmit={handleCreate} className="space-y-3">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}
            <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
              <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="GST Number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
              <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
              After creating the supplier, upload the <strong>Vendor Evaluation PDF</strong> and the
              <strong> Supplier Assessment PDF (FY {currentFY})</strong> from the row actions. Quotations
              will be blocked until both are on file.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Supplier'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Upload PDF */}
      {uploadingFor && (
        <Modal
          isOpen={!!uploadingFor}
          onClose={() => { setUploadingFor(null); setUploadFile(null); setUploadError(''); }}
          title={`Upload ${uploadingFor.kind === 'vendor-evaluation' ? 'Vendor Evaluation' : `Supplier Assessment (FY ${currentFY})`}`}
          size="md"
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Supplier: <strong>{uploadingFor.supplier.name}</strong>
            </p>
            {uploadingFor.kind === 'vendor-evaluation' ? (
              <p className="text-xs text-gray-500">One-time form. Once uploaded it stays on file across financial years.</p>
            ) : (
              <p className="text-xs text-gray-500">Valid for the current Indian financial year (April–March) only. Must be re-uploaded each FY.</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-navy-700 file:text-white file:cursor-pointer"
            />
            {uploadError && <p className="text-sm text-brand-red">{uploadError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => { setUploadingFor(null); setUploadFile(null); setUploadError(''); }}>Cancel</Button>
              <Button type="button" disabled={uploading || !uploadFile} onClick={submitUpload}>
                {uploading ? 'Uploading...' : 'Upload PDF'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
