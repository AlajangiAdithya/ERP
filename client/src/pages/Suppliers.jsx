import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Plus, Upload, FileText, CheckCircle2, AlertCircle, Building2,
  ClipboardCheck, Pencil, Star, BarChart3,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';
import PageHero from '../components/shared/PageHero';
import { formatDate } from '../utils/formatters';

const MATERIAL_TYPE_OPTS = [
  { value: '', label: '—' },
  { value: 'MATERIAL', label: 'Material' },
  { value: 'JOB_WORK', label: 'Job Work' },
  { value: 'SERVICE', label: 'Service' },
];
const APPROVAL_STATUS_OPTS = [
  { value: '', label: '—' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'CONDITIONAL', label: 'Conditional' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'TERMINATED', label: 'Terminated' },
];
const approvalBadgeColor = (s) => ({
  APPROVED: 'green', CONDITIONAL: 'amber', REJECTED: 'red', TERMINATED: 'gray',
}[s] || 'gray');
const materialTypeLabel = (m) => ({ MATERIAL: 'Material', JOB_WORK: 'Job Work', SERVICE: 'Service' }[m] || '—');

// ISO date → YYYY-MM-DD for <input type="date">.
const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

const yesNoOpts = [
  { value: '', label: '—' },
  { value: 'true', label: 'YES' },
  { value: 'false', label: 'NO' },
];
const parseYesNo = (s) => (s === '' || s === undefined || s === null ? null : s === 'true');

