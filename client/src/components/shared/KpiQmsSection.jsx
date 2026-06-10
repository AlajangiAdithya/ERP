import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Truck, Target, ClipboardCheck, Award, FileText, Upload, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input, { Select } from '../ui/Input';
import StatsCard from './StatsCard';
import { formatDate } from '../../utils/formatters';

// KPI-QMS panel — rendered on every role's dashboard. All figures are
// auto-computed server-side; the only writable piece is the certifications
// list, gated to Unit-5 (server returns canManageCertifications).

const TH = 'px-3 py-2 text-left text-xs font-medium text-gray-500';
const THR = 'px-3 py-2 text-right text-xs font-medium text-gray-500';
const rowCls = (i) => `border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`;

const fmtNum = (v) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
};

const EMPTY_CERT_FORM = { title: '', certificateNo: '', issuedBy: '', validFrom: '', validTill: '', notes: '' };
const dateInputValue = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function CertificationModal({ open, cert, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_CERT_FORM);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError('');
    setForm(cert ? {
      title: cert.title || '',
      certificateNo: cert.certificateNo || '',
      issuedBy: cert.issuedBy || '',
      validFrom: dateInputValue(cert.validFrom),
      validTill: dateInputValue(cert.validTill),
      notes: cert.notes || '',
    } : EMPTY_CERT_FORM);
  }, [open, cert]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('file', file);
      if (cert) await api.put(`/kpi-qms/certifications/${cert.id}`, fd);
      else await api.post('/kpi-qms/certifications', fd);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save certification');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={cert ? 'Edit Certification' : 'Add Certification'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Certification Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. ISO 9001:2015" required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Certificate No." value={form.certificateNo} onChange={(e) => setForm({ ...form, certificateNo: e.target.value })} />
          <Input label="Issued By" value={form.issuedBy} onChange={(e) => setForm({ ...form, issuedBy: e.target.value })} placeholder="Certification body" />
          <Input label="Valid From" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
          <Input label="Valid Till" type="date" value={form.validTill} onChange={(e) => setForm({ ...form, validTill: e.target.value })} />
        </div>
        <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <div>
          <label className="block text-[13px] font-semibold text-navy-700 mb-1.5">
            Certificate File (PDF / image){cert?.fileUrl ? ' — replaces the current file' : ''}
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
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : cert ? 'Save Changes' : 'Add Certification'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function KpiQmsSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fy, setFy] = useState('');
  const [certModal, setCertModal] = useState(null); // null | { cert: null | cert }

  const load = useCallback(async (selectedFy) => {
    try {
      const { data } = await api.get('/kpi-qms', { params: selectedFy ? { fy: selectedFy } : {} });
      setData(data);
      setFy(data.fy);
    } catch (err) {
      console.error('KPI-QMS load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteCert = async (cert) => {
    if (!window.confirm(`Delete certification "${cert.title}"?`)) return;
    try {
      await api.delete(`/kpi-qms/certifications/${cert.id}`);
      load(fy);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete certification');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  const { marketing, supplierPerformance, qcRejections, certifications, canManageCertifications } = data;
  const onTime = marketing.onTimeDelivery;
  const tvo = marketing.tenderVsOrder;
  const now = new Date();

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h2 className="text-lg font-bold text-navy-800 tracking-tight flex items-center gap-2">
            <BarChart3 size={18} className="text-navy-600" /> KPI — QMS
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Quality Management System indicators · auto-generated from system records · view-only</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-navy-700">Financial Year</span>
          <Select value={fy} onChange={(e) => { setFy(e.target.value); load(e.target.value); }} className="w-28">
            {(data.availableFys || [data.fy]).map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </div>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="On-Time Deliveries"
          value={onTime.onTimePercent != null ? `${onTime.onTimePercent}%` : '—'}
          subtitle={onTime.completedCount > 0 ? `${onTime.onTimeCount} of ${onTime.completedCount} completed WOs on time` : 'No completed work orders this FY'}
          icon={Truck}
          color={onTime.onTimePercent == null ? 'navy' : onTime.onTimePercent >= 85 ? 'green' : 'red'}
        />
        <StatsCard
          title="Tender vs Order"
          value={`${tvo.orders} / ${tvo.tenders}`}
          subtitle={tvo.conversionPercent != null ? `${tvo.conversionPercent}% converted to confirmed orders` : 'No supply orders logged this FY'}
          icon={Target}
          color="blue"
        />
        <StatsCard
          title="Suppliers Below 85%"
          value={supplierPerformance.belowCriteriaCount}
          subtitle={`of ${supplierPerformance.suppliers.length} rated supplier${supplierPerformance.suppliers.length === 1 ? '' : 's'} (min. criteria ${supplierPerformance.minimumCriteria}%)`}
          icon={Award}
          color={supplierPerformance.belowCriteriaCount > 0 ? 'red' : 'green'}
        />
        <StatsCard
          title="QC Rejection Rate"
          value={qcRejections.rejectionRatePercent != null ? `${qcRejections.rejectionRatePercent}%` : '—'}
          subtitle={`${qcRejections.rejectionCount} rejection${qcRejections.rejectionCount === 1 ? '' : 's'} across ${qcRejections.gradedInspections} graded inspections`}
          icon={ClipboardCheck}
          color={qcRejections.rejectionCount > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Marketing */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Target size={15} className="text-navy-600" /> Marketing — Tender vs Order &amp; Delivery
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-navy-100 p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tender vs Order</p>
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-gray-600">Supply orders logged</dt><dd className="font-semibold text-navy-800">{tvo.tenders}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">Confirmed orders</dt><dd className="font-semibold text-green-700">{tvo.orders}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">Pending acceptance</dt><dd className="font-semibold text-yellow-700">{tvo.pending}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">Declined / cancelled</dt><dd className="font-semibold text-red-600">{tvo.declined}</dd></div>
              </dl>
            </div>
            <div className="rounded-xl border border-navy-100 p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">On-Time Deliveries</p>
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-gray-600">Completed WOs</dt><dd className="font-semibold text-navy-800">{onTime.completedCount}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">Delivered on time</dt><dd className="font-semibold text-green-700">{onTime.onTimeCount}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">Delivered late</dt><dd className="font-semibold text-red-600">{onTime.lateCount}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">On-time %</dt><dd className="font-semibold text-navy-800">{onTime.onTimePercent != null ? `${onTime.onTimePercent}%` : '—'}</dd></div>
              </dl>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">On-time = delivered on/before the effective PDC (latest extension counts). Auto-computed from the Work Order register.</p>
        </Card>

        {/* Certifications */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <FileText size={15} className="text-navy-600" /> Certifications
            </h3>
            {canManageCertifications && (
              <Button size="sm" onClick={() => setCertModal({ cert: null })}>
                <Upload size={14} className="mr-1" /> Upload
              </Button>
            )}
          </div>
          {certifications.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <FileText size={36} className="mx-auto mb-2 opacity-50" />
              <p className="text-gray-500 text-sm">No certifications uploaded yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {certifications.map((c) => {
                const expired = c.validTill && new Date(c.validTill) < now;
                return (
                  <li key={c.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-navy-800 flex items-center gap-2 flex-wrap">
                        {c.title}
                        {expired ? <Badge color="red">Expired</Badge> : c.validTill ? <Badge color="green">Valid</Badge> : null}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {[c.certificateNo, c.issuedBy].filter(Boolean).join(' · ') || '—'}
                        {(c.validFrom || c.validTill) && (
                          <> · {c.validFrom ? formatDate(c.validFrom) : '…'} → {c.validTill ? formatDate(c.validTill) : '…'}</>
                        )}
                      </p>
                      {c.notes && <p className="text-xs text-gray-400 mt-0.5">{c.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {c.fileUrl && (
                        <a href={c.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-navy-700 hover:underline">View</a>
                      )}
                      {canManageCertifications && (
                        <>
                          <button type="button" title="Edit" className="text-gray-400 hover:text-navy-700" onClick={() => setCertModal({ cert: c })}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" title="Delete" className="text-gray-400 hover:text-red-600" onClick={() => deleteCert(c)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-gray-400 mt-3">Maintained by Unit-5{canManageCertifications ? ' (you can upload)' : ''} · visible to everyone.</p>
        </Card>
      </div>

      {/* Supplier performance */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Award size={15} className="text-navy-600" /> Purchase — Supplier Performance Rating ({data.fy})
          </h3>
          <span className="text-xs text-gray-500">Minimum criteria: <span className="font-semibold text-navy-800">{supplierPerformance.minimumCriteria}%</span></span>
        </div>
        {supplierPerformance.suppliers.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Award size={36} className="mx-auto mb-2 opacity-50" />
            <p className="text-gray-500 text-sm">No supplier deliveries recorded this FY</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={TH}>Supplier</th>
                  <th className={THR}>Supplies Recd</th>
                  <th className={THR}>Qty Recd</th>
                  <th className={THR}>Qty Accepted</th>
                  <th className={THR}>Quality (60)</th>
                  <th className={THR}>Deliveries</th>
                  <th className={THR}>On Time</th>
                  <th className={THR}>Late</th>
                  <th className={THR}>Delivery (40)</th>
                  <th className={THR}>Total (100)</th>
                </tr>
              </thead>
              <tbody>
                {supplierPerformance.suppliers.map((s, i) => {
                  const below = s.totalRating != null && s.totalRating < supplierPerformance.minimumCriteria;
                  return (
                    <tr key={s.supplierId || s.supplierName} className={rowCls(i)}>
                      <td className="px-3 py-2 font-medium text-navy-700">
                        <span className="inline-flex items-center gap-1.5">
                          {below && <AlertTriangle size={13} className="text-brand-red" />}
                          {s.supplierName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600">{s.suppliesReceived}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{fmtNum(s.qtyReceived)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{fmtNum(s.qtyAccepted)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmtNum(s.qualityRating)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{s.totalDeliveries}</td>
                      <td className="px-3 py-2 text-right text-green-700">{s.deliveriesOnTime}</td>
                      <td className="px-3 py-2 text-right text-red-600">{s.deliveriesLate}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmtNum(s.deliveryRating)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${below ? 'text-brand-red' : 'text-green-700'}`}>{fmtNum(s.totalRating)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">
          Per form 04 — Supplier Performance Rating: Quality (60) = qty accepted ÷ qty received × 60 · Delivery (40) = on-time deliveries ÷ total deliveries × 40 · auto-computed from QC inward inspections.
        </p>
      </Card>

      {/* QC rejections */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <ClipboardCheck size={15} className="text-navy-600" /> Product Rejections by QC ({data.fy})
        </h3>
        {qcRejections.rows.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <ClipboardCheck size={36} className="mx-auto mb-2 opacity-50" />
            <p className="text-gray-500 text-sm">No QC rejections recorded this FY</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={TH}>Inspection #</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Material</th>
                  <th className={TH}>Supplier</th>
                  <th className={THR}>Qty Recd</th>
                  <th className={THR}>Qty Rejected</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Result</th>
                </tr>
              </thead>
              <tbody>
                {qcRejections.rows.map((r, i) => (
                  <tr key={r.id} className={rowCls(i)}>
                    <td className="px-3 py-2 font-medium text-navy-700 whitespace-nowrap">{r.inspectionNumber}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[220px] truncate" title={r.materialDescription || ''}>{r.materialDescription || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.supplierName || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{fmtNum(r.qtyReceived)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-brand-red">{fmtNum(r.qtyRejected)}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[240px] truncate" title={r.rejectionReason || ''}>{r.rejectionReason || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge color={r.result === 'FAILED' ? 'red' : r.result === 'PARTIAL' ? 'yellow' : 'gray'}>{r.result}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CertificationModal
        open={!!certModal}
        cert={certModal?.cert || null}
        onClose={() => setCertModal(null)}
        onSaved={() => { setCertModal(null); load(fy); }}
      />
    </div>
  );
}