export default function Suppliers() {
  const { user } = useAuth();
  const canEdit = user?.role === 'PURCHASE_OFFICER' || user?.role === 'ADMIN';

  const [suppliers, setSuppliers] = useState([]);
  const [currentFY, setCurrentFY] = useState('');
  const [selectedFY, setSelectedFY] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);

  const [reEvalFor, setReEvalFor] = useState(null);
  const [assessmentFor, setAssessmentFor] = useState(null);
  const [uploadingFor, setUploadingFor] = useState(null);
  const [showRatingModal, setShowRatingModal] = useState(false);

  const fetchSuppliers = () => {
    setLoading(true);
    const params = { page, limit: 25, search: search || undefined, fy: selectedFY || undefined };
    api.get('/suppliers', { params })
      .then(({ data }) => {
        setSuppliers(data.suppliers);
        setTotalPages(data.totalPages || 1);
        setCurrentFY(data.currentFinancialYear || '');
        if (!selectedFY) setSelectedFY(data.currentFinancialYear || '');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSuppliers(); /* eslint-disable-next-line */ }, [page, search, selectedFY]);

  // Build the FY dropdown from current FY + the last 4 — enough for review history.
  const fyOptions = useMemo(() => {
    if (!currentFY) return [];
    const [a] = currentFY.split('-').map(Number);
    const out = [];
    for (let i = 0; i < 5; i++) {
      const s = a - i;
      out.push(`${String(s).padStart(2, '0')}-${String(s + 1).padStart(2, '0')}`);
    }
    return out;
  }, [currentFY]);

  return (
    <div className="space-y-6">
      <PageHero
        title="Approved Suppliers"
        subtitle={currentFY
          ? `Approved Supplier List · Re-evaluation · Assessment · Performance Rating — current FY ${currentFY}.`
          : 'Approved Supplier List · Re-evaluation · Assessment · Performance Rating.'}
        eyebrow="Vendor Register"
        icon={Building2}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && (
              <>
                <Button variant="secondary" onClick={() => setShowRatingModal(true)}>
                  <BarChart3 size={16} /> Performance Rating
                </Button>
                <Button onClick={() => { setEditingSupplier(null); setShowSupplierModal(true); }}>
                  <Plus size={16} /> Add Supplier
                </Button>
              </>
            )}
            {!canEdit && (
              <Button variant="secondary" onClick={() => setShowRatingModal(true)}>
                <BarChart3 size={16} /> Performance Rating
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name, vendor ID, or scope..." />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Evaluation FY</label>
            <select
              value={selectedFY}
              onChange={(e) => setSelectedFY(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm border-gray-300 focus:outline-none focus:ring-2 focus:ring-navy-500"
            >
              {fyOptions.map((fy) => (
                <option key={fy} value={fy}>FY {fy}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ApprovedSupplierTable
            suppliers={suppliers}
            currentFY={selectedFY}
            canEdit={canEdit}
            onEditSupplier={(s) => { setEditingSupplier(s); setShowSupplierModal(true); }}
            onReEvaluate={(s) => setReEvalFor(s)}
            onAssess={(s) => setAssessmentFor(s)}
            onUpload={(s, kind) => setUploadingFor({ supplier: s, kind })}
          />
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      {showSupplierModal && (
        <SupplierFormModal
          supplier={editingSupplier}
          onClose={() => { setShowSupplierModal(false); setEditingSupplier(null); }}
          onSaved={() => { setShowSupplierModal(false); setEditingSupplier(null); fetchSuppliers(); }}
        />
      )}

      {reEvalFor && (
        <ReEvaluationModal
          supplier={reEvalFor}
          financialYear={selectedFY || currentFY}
          onClose={() => setReEvalFor(null)}
          onSaved={() => { setReEvalFor(null); fetchSuppliers(); }}
        />
      )}

      {assessmentFor && (
        <AssessmentFormModal
          supplier={assessmentFor}
          financialYear={selectedFY || currentFY}
          onClose={() => setAssessmentFor(null)}
          onSaved={() => { setAssessmentFor(null); fetchSuppliers(); }}
        />
      )}

      {uploadingFor && (
        <PdfUploadModal
          uploadingFor={uploadingFor}
          currentFY={currentFY}
          onClose={() => setUploadingFor(null)}
          onSaved={() => { setUploadingFor(null); fetchSuppliers(); }}
        />
      )}

      {showRatingModal && (
        <PerformanceRatingModal
          financialYear={selectedFY || currentFY}
          suppliers={suppliers}
          canEdit={canEdit}
          onClose={() => setShowRatingModal(false)}
          onSaved={() => { setShowRatingModal(false); fetchSuppliers(); }}
        />
      )}
    </div>
  );
}

// ─── Wide Approved Supplier List table ────────────────────────────────────
// Two-banner layout matching the client format: left = master register,
// right = evaluation details for the selected FY.
function ApprovedSupplierTable({ suppliers, currentFY, canEdit, onEditSupplier, onReEvaluate, onAssess, onUpload }) {
  if (!suppliers.length) {
    return <div className="text-center py-10 text-gray-400 text-sm">No suppliers yet.</div>;
  }
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-md">
      <table className="min-w-[1700px] text-xs">
        <thead>
          <tr>
            <th colSpan={10} className="bg-navy-700 text-white text-center font-semibold py-2 text-sm tracking-wider uppercase">
              Approved Supplier List
            </th>
            <th colSpan={5} className="bg-navy-800 text-white text-center font-semibold py-2 text-sm tracking-wider uppercase border-l border-navy-600">
              Evaluation Details (FY {currentFY})
            </th>
          </tr>
          <tr className="bg-gray-100 text-gray-700 text-[11px] uppercase tracking-wider">
            <th className="px-2 py-2 text-left font-semibold border-b">Vendor ID</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Supplier Name</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Address</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Contact Person + Phone</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Scope of Supply</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Material / Job / Service</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Approval Status</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Approval Date</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Type & Extent of Control</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Remarks</th>
            <th className="px-2 py-2 text-left font-semibold border-b border-l border-gray-300">Next Review Date</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Reviewed Date</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Performance Rating</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Remarks</th>
            <th className="px-2 py-2 text-left font-semibold border-b">Actions</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((s, i) => {
            const r = s.currentReEvaluation;
            const ratingValue = r?.performanceRating;
            const ratingBelow = ratingValue != null && ratingValue < 85;
            return (
              <tr key={s.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                <td className="px-2 py-2 border-b text-gray-700 font-mono">{s.vendorIdNo || '—'}</td>
                <td className="px-2 py-2 border-b">
                  <div className="font-medium text-navy-700">{s.name}</div>
                  {s.gstNumber && <div className="text-[10px] text-gray-500">GST: {s.gstNumber}</div>}
                  {(s.hasVendorEvaluation || s.assessmentValidForCurrentFY) && (
                    <div className="flex gap-1 mt-1">
                      {s.hasVendorEvaluation && (
                        <a href={s.vendorEvaluationPdfUrl} target="_blank" rel="noreferrer" className="text-[10px] text-navy-700 hover:underline">
                          <FileText size={10} className="inline" /> VE
                        </a>
                      )}
                      {s.assessmentValidForCurrentFY && (
                        <a href={s.supplierAssessmentPdfUrl} target="_blank" rel="noreferrer" className="text-[10px] text-navy-700 hover:underline">
                          <FileText size={10} className="inline" /> SA
                        </a>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 border-b text-gray-700 max-w-[180px]">{s.address || '—'}</td>
                <td className="px-2 py-2 border-b text-gray-700">
                  {s.contactPerson || s.contact || '—'}
                  {s.contactPhone && <div className="text-[10px] text-gray-500">{s.contactPhone}</div>}
                </td>
                <td className="px-2 py-2 border-b text-gray-700 max-w-[180px]">{s.scopeOfSupply || '—'}</td>
                <td className="px-2 py-2 border-b text-gray-700">{materialTypeLabel(s.materialType)}</td>
                <td className="px-2 py-2 border-b">
                  {s.approvalStatus
                    ? <Badge color={approvalBadgeColor(s.approvalStatus)}>{s.approvalStatus}</Badge>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-2 py-2 border-b text-gray-700">{formatDate(s.approvalDate)}</td>
                <td className="px-2 py-2 border-b text-gray-700 max-w-[180px]">{s.typeAndExtentOfControl || '—'}</td>
                <td className="px-2 py-2 border-b text-gray-700 max-w-[160px]">{s.remarks || '—'}</td>
                <td className="px-2 py-2 border-b text-gray-700 border-l border-gray-200">{formatDate(r?.nextReviewDate)}</td>
                <td className="px-2 py-2 border-b text-gray-700">{formatDate(r?.evaluationDate)}</td>
                <td className="px-2 py-2 border-b">
                  {ratingValue != null
                    ? <Badge color={ratingBelow ? 'red' : 'green'}>{ratingValue}%</Badge>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-2 py-2 border-b text-gray-700 max-w-[180px]">{r?.remarks || '—'}</td>
                <td className="px-2 py-2 border-b">
                  <div className="flex flex-col gap-1 min-w-[140px]">
                    {canEdit ? (
                      <>
                        <button onClick={() => onEditSupplier(s)} className="text-[11px] text-navy-700 hover:underline text-left">
                          <Pencil size={11} className="inline" /> Edit row
                        </button>
                        <button onClick={() => onReEvaluate(s)} className="text-[11px] text-navy-700 hover:underline text-left">
                          <Star size={11} className="inline" /> Re-evaluate
                        </button>
                        <button onClick={() => onAssess(s)} className="text-[11px] text-navy-700 hover:underline text-left">
                          <ClipboardCheck size={11} className="inline" /> Assessment form
                        </button>
                        <button onClick={() => onUpload(s, 'vendor-evaluation')} className="text-[11px] text-navy-700 hover:underline text-left">
                          <Upload size={11} className="inline" /> VE PDF
                        </button>
                        <button onClick={() => onUpload(s, 'supplier-assessment')} className="text-[11px] text-navy-700 hover:underline text-left">
                          <Upload size={11} className="inline" /> Assess. PDF
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-gray-400 italic">View only</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Add / edit supplier ───────────────────────────────────────────────
function SupplierFormModal({ supplier, onClose, onSaved }) {
  const isEdit = !!supplier;
  const [form, setForm] = useState({
    name: supplier?.name || '',
    contactPerson: supplier?.contactPerson || '',
    contactPhone: supplier?.contactPhone || '',
    address: supplier?.address || '',
    gstNumber: supplier?.gstNumber || '',
    email: supplier?.email || '',
    scopeOfSupply: supplier?.scopeOfSupply || '',
    materialType: supplier?.materialType || '',
    approvalStatus: supplier?.approvalStatus || '',
    approvalDate: toDateInput(supplier?.approvalDate),
    typeAndExtentOfControl: supplier?.typeAndExtentOfControl || '',
    remarks: supplier?.remarks || '',
    notes: supplier?.notes || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        ...form,
        materialType: form.materialType || null,
        approvalStatus: form.approvalStatus || null,
        approvalDate: form.approvalDate || null,
      };
      if (isEdit) await api.patch(`/suppliers/${supplier.id}`, body);
      else        await api.post('/suppliers', body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save supplier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? `Edit Supplier — ${supplier.vendorIdNo || ''}` : 'Add Supplier'} size="xl">
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-sm text-brand-red">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Supplier Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="GST Number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
        </div>
        <Textarea label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Contact Person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          <Input label="Phone Number" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
        </div>
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

        <Textarea label="Scope of Supply" value={form.scopeOfSupply} onChange={(e) => setForm({ ...form, scopeOfSupply: e.target.value })} rows={2} />

        <div className="grid grid-cols-3 gap-3">
          <Select label="Material / Job Work / Service" value={form.materialType} onChange={(e) => setForm({ ...form, materialType: e.target.value })}>
            {MATERIAL_TYPE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select label="Approval Status" value={form.approvalStatus} onChange={(e) => setForm({ ...form, approvalStatus: e.target.value })}>
            {APPROVAL_STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input label="Approval Date" type="date" value={form.approvalDate} onChange={(e) => setForm({ ...form, approvalDate: e.target.value })} />
        </div>

        <Textarea label="Type & Extent of Control" value={form.typeAndExtentOfControl} onChange={(e) => setForm({ ...form, typeAndExtentOfControl: e.target.value })} rows={2}
          placeholder="e.g. Quality inspection at supplier premises + incoming inspection at RAPS." />
        <Textarea label="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} />
        <Textarea label="Internal Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />

        {!isEdit && (
          <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
            Vendor ID is assigned automatically (format <strong>RAPS/SUP/####</strong>).
            After saving, capture the structured Assessment Form and the first Re-evaluation from the row actions.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : (isEdit ? 'Update Supplier' : 'Create Supplier')}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Re-evaluation form ────────────────────────────────────────────────
function ReEvaluationModal({ supplier, financialYear, onClose, onSaved }) {
  const existing = supplier.currentReEvaluation?.financialYear === financialYear ? supplier.currentReEvaluation : null;
  const [form, setForm] = useState({
    initialEvaluationDate:     toDateInput(existing?.initialEvaluationDate),
    initialEvaluationScope:    existing?.initialEvaluationScope || '',
    noOrders6Months:           existing?.noOrders6Months == null ? '' : String(existing.noOrders6Months),
    noOrdersReason:            existing?.noOrdersReason || '',
    managementChanged:         existing?.managementChanged == null ? '' : String(existing.managementChanged),
    newMgmtContinuingTerms:    existing?.newMgmtContinuingTerms == null ? '' : String(existing.newMgmtContinuingTerms),
    shiftedLocation:           existing?.shiftedLocation == null ? '' : String(existing.shiftedLocation),
    newAddress:                existing?.newAddress || '',
    performanceBelowPar:       existing?.performanceBelowPar == null ? '' : String(existing.performanceBelowPar),
    correctiveActionInitiated: existing?.correctiveActionInitiated || '',
    recommendedTermination:    existing?.recommendedTermination == null ? '' : String(existing.recommendedTermination),
    correctiveActionEffective: existing?.correctiveActionEffective == null ? '' : String(existing.correctiveActionEffective),
    noNonconformitiesReported: existing?.noNonconformitiesReported == null ? '' : String(existing.noNonconformitiesReported),
    newMachinesAdded:          existing?.newMachinesAdded == null ? '' : String(existing.newMachinesAdded),
    wishToContinueForNewParts: existing?.wishToContinueForNewParts == null ? '' : String(existing.wishToContinueForNewParts),
    isoCertified:              existing?.isoCertified == null ? '' : String(existing.isoCertified),
    overallDecision:           existing?.overallDecision || 'CONTINUES',
    evaluationDate:            toDateInput(existing?.evaluationDate || new Date().toISOString()),
    nextReviewDate:            toDateInput(existing?.nextReviewDate),
    performanceRating:         existing?.performanceRating ?? '',
    remarks:                   existing?.remarks || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        financialYear,
        initialEvaluationDate: form.initialEvaluationDate || null,
        initialEvaluationScope: form.initialEvaluationScope || null,
        noOrders6Months: parseYesNo(form.noOrders6Months),
        noOrdersReason: form.noOrdersReason || null,
        managementChanged: parseYesNo(form.managementChanged),
        newMgmtContinuingTerms: parseYesNo(form.newMgmtContinuingTerms),
        shiftedLocation: parseYesNo(form.shiftedLocation),
        newAddress: form.newAddress || null,
        performanceBelowPar: parseYesNo(form.performanceBelowPar),
        correctiveActionInitiated: form.correctiveActionInitiated || null,
        recommendedTermination: parseYesNo(form.recommendedTermination),
        correctiveActionEffective: parseYesNo(form.correctiveActionEffective),
        noNonconformitiesReported: parseYesNo(form.noNonconformitiesReported),
        newMachinesAdded: parseYesNo(form.newMachinesAdded),
        wishToContinueForNewParts: parseYesNo(form.wishToContinueForNewParts),
        isoCertified: parseYesNo(form.isoCertified),
        overallDecision: form.overallDecision,
        evaluationDate: form.evaluationDate || null,
        nextReviewDate: form.nextReviewDate || null,
        performanceRating: form.performanceRating === '' ? null : Number(form.performanceRating),
        remarks: form.remarks || null,
      };
      await api.post(`/suppliers/${supplier.id}/re-evaluations`, body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save re-evaluation');
    } finally {
      setSaving(false);
    }
  };

  const YN = ({ field, label }) => (
    <Select label={label} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })}>
      {yesNoOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );

  return (
    <Modal isOpen onClose={onClose} title={`Supplier Re-Evaluation — ${supplier.name} (FY ${financialYear})`} size="full">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-brand-red">{error}</p>}

        <section>
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Supplier Information</h3>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Initial Evaluation Date" type="date" value={form.initialEvaluationDate} onChange={(e) => setForm({ ...form, initialEvaluationDate: e.target.value })} />
            <Input label="Initial Scope (Product / Process / Service)" value={form.initialEvaluationScope} onChange={(e) => setForm({ ...form, initialEvaluationScope: e.target.value })} className="col-span-2" />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Re-evaluation Criteria</h3>
          <div className="grid grid-cols-2 gap-3">
            <YN field="noOrders6Months" label="No orders placed for 6 months or more?" />
            <Input label="If YES — reason" value={form.noOrdersReason} onChange={(e) => setForm({ ...form, noOrdersReason: e.target.value })} />

            <YN field="managementChanged" label="Supplier's management has changed?" />
            <YN field="newMgmtContinuingTerms" label="If YES — new mgmt continuing on earlier terms?" />

            <YN field="shiftedLocation" label="Supplier shifted to a new location?" />
            <Input label="If YES — new address" value={form.newAddress} onChange={(e) => setForm({ ...form, newAddress: e.target.value })} />

            <YN field="performanceBelowPar" label="Performance below par (< 85%)?" />
            <Input label="If YES — corrective action initiated" value={form.correctiveActionInitiated} onChange={(e) => setForm({ ...form, correctiveActionInitiated: e.target.value })} placeholder="Quality / delivery / service / docs" />

            <YN field="recommendedTermination" label="Recommended top mgmt to terminate?" />
            <YN field="correctiveActionEffective" label="Corrective action effective?" />

            <YN field="noNonconformitiesReported" label="No nonconformities reported on supplier?" />
            <YN field="newMachinesAdded" label="New machines / enhanced capability?" />

            <YN field="wishToContinueForNewParts" label="Wish to continue this supplier for new parts?" />
            <YN field="isoCertified" label="ISO 9001 / AS 9100D certified?" />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Decision & Schedule</h3>
          <div className="grid grid-cols-3 gap-3">
            <Select label="Overall Decision" value={form.overallDecision} onChange={(e) => setForm({ ...form, overallDecision: e.target.value })}>
              <option value="CONTINUES">Approved Source — Continues</option>
              <option value="TERMINATED">Terminated</option>
            </Select>
            <Input label="Evaluation Date" type="date" value={form.evaluationDate} onChange={(e) => setForm({ ...form, evaluationDate: e.target.value })} />
            <Input label="Next Review Date" type="date" value={form.nextReviewDate} onChange={(e) => setForm({ ...form, nextReviewDate: e.target.value })} />
            <Input label="Performance Rating after review (%)" type="number" step="0.01" min="0" max="100"
              value={form.performanceRating} onChange={(e) => setForm({ ...form, performanceRating: e.target.value })} />
            <Textarea label="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} className="col-span-2" />
          </div>
        </section>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Re-Evaluation'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Structured assessment form ────────────────────────────────────────
function AssessmentFormModal({ supplier, financialYear, onClose, onSaved }) {
  const [form, setForm] = useState({
    companyName: supplier.name || '',
    companyAddress: supplier.address || '',
    businessType: '',
    businessRole: '',
    productsRange: '',
    machineryAndEquipment: '',
    majorCustomers: '',
    transportFacilities: '',
    deliveryPeriod: '',
    allowsCapabilityVerify: '',
    hasQualityControlSystem: '',
    isoCertified: '',
    isoCertificateUrl: '',
    testCertWithDelivery: '',
    readyToUpgradePerformance: '',
    reviewComments: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        financialYear,
        companyName: form.companyName || null,
        companyAddress: form.companyAddress || null,
        businessType: form.businessType || null,
        businessRole: form.businessRole || null,
        productsRange: form.productsRange || null,
        machineryAndEquipment: form.machineryAndEquipment || null,
        majorCustomers: form.majorCustomers || null,
        transportFacilities: form.transportFacilities || null,
        deliveryPeriod: form.deliveryPeriod || null,
        allowsCapabilityVerify: parseYesNo(form.allowsCapabilityVerify),
        hasQualityControlSystem: parseYesNo(form.hasQualityControlSystem),
        isoCertified: parseYesNo(form.isoCertified),
        isoCertificateUrl: form.isoCertificateUrl || null,
        testCertWithDelivery: parseYesNo(form.testCertWithDelivery),
        readyToUpgradePerformance: parseYesNo(form.readyToUpgradePerformance),
        reviewComments: form.reviewComments || null,
      };
      await api.post(`/suppliers/${supplier.id}/assessment-forms`, body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save assessment form');
    } finally {
      setSaving(false);
    }
  };

  const YN = ({ field, label }) => (
    <Select label={label} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })}>
      {yesNoOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );

  return (
    <Modal isOpen onClose={onClose} title={`Supplier Assessment Form — ${supplier.name} (FY ${financialYear})`} size="full">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-brand-red">{error}</p>}

        <section>
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Company</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Company Name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            <Textarea label="Address" value={form.companyAddress} onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} rows={2} />
            <Select label="Type of Business" value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })}>
              <option value="">—</option>
              <option value="PROPRIETORSHIP">Proprietorship</option>
              <option value="PARTNERSHIP">Partnership</option>
              <option value="PRIVATE_LTD">Private Ltd.</option>
              <option value="PUBLIC_LTD">Public Ltd.</option>
            </Select>
            <Select label="Business Role" value={form.businessRole} onChange={(e) => setForm({ ...form, businessRole: e.target.value })}>
              <option value="">—</option>
              <option value="MANUFACTURER">Manufacturer</option>
              <option value="SUPPLIER">Supplier</option>
              <option value="DEALER">Dealer</option>
            </Select>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Capability</h3>
          <div className="grid grid-cols-2 gap-3">
            <Textarea label="Range of products manufactured / supplied" value={form.productsRange} onChange={(e) => setForm({ ...form, productsRange: e.target.value })} rows={2} />
            <Textarea label="List of machinery & equipment" value={form.machineryAndEquipment} onChange={(e) => setForm({ ...form, machineryAndEquipment: e.target.value })} rows={2} />
            <Textarea label="Major customers" value={form.majorCustomers} onChange={(e) => setForm({ ...form, majorCustomers: e.target.value })} rows={2} />
            <Textarea label="Transport facilities" value={form.transportFacilities} onChange={(e) => setForm({ ...form, transportFacilities: e.target.value })} rows={2} />
            <Input label="Delivery period" value={form.deliveryPeriod} onChange={(e) => setForm({ ...form, deliveryPeriod: e.target.value })} />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-navy-700 mb-2">Quality &amp; Compliance</h3>
          <div className="grid grid-cols-2 gap-3">
            <YN field="allowsCapabilityVerify" label="Will allow verification of capability at supplier premises?" />
            <YN field="hasQualityControlSystem" label="Existing QC / QA system demonstrable?" />
            <YN field="isoCertified" label="ISO 9001 certified?" />
            <Input label="ISO certificate URL (optional)" value={form.isoCertificateUrl} onChange={(e) => setForm({ ...form, isoCertificateUrl: e.target.value })} />
            <YN field="testCertWithDelivery" label="Provides test certificate with delivery docs?" />
            <YN field="readyToUpgradePerformance" label="Ready to upgrade performance as required?" />
          </div>
        </section>

        <Textarea label="Review Comments (RAPS use only)" value={form.reviewComments} onChange={(e) => setForm({ ...form, reviewComments: e.target.value })} rows={3} />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Assessment Form'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── PDF upload (vendor evaluation / annual assessment) ───────────────
function PdfUploadModal({ uploadingFor, currentFY, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const submit = async () => {
    if (!file) { setError('Choose a PDF file first'); return; }
    if (file.type !== 'application/pdf') { setError('Only PDF files are allowed'); return; }
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const endpoint = uploadingFor.kind === 'vendor-evaluation'
        ? `/suppliers/${uploadingFor.supplier.id}/vendor-evaluation`
        : `/suppliers/${uploadingFor.supplier.id}/supplier-assessment`;
      await api.post(endpoint, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Upload ${uploadingFor.kind === 'vendor-evaluation' ? 'Vendor Evaluation PDF' : `Supplier Assessment PDF (FY ${currentFY})`}`}
      size="md"
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-700">Supplier: <strong>{uploadingFor.supplier.name}</strong></p>
        {uploadingFor.kind === 'vendor-evaluation' ? (
          <p className="text-xs text-gray-500">One-time form. Once uploaded it stays on file across financial years.</p>
        ) : (
          <p className="text-xs text-gray-500">Valid for the current Indian financial year (April–March) only. Must be re-uploaded each FY.</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-navy-700 file:text-white file:cursor-pointer"
        />
        {error && <p className="text-sm text-brand-red">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={uploading || !file} onClick={submit}>
            {uploading ? 'Uploading...' : 'Upload PDF'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Performance Rating sheet (FY-bucketed scorecard) ─────────────────
function PerformanceRatingModal({ financialYear, suppliers, canEdit, onClose, onSaved }) {
  const [rating, setRating] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [preparedDate, setPreparedDate] = useState(toDateInput(new Date().toISOString()));
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState([]);

  useEffect(() => {
    setLoading(true);
    api.get(`/suppliers/performance-ratings/by-fy/${financialYear}`)
      .then(({ data }) => {
        setRating(data);
        setPeriodFrom(toDateInput(data.periodFrom));
        setPeriodTo(toDateInput(data.periodTo));
        setPreparedDate(toDateInput(data.preparedDate || new Date().toISOString()));
        setRemarks(data.remarks || '');
        setItems(data.items || []);
      })
      .catch(() => { setRating(null); setItems([]); })
      .finally(() => setLoading(false));
  }, [financialYear]);

  const blankItem = () => ({
    supplierId: '', itemDescription: '', supplierName: '',
    suppliesReceived: 0, qtyAccepted: 0, qualityRating: 0,
    totalDeliveries: 0, deliveriesOnTime: 0, deliveriesLate: 0, deliveryRating: 0,
  });

  const updateItem = (idx, patch) => {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const onSupplierChange = (idx, supplierId) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    updateItem(idx, {
      supplierId: supplierId || '',
      supplierName: supplier ? supplier.name : '',
    });
  };

  const overall = useMemo(() => {
    if (!items.length) return 0;
    const sum = items.reduce((acc, it) => acc + (Number(it.qualityRating || 0) + Number(it.deliveryRating || 0)), 0);
    return Number((sum / items.length).toFixed(2));
  }, [items]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = {
        financialYear,
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
        preparedDate: preparedDate || null,
        minimumCriteria: 85,
        remarks: remarks || null,
        items: items.map((it) => ({
          supplierId: it.supplierId || null,
          itemDescription: it.itemDescription,
          supplierName: it.supplierName,
          suppliesReceived: Number(it.suppliesReceived) || 0,
          qtyAccepted: Number(it.qtyAccepted) || 0,
          qualityRating: Number(it.qualityRating) || 0,
          totalDeliveries: Number(it.totalDeliveries) || 0,
          deliveriesOnTime: Number(it.deliveriesOnTime) || 0,
          deliveriesLate: Number(it.deliveriesLate) || 0,
          deliveryRating: Number(it.deliveryRating) || 0,
        })),
      };
      await api.post('/suppliers/performance-ratings', body);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save performance rating');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal isOpen onClose={onClose} title={`Supplier Performance Rating — FY ${financialYear}`} size="full">
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title={`Supplier Performance Rating — FY ${financialYear}`} size="full">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-brand-red">{error}</p>}

        <div className="grid grid-cols-4 gap-3">
          <Input label="Period From" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} disabled={!canEdit} />
          <Input label="Period To"   type="date" value={periodTo}   onChange={(e) => setPeriodTo(e.target.value)}   disabled={!canEdit} />
          <Input label="Prepared Date" type="date" value={preparedDate} onChange={(e) => setPreparedDate(e.target.value)} disabled={!canEdit} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Overall Rating (computed)</label>
            <div className={`px-3 py-2 border rounded-md text-sm font-semibold ${overall >= 85 ? 'bg-green-50 text-green-700 border-green-300' : 'bg-amber-50 text-amber-700 border-amber-300'}`}>
              {overall}% &nbsp; <span className="text-[10px] font-normal text-gray-500">(min criteria 85%)</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="min-w-[1300px] text-xs">
            <thead className="bg-gray-100 text-gray-700 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-2 py-2 text-left">Item Description</th>
                <th className="px-2 py-2 text-left">Supplier</th>
                <th className="px-2 py-2 text-right">Supplies Recd</th>
                <th className="px-2 py-2 text-right">Qty Accepted</th>
                <th className="px-2 py-2 text-right">Quality (60)</th>
                <th className="px-2 py-2 text-right">Total Deliveries</th>
                <th className="px-2 py-2 text-right">On Time</th>
                <th className="px-2 py-2 text-right">Late</th>
                <th className="px-2 py-2 text-right">Delivery (40)</th>
                <th className="px-2 py-2 text-right">Total (100)</th>
                {canEdit && <th className="px-2 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={11} className="text-center text-gray-400 py-6">No item rows yet.</td></tr>
              )}
              {items.map((it, idx) => {
                const total = (Number(it.qualityRating) || 0) + (Number(it.deliveryRating) || 0);
                const rowBelow = total < 85;
                return (
                  <tr key={idx} className={`border-t border-gray-100 ${rowBelow ? 'bg-red-50/30' : ''}`}>
                    <td className="px-2 py-1">
                      <input className="w-full px-2 py-1 border rounded text-xs" value={it.itemDescription}
                        onChange={(e) => updateItem(idx, { itemDescription: e.target.value })} disabled={!canEdit} />
                    </td>
                    <td className="px-2 py-1">
                      <select className="w-full px-2 py-1 border rounded text-xs" value={it.supplierId || ''}
                        onChange={(e) => onSupplierChange(idx, e.target.value)} disabled={!canEdit}>
                        <option value="">— External / unlinked —</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {!it.supplierId && (
                        <input className="mt-1 w-full px-2 py-1 border rounded text-xs" placeholder="Supplier name"
                          value={it.supplierName} onChange={(e) => updateItem(idx, { supplierName: e.target.value })} disabled={!canEdit} />
                      )}
                    </td>
                    {[
                      ['suppliesReceived'], ['qtyAccepted'], ['qualityRating', 60],
                      ['totalDeliveries'], ['deliveriesOnTime'], ['deliveriesLate'], ['deliveryRating', 40],
                    ].map(([k, max]) => (
                      <td key={k} className="px-2 py-1">
                        <input type="number" min="0" max={max || undefined} step={k.includes('Rating') ? '0.01' : '1'}
                          className="w-20 px-2 py-1 border rounded text-xs text-right"
                          value={it[k]} onChange={(e) => updateItem(idx, { [k]: e.target.value })} disabled={!canEdit} />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold">
                      <Badge color={rowBelow ? 'red' : 'green'}>{total.toFixed(2)}</Badge>
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        <button type="button" className="text-xs text-red-600 hover:underline"
                          onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <Button variant="secondary" type="button" onClick={() => setItems((arr) => [...arr, blankItem()])}>
            <Plus size={14} /> Add item row
          </Button>
        )}

        <Textarea label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2}
          disabled={!canEdit}
          placeholder='Minimum criteria 85%. Delivery rating: 2-day delay cut 2 pts, 1-week delay cut 4 pts, beyond 1 week cut 6 pts.' />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
          {canEdit && <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Performance Rating'}</Button>}
        </div>
      </form>
    </Modal>
  );
}
