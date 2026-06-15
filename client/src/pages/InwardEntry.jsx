import { useState, useEffect, useMemo } from 'react';
import {
  Package, Plus, Truck, FlaskConical, ClipboardCheck, CheckCircle2,
  Search, Filter, X, Pencil, Trash2, ArrowDownToLine, Building2,
  Paperclip, Upload, Eye, FileText, FileSearch, ExternalLink, UserRound,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import PageHero from '../components/shared/PageHero';
import { formatDate } from '../utils/formatters';
import { checkFileSize } from '../utils/fileGuard';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import InwardInspectionReportPdf from '../components/pdf/InwardInspectionReportPdf';
import InwardInspectionRequestPdf from '../components/pdf/InwardInspectionRequestPdf';

// Uploaded docs are served from the API origin (strip the trailing /api).
const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '') || '';
const fileUrl = (u) => (u && u.startsWith('http') ? u : `${API_ORIGIN}${u || ''}`);

// PO terms & conditions annexure — a static client asset, the same one merged
// into PO PDFs. Surfaced to QC alongside the PO/PR/supplier reference docs.
const TNC_DOC = { label: 'PO Terms & Conditions Annexure', url: `${window.location.origin}/po-terms-and-conditions.pdf` };

// Reference documents QC views: server-supplied refDocs (PO/PR/supplier) plus
// the static T&C annexure (only when the row came from a PO).
const refDocsFor = (row) => {
  const list = Array.isArray(row.refDocs) ? [...row.refDocs] : [];
  if (row.poNumber) list.push(TNC_DOC);
  return list;
};

// Inward Inspection Request form (RAPS/IIR Rev 01) — numbered rows in 4 sections,
// matching the printed form. Stores reviews the auto-filled values and edits.
const IIR_REQUEST_SECTIONS = [
  { title: 'Purchase Requisition details', rows: [
    { key: 'prNoDate', no: '01', label: 'Purchase requisition no. & Date' },
    { key: 'materialDesc', no: '02', label: 'Material description and Specification' },
    { key: 'qtyAsPerPR', no: '03', label: 'Quantity as per PR' },
  ] },
  { title: 'Enquiry & Budgetary quote details', rows: [
    { key: 'supplierDetails', no: '04', label: 'Supplier details' },
    { key: 'budgetaryQuote', no: '05', label: 'Budgetary quote details' },
    { key: 'supplierAssessment', no: '06', label: 'Supplier Assessment form' },
  ] },
  { title: 'Purchase order details', rows: [
    { key: 'poNoDate', no: '07', label: 'Purchase order no. & date' },
    { key: 'qtyOrdered', no: '08', label: 'Quantity ordered' },
    { key: 'deliveryRequiredBy', no: '09', label: 'Delivery Required by' },
    { key: 'scopeOfWork', no: '10', label: 'Scope of Work as per PO' },
  ] },
  { title: 'Invoice & DC Details', rows: [
    { key: 'invoiceNoDate', no: '11', label: 'Invoice no. & date' },
    { key: 'dcNo', no: '12', label: 'DC no. if any' },
    { key: 'gatePassNo', no: '13', label: 'Gate pass no. (FIM/others)' },
    { key: 'gatePassType', no: '14', label: 'Gate pass type' },
    { key: 'probableReturnDate', no: '15', label: 'Probable date of Return' },
    { key: 'materialReceiptDate', no: '16', label: 'Material receipt date @RAPS, Store' },
  ] },
];

// Pre-fill the request form from the register row (every field stays editable).
const iirRequestDefaults = (row) => {
  const orderedQtyText = row.orderedQty != null ? `${fmtQty(row.orderedQty)} ${row.uom || ''}`.trim() : '';
  const hasAssessment = refDocsFor(row).some((d) => /assessment/i.test(d.label));
  const isInv = ['INVOICE', 'CASH_PURCHASE'].includes(row.docType);
  return {
    ionNoDate: '',
    prNoDate: row.prNumbers || '',
    materialDesc: row.itemDescription || '',
    qtyAsPerPR: '',
    supplierDetails: row.supplierName || '',
    budgetaryQuote: '',
    supplierAssessment: hasAssessment ? 'Attached (see reference documents)' : '',
    poNoDate: row.poNumber || '',
    qtyOrdered: orderedQtyText,
    deliveryRequiredBy: '',
    scopeOfWork: '',
    invoiceNoDate: isInv && row.docNumber ? `${row.docNumber} · ${formatDate(row.inwardDate)}` : '',
    dcNo: row.docType === 'DELIVERY_CHALLAN' ? (row.docNumber || '') : '',
    gatePassNo: row.docType === 'GATE_PASS' ? (row.docNumber || '') : '',
    gatePassType: '',
    probableReturnDate: '',
    materialReceiptDate: formatDate(row.inwardDate),
    storesRemark: '',
  };
};

// Stores owns the register; QC reviews each lot inline. Everyone else is read-only.
const WRITE_ROLES = ['ADMIN', 'STORE_MANAGER'];
const QC_ROLES = ['ADMIN', 'QC'];

const DOC_TYPES = [
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'CASH_PURCHASE', label: 'Cash Purchase' },
  { value: 'DELIVERY_CHALLAN', label: 'Delivery Challan' },
  { value: 'GATE_PASS', label: 'Gate Pass' },
];
const docLabel = (v) => DOC_TYPES.find((d) => d.value === v)?.label || v;

const STATUS_META = {
  DRAFT:        { label: 'Draft',        tone: 'gray' },
  QC_REQUESTED: { label: 'QC Requested', tone: 'amber' },
  QC_IN_REVIEW: { label: 'In Review',    tone: 'blue' },
  QC_DONE:      { label: 'QC Done',      tone: 'green' },
  INWARDED:     { label: 'Inwarded',     tone: 'green' },
};
const RESULT_TONE = { PASSED: 'green', PARTIAL: 'amber', FAILED: 'red' };

const STATUS_TABS = ['ALL', 'DRAFT', 'QC_REQUESTED', 'QC_IN_REVIEW', 'QC_DONE', 'INWARDED'];

const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export default function InwardEntry() {
  const { user } = useAuth();
  const role = user?.role;
  const canWrite = WRITE_ROLES.includes(role);
  const isQC = QC_ROLES.includes(role);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [requestFor, setRequestFor] = useState(null); // row -> request QC
  const [reviewFor, setReviewFor] = useState(null);    // row -> QC review
  const [inwardFor, setInwardFor] = useState(null);    // row -> final inward
  const [editFor, setEditFor] = useState(null);
  const [docsFor, setDocsFor] = useState(null);        // row -> manage / view documents
  const [reportFor, setReportFor] = useState(null);    // row -> view filled IIR report
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/material-inward', { params: { limit: 1000 } })
      .then(({ data }) => setRows(data.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const counts = useMemo(() => {
    const c = { ALL: rows.length };
    rows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'ALL' && r.status !== tab) return false;
      if (q) {
        const hay = [
          r.mirNo, r.docNumber, r.poNumber, r.prNumbers, r.itemDescription,
          r.supplierName, r.batchNo, r.issuedToLabel, ...(r.mivs || []).map((m) => m.mivNo),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, search]);

  // ── Per-row inline actions ──
  const act = async (id, fn) => {
    setBusyId(id);
    try { await fn(); load(); }
    catch (err) { alert(err.response?.data?.error || 'Action failed'); }
    finally { setBusyId(null); }
  };
  const takeReview = (row) => act(row.id, async () => {
    await api.post(`/material-inward/${row.id}/take-review`);
    setReviewFor({ ...row, status: 'QC_IN_REVIEW' });
  });
  const del = (row) => {
    if (!window.confirm(`Delete inward ${row.mirNo}? This cannot be undone.`)) return;
    act(row.id, () => api.delete(`/material-inward/${row.id}`));
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="Material Inward Register"
        subtitle="One register for every material received — PO or direct/cash. Request QC, review inline, then inward into stock."
        eyebrow="Stores"
        icon={Package}
        actions={canWrite && (
          <Button onClick={() => setShowNew(true)}>
            <Plus size={16} className="mr-1.5" /> New Inward
          </Button>
        )}
      />

      <Card className="p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search MIR, PO, PR, item, supplier, batch, MIV…"
              className="w-full pl-9 pr-9 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-500 focus:bg-white transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-navy-500">
            <Filter size={13} /> Showing <span className="font-bold text-navy-800">{filtered.length}</span> of {rows.length}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${on ? 'bg-navy-800 text-white shadow-sm' : 'bg-navy-50 text-navy-700 hover:bg-navy-100'}`}
              >
                {t === 'ALL' ? 'All' : STATUS_META[t]?.label || t}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${on ? 'bg-white/20 text-white' : 'bg-white text-navy-500'}`}>{counts[t] || 0}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {loading ? (
        <Card><p className="text-navy-500 text-center py-8">Loading…</p></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Package size={32} className="mx-auto text-navy-300 mb-3" />
            <p className="text-navy-700 font-semibold">No inward entries yet</p>
            <p className="text-navy-500 text-sm mt-1">{canWrite ? 'Click “New Inward” when material reaches the store.' : 'Entries will appear here once Stores records them.'}</p>
          </div>
        </Card>
      ) : (
        <InwardSheet
          rows={filtered}
          canWrite={canWrite}
          isQC={isQC}
          busyId={busyId}
          onRequestQc={setRequestFor}
          onTakeReview={takeReview}
          onContinueReview={setReviewFor}
          onInward={setInwardFor}
          onEdit={setEditFor}
          onDelete={del}
          onDocs={setDocsFor}
          onViewReport={setReportFor}
        />
      )}

      {showNew && (
        <NewInwardModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />
      )}
      {editFor && (
        <NewInwardModal editRow={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); load(); }} />
      )}
      {requestFor && (
        <RequestQcModal row={requestFor} onClose={() => setRequestFor(null)} onDone={() => { setRequestFor(null); load(); }} />
      )}
      {reviewFor && (
        <ReviewModal row={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); load(); }} />
      )}
      {inwardFor && (
        <InwardConfirmModal row={inwardFor} onClose={() => setInwardFor(null)} onDone={() => { setInwardFor(null); load(); }} />
      )}
      {docsFor && (
        <DocsModal row={docsFor} canWrite={canWrite} onClose={() => setDocsFor(null)} onChanged={load} />
      )}
      {reportFor && (
        <ReportViewModal row={reportFor} onClose={() => setReportFor(null)} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// The Excel-style register sheet (horizontal scroll, sticky header + MIR col)
// ────────────────────────────────────────────────────────────────────
function InwardSheet({ rows, canWrite, isQC, busyId, onRequestQc, onTakeReview, onContinueReview, onInward, onEdit, onDelete, onDocs, onViewReport }) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11.5px] border-separate border-spacing-0">
          <thead className="sticky top-0 z-20">
            <tr>
              <Th sticky>MIR No.</Th>
              <Th>Date</Th>
              <Th>Vehicle</Th>
              <Th>Document</Th>
              <Th>RAPS PO</Th>
              <Th>PR No.</Th>
              <Th>Item</Th>
              <Th>Qty Recd</Th>
              <Th>Supplier</Th>
              <Th>Purpose</Th>
              <Th>Batch No.</Th>
              <Th>Expiry</Th>
              <Th groupEnd>Issued To</Th>
              <Th>QC / Review</Th>
              <Th>MIV No.</Th>
              {(canWrite || isQC) && <Th>Action</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const meta = STATUS_META[r.status] || { label: r.status, tone: 'gray' };
              const zebra = i % 2 ? 'bg-brand-gray' : 'bg-white';
              const accent =
                r.status === 'INWARDED' ? 'border-l-green-500'
                : r.qcResult === 'FAILED' ? 'border-l-red-500'
                : r.status === 'QC_REQUESTED' ? 'border-l-amber-500'
                : r.status === 'QC_IN_REVIEW' ? 'border-l-blue-500'
                : 'border-l-navy-300';
              const busy = busyId === r.id;
              return (
                <tr key={r.id} className={`group ${zebra} hover:bg-navy-50 transition-colors`}>
                  <Td sticky className={`border-l-4 ${accent}`}>
                    <div className="font-mono text-[11px] font-semibold text-navy-800">{r.mirNo}</div>
                    <div className="mt-1 flex items-center gap-1">
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                      {r.lotNo != null && (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Lot {r.lotNo}</span>
                      )}
                    </div>
                  </Td>
                  <Td>{formatDate(r.inwardDate)}</Td>
                  <Td nowrap={false} className="max-w-[120px]">{r.vehicleDetails || <Dash />}</Td>
                  <Td nowrap={false} className="max-w-[150px]">
                    <div className="font-medium text-navy-700">{docLabel(r.docType)}</div>
                    <div className="text-[10px] text-gray-500">{r.docNumber || <Dash />}</div>
                    {r.documents?.length ? (
                      <button onClick={() => onDocs(r)} className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-navy-600 hover:text-navy-800">
                        <Paperclip size={10} /> {r.documents.length} file{r.documents.length > 1 ? 's' : ''}
                      </button>
                    ) : canWrite ? (
                      <button onClick={() => onDocs(r)} className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-navy-600">
                        <Paperclip size={10} /> add
                      </button>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-[10px] text-navy-700">{r.poNumber || <span className="text-gray-400">Direct</span>}</Td>
                  <Td nowrap={false} className="max-w-[140px] font-mono text-[10px] text-navy-700">{r.prNumbers || <Dash />}</Td>
                  <Td nowrap={false} className="min-w-[160px] max-w-[220px]">
                    <div className="text-navy-800 line-clamp-2" title={r.itemDescription || ''}>{r.itemDescription || <Dash />}</div>
                    {r.product && <div className="text-[10px] text-gray-400 mt-0.5">{r.product.materialCode || r.product.sku}</div>}
                  </Td>
                  <Td className="font-semibold text-navy-800">{r.qtyReceived != null ? `${fmtQty(r.qtyReceived)} ${r.uom || ''}` : <Dash />}</Td>
                  <Td nowrap={false} className="max-w-[150px]">{r.supplierName || <Dash />}</Td>
                  <Td nowrap={false} className="max-w-[150px]"><span className="text-gray-600 line-clamp-2" title={r.purpose || ''}>{r.purpose || <Dash />}</span></Td>
                  <Td className="font-mono text-[10px] text-amber-800">{r.batchNo || <Dash />}</Td>
                  <Td>{r.dateOfExpiry ? formatDate(r.dateOfExpiry) : <Dash />}</Td>
                  <Td groupEnd nowrap={false} className="max-w-[180px]">
                    {r.issuedToLabel ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-navy-100 text-navy-700">
                        <Building2 size={10} />{r.issuedToLabel}
                      </span>
                    ) : r.issuedToDept ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">{r.issuedToDept}</span>
                    ) : <Dash />}
                    {r.indenterName && !String(r.issuedToLabel || '').includes(r.indenterName) && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-gray-500" title={`Indenter: ${r.indenterName}`}>
                        <UserRound size={9} /> {r.indenterName}
                      </div>
                    )}
                  </Td>
                  {/* QC / Review */}
                  <Td nowrap={false} className="max-w-[200px]">
                    <Pill tone={r.status === 'QC_DONE' && r.qcResult ? RESULT_TONE[r.qcResult] : meta.tone}>
                      {r.status === 'QC_DONE' && r.qcResult ? `QC ${r.qcResult}` : meta.label}
                    </Pill>
                    {r.qcReportNo && <div className="text-[10px] text-gray-500 mt-0.5 font-mono">{r.qcReportNo}</div>}
                    {r.qtyAccepted != null && (
                      <div className="text-[10px] text-gray-500">Acc {fmtQty(r.qtyAccepted)}{r.qtyRejected ? ` · Rej ${fmtQty(r.qtyRejected)}` : ''}</div>
                    )}
                    {r.qcReportRemark && (
                      <div className="text-[10px] text-gray-600 mt-0.5 line-clamp-2" title={r.qcReportRemark}>“{r.qcReportRemark}”</div>
                    )}
                    {r.qcReviewer && <div className="text-[10px] text-gray-400 mt-0.5">by {r.qcReviewer.name}</div>}
                    {(r.status === 'QC_DONE' || r.status === 'INWARDED') && r.qcResult && (
                      <button onClick={() => onViewReport(r)} className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-navy-600 hover:text-navy-800">
                        <FileSearch size={11} /> View report
                      </button>
                    )}
                  </Td>
                  {/* MIV numbers (auto) */}
                  <Td nowrap={false} className="max-w-[160px]">
                    {r.mivs?.length ? (
                      <div className="space-y-0.5">
                        {r.mivs.map((m, k) => (
                          <div key={k} className="text-[10px] font-mono text-emerald-700" title={m.unit ? `${m.unit}${m.qty ? ` · ${m.qty}` : ''}` : ''}>
                            {m.mivNo}{m.qty != null ? <span className="text-gray-400"> ·{fmtQty(m.qty)}</span> : ''}
                          </div>
                        ))}
                      </div>
                    ) : <Dash />}
                  </Td>
                  {/* Action */}
                  {(canWrite || isQC) && (
                    <Td>
                      <div className="flex flex-col gap-1 items-start">
                        {canWrite && r.status === 'DRAFT' && (
                          <>
                            <ActBtn tone="amber" busy={busy} onClick={() => onRequestQc(r)}><FlaskConical size={11} /> Request QC</ActBtn>
                            <div className="flex gap-1">
                              <IconBtn title="Edit" onClick={() => onEdit(r)}><Pencil size={12} /></IconBtn>
                              <IconBtn title="Delete" danger onClick={() => onDelete(r)}><Trash2 size={12} /></IconBtn>
                            </div>
                          </>
                        )}
                        {isQC && r.status === 'QC_REQUESTED' && (
                          <ActBtn tone="blue" busy={busy} onClick={() => onTakeReview(r)}><ClipboardCheck size={11} /> Take Review</ActBtn>
                        )}
                        {isQC && r.status === 'QC_IN_REVIEW' && (
                          <ActBtn tone="blue" busy={busy} onClick={() => onContinueReview(r)}><ClipboardCheck size={11} /> Continue</ActBtn>
                        )}
                        {canWrite && r.status === 'QC_DONE' && r.qcResult !== 'FAILED' && (
                          <ActBtn tone="green" busy={busy} onClick={() => onInward(r)}><ArrowDownToLine size={11} /> Inward</ActBtn>
                        )}
                        {r.status === 'QC_DONE' && r.qcResult === 'FAILED' && <Pill tone="red">Rejected</Pill>}
                        {r.status === 'INWARDED' && <span className="inline-flex items-center gap-1 text-[10px] text-green-700 font-semibold"><CheckCircle2 size={12} /> Done</span>}
                      </div>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// New / Edit inward entry
// ────────────────────────────────────────────────────────────────────
function NewInwardModal({ editRow, onClose, onSaved }) {
  const isEdit = !!editRow;
  const [source, setSource] = useState(editRow ? (editRow.poNumber ? 'po' : 'direct') : 'po');
  const [pos, setPos] = useState([]);
  const [products, setProducts] = useState([]);
  const [poId, setPoId] = useState('');
  const [poItemId, setPoItemId] = useState('');
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    vehicleDetails: editRow?.vehicleDetails || '',
    docType: editRow?.docType || 'INVOICE',
    docNumber: editRow?.docNumber || '',
    itemDescription: editRow?.itemDescription || '',
    uom: editRow?.uom || '',
    supplierName: editRow?.supplierName || '',
    qtyReceived: editRow?.qtyReceived ?? '',
    batchNo: editRow?.batchNo || '',
    dateOfExpiry: editRow?.dateOfExpiry ? String(editRow.dateOfExpiry).slice(0, 10) : '',
    purpose: editRow?.purpose || '',
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (isEdit) return; // edit only touches scalar fields
    if (source === 'po') api.get('/material-inward/active-pos').then(({ data }) => setPos(data.orders || [])).catch(() => setPos([]));
    if (source === 'direct') api.get('/products', { params: { limit: 'all' } }).then(({ data }) => setProducts(data.products || [])).catch(() => setProducts([]));
  }, [source, isEdit]);

  const po = pos.find((p) => p.id === poId);
  const poItem = po?.items.find((it) => it.id === poItemId);
  useEffect(() => {
    if (poItem) {
      set('itemDescription', poItem.productName);
      set('uom', poItem.productUnit);
      const remaining = (poItem.quantity || 0) - (poItem.receivedQty || 0);
      if (f.qtyReceived === '') set('qtyReceived', remaining > 0 ? remaining : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poItemId]);

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.materialCode || '').toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(productSearch.toLowerCase()));
  const product = products.find((p) => p.id === productId);

  const submit = async () => {
    setError('');
    if (!isEdit && source === 'po' && (!poId || !poItemId)) return setError('Pick a PO and the material line.');
    if (!isEdit && source === 'direct' && !f.itemDescription.trim()) return setError('Item description is required.');
    if (!f.qtyReceived || Number(f.qtyReceived) <= 0) return setError('Enter the received quantity.');
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/material-inward/${editRow.id}`, {
          vehicleDetails: f.vehicleDetails, docType: f.docType, docNumber: f.docNumber,
          qtyReceived: f.qtyReceived, batchNo: f.batchNo, dateOfExpiry: f.dateOfExpiry || null,
          purpose: f.purpose,
          ...(editRow.poNumber ? {} : { itemDescription: f.itemDescription, uom: f.uom, productId: productId || editRow.productId || null }),
        });
      } else {
        const payload = {
          vehicleDetails: f.vehicleDetails, docType: f.docType, docNumber: f.docNumber,
          qtyReceived: f.qtyReceived, batchNo: f.batchNo, dateOfExpiry: f.dateOfExpiry || null,
          purpose: f.purpose,
        };
        if (source === 'po') {
          payload.purchaseOrderId = poId;
          payload.purchaseOrderItemId = poItemId;
        } else {
          payload.itemDescription = f.itemDescription;
          payload.uom = f.uom;
          payload.supplierName = f.supplierName;
          payload.productId = productId || null;
          payload.docType = f.docType === 'INVOICE' ? 'CASH_PURCHASE' : f.docType;
        }
        await api.post('/material-inward', payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? `Edit ${editRow.mirNo}` : 'New Inward Entry'} size="xl">
      <div className="space-y-4">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        {!isEdit && (
          <div className="inline-flex bg-navy-50 rounded-lg p-0.5">
            {['po', 'direct'].map((s) => (
              <button key={s} onClick={() => setSource(s)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${source === s ? 'bg-white shadow text-navy-800' : 'text-navy-600'}`}>
                {s === 'po' ? <><Truck size={13} className="inline mr-1" />From PO</> : <><Package size={13} className="inline mr-1" />Direct / Cash</>}
              </button>
            ))}
          </div>
        )}

        {/* Source selection */}
        {!isEdit && source === 'po' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="RAPS Purchase Order *" value={poId} onChange={(e) => { setPoId(e.target.value); setPoItemId(''); }}>
              <option value="">Select active PO…</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.orderNumber} — {p.supplierName} {p.isUnion ? '(UNION)' : ''}</option>)}
            </Select>
            <Select label="Material line *" value={poItemId} onChange={(e) => setPoItemId(e.target.value)} disabled={!po}>
              <option value="">{po ? 'Select item…' : 'Pick a PO first'}</option>
              {po?.items.map((it) => <option key={it.id} value={it.id}>{it.productName} — {it.quantity} {it.productUnit}</option>)}
            </Select>
            {po && (
              <div className="sm:col-span-2 text-[11px] bg-navy-50 border border-navy-100 rounded-md p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><span className="text-gray-500">Supplier:</span> {po.supplierName}</div>
                <div><span className="text-gray-500">PR:</span> {po.prNumbers || '—'}</div>
                <div><span className="text-gray-500">Issued to:</span> {po.issuedToLabel || po.issuedToDept || '—'}</div>
                <div><span className="text-gray-500">Indenter:</span> {po.indenterName || '—'}</div>
              </div>
            )}
          </div>
        )}
        {!isEdit && source === 'direct' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Item Description *" value={f.itemDescription} onChange={(e) => set('itemDescription', e.target.value)} />
              <Input label="UOM" value={f.uom} onChange={(e) => set('uom', e.target.value)} placeholder="pcs / kg / litre" />
              <Input label="Supplier / Customer" value={f.supplierName} onChange={(e) => set('supplierName', e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-navy-700 mb-1">Link product (for stock) — optional</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search product…"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-navy-500" />
              </div>
              {productSearch && (
                <div className="mt-1 max-h-36 overflow-y-auto border rounded-md">
                  {filteredProducts.slice(0, 30).map((p) => (
                    <div key={p.id} onClick={() => { setProductId(p.id); setProductSearch(''); }}
                      className="flex justify-between px-3 py-1.5 text-sm cursor-pointer hover:bg-navy-50 border-b border-gray-100 last:border-0">
                      <span>{p.name} <span className="text-xs text-gray-400">{p.materialCode || p.sku}</span></span>
                      <span className="text-xs text-gray-500">{p.currentStock} {p.unit}</span>
                    </div>
                  ))}
                </div>
              )}
              {product && <p className="mt-1 text-xs text-navy-700">Linked: <strong>{product.name}</strong> — stock will be added on inward.</p>}
              {!product && <p className="mt-1 text-[11px] text-gray-400">No product linked → recorded in the register only (no stock movement).</p>}
            </div>
          </div>
        )}

        {/* Common fields */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Vehicle details" value={f.vehicleDetails} onChange={(e) => set('vehicleDetails', e.target.value)} placeholder="e.g. AP 31 CD 1234" />
          <Select label="Document type" value={f.docType} onChange={(e) => set('docType', e.target.value)}>
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
          <Input label="Document number" value={f.docNumber} onChange={(e) => set('docNumber', e.target.value)} placeholder="Invoice / DC / GP no." />
          <Input label="Qty received *" type="number" min="0" step="any" value={f.qtyReceived} onChange={(e) => set('qtyReceived', e.target.value)} />
          <Input label="Batch number" value={f.batchNo} onChange={(e) => set('batchNo', e.target.value)} />
          <Input label="Expiry date" type="date" value={f.dateOfExpiry} onChange={(e) => set('dateOfExpiry', e.target.value)} />
        </div>
        <Textarea label="Purpose" rows={2} value={f.purpose} onChange={(e) => set('purpose', e.target.value)} />

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Update' : 'Create Entry')}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Documents (invoice / DC / test report / COA …) ──
// Stores uploads the supporting papers; QC and everyone else can view them.
function DocsModal({ row, canWrite, onClose, onChanged }) {
  const [docs, setDocs] = useState(Array.isArray(row.documents) ? row.documents : []);
  const [files, setFiles] = useState([]);
  const [label, setLabel] = useState('Invoice');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async () => {
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('documents', f));
      fd.append('label', label);
      const { data } = await api.post(`/material-inward/${row.id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDocs(Array.isArray(data.documents) ? data.documents : []);
      setFiles([]);
      onChanged?.();
    } catch (err) { setError(err.response?.data?.error || 'Upload failed'); }
    finally { setBusy(false); }
  };
  const remove = async (idx) => {
    if (!window.confirm('Remove this document?')) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.delete(`/material-inward/${row.id}/documents/${idx}`);
      setDocs(Array.isArray(data.documents) ? data.documents : []);
      onChanged?.();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Documents — ${row.mirNo}`} size="md">
      <div className="space-y-3">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
        <DocList docs={docs} canWrite={canWrite} onRemove={remove} />
        {canWrite && (
          <div className="border-t pt-3 space-y-2">
            <Select label="Document type" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option>Invoice</option>
              <option>Delivery Challan</option>
              <option>Material Report</option>
              <option>Test Report / COA / COC</option>
              <option>Gate Pass</option>
              <option>Other</option>
            </Select>
            <input
              type="file" multiple accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => {
                const list = Array.from(e.target.files || []).filter((f) => checkFileSize(f));
                setFiles(list);
              }}
              className="w-full text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-navy-700 file:text-white hover:file:bg-navy-800"
            />
            <div className="flex justify-end">
              <Button onClick={upload} disabled={busy || !files.length}><Upload size={14} className="mr-1" />{busy ? 'Uploading…' : `Upload ${files.length || ''}`}</Button>
            </div>
          </div>
        )}
        <div className="flex justify-end pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function DocList({ docs, canWrite, onRemove }) {
  if (!docs.length) return <p className="text-xs text-gray-400">No documents uploaded yet.</p>;
  return (
    <div className="space-y-1.5">
      {docs.map((d, i) => (
        <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-md">
          <a href={fileUrl(d.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-navy-700 hover:text-navy-900 min-w-0">
            <FileText size={13} className="flex-shrink-0" />
            <span className="font-semibold">{d.label}</span>
            <span className="text-gray-400 truncate">· {d.name}</span>
          </a>
          {canWrite && onRemove && (
            <button onClick={() => onRemove(i)} className="text-gray-400 hover:text-rose-600 flex-shrink-0" title="Remove"><Trash2 size={13} /></button>
          )}
        </div>
      ))}
    </div>
  );
}

// Reference documents (PO / PR / supplier assessment / T&C) — view-only links
// that open in a new tab. Surfaced to Stores on request + to QC on review.
function RefDocsList({ docs }) {
  if (!docs.length) return <p className="text-xs text-gray-400">No reference documents available.</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {docs.map((d, i) => (
        <a key={i} href={fileUrl(d.url)} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-2 py-1.5 bg-navy-50 border border-navy-100 rounded-md text-xs text-navy-700 hover:bg-navy-100 min-w-0">
          <ExternalLink size={13} className="flex-shrink-0" />
          <span className="truncate">{d.label}</span>
        </a>
      ))}
    </div>
  );
}

// Compact read-only label/value used in the auto-filled request/review headers.
function ReadKV({ label, value, span = false }) {
  return (
    <div className={span ? 'col-span-2 sm:col-span-4' : ''}>
      <span className="text-gray-500">{label}:</span> <span className="font-medium text-navy-800">{value || '—'}</span>
    </div>
  );
}

// ── Request QC — Stores reviews the auto-filled inspection request, ticks the
// receipt condition + enclosed documents, attaches the invoice, and sends it ──
const DOC_TYPE_CHECKS = ['Test Report', 'COC', 'COA', '3rd Party / Customer Clearance'];

function RequestQcModal({ row, onClose, onDone }) {
  const [form, setForm] = useState(() => ({ ...iirRequestDefaults(row), ...(row.qcRequest || {}) }));
  const [docRequirement, setDocRequirement] = useState(row.qcDocRequirement || '');
  const [invoice, setInvoice] = useState(null);
  const [reports, setReports] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const refDocs = refDocsFor(row);

  const submit = async () => {
    setSaving(true); setError('');
    try {
      // 1) Upload invoice + material reports so they ride along with the request.
      const files = [];
      const labels = [];
      if (invoice) { files.push(invoice); labels.push('Invoice'); }
      reports.forEach((f) => { files.push(f); labels.push('Material Report'); });
      if (files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append('documents', f));
        fd.append('labels', JSON.stringify(labels));
        await api.post(`/material-inward/${row.id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      // 2) Send the QC request with the inspection-request form snapshot.
      await api.post(`/material-inward/${row.id}/request-qc`, {
        qcDocRequirement: docRequirement,
        qcRequestNote: form.storesRemark || null,
        qcRequest: form,
      });
      onDone();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); setSaving(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title="Inward Inspection Request Form — RAPS/IIR Rev 01" size="xl">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-gray-500">
            {row.mirNo}{row.lotNo != null ? ` · Lot ${row.lotNo}` : ''} · auto-filled from the register — review & edit, then send to QA/QC.
          </p>
          <DownloadPdfButton document={<InwardInspectionRequestPdf row={row} form={form} />} fileName={`IIR-Request-${row.mirNo}.pdf`} label="View / Print form" />
        </div>

        <FormBlock title="Inspection ION No. & Date">
          <Input value={form.ionNoDate} onChange={(e) => set('ionNoDate', e.target.value)} placeholder="ION no. & date (if any)" />
        </FormBlock>

        {/* The 16 numbered rows, in the four printed-form sections */}
        {IIR_REQUEST_SECTIONS.map((sec) => (
          <FormBlock key={sec.title} title={sec.title}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sec.rows.map((r) => (
                <Input key={r.key} label={`${r.no}. ${r.label}`} value={form[r.key] || ''} onChange={(e) => set(r.key, e.target.value)} />
              ))}
            </div>
          </FormBlock>
        ))}

        {/* Reference docs QC will view (PO / PR / supplier assessment / T&C) */}
        {refDocs.length > 0 && (
          <FormBlock title="Reference documents (QC will view these)">
            <RefDocsList docs={refDocs} />
          </FormBlock>
        )}

        {/* Attach the invoice + any material reports */}
        <FormBlock title="Attachments">
          {row.documents?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-navy-600 mb-1">Already attached</p>
              <DocList docs={row.documents} />
            </div>
          )}
          <div>
            <label className="block text-[13px] font-semibold text-navy-700 mb-1">Invoice (PDF)</label>
            <input type="file" accept="application/pdf"
              onChange={(e) => { const f = e.target.files?.[0] || null; if (f && !checkFileSize(f)) { e.target.value = ''; return; } setInvoice(f); }}
              className="w-full text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-navy-700 file:text-white hover:file:bg-navy-800" />
            {invoice && <p className="text-[11px] text-gray-500 mt-1 truncate">{invoice.name}</p>}
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-navy-700 mb-1">Material reports (if any) — PDF / image</label>
            <input type="file" multiple accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setReports(Array.from(e.target.files || []).filter((f) => checkFileSize(f)))}
              className="w-full text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-navy-700 file:text-white hover:file:bg-navy-800" />
            {reports.length > 0 && <p className="text-[11px] text-gray-500 mt-1">{reports.length} file(s) selected</p>}
          </div>
        </FormBlock>

        {/* Instructions to QC + stores remark */}
        <FormBlock title="Instructions to QC">
          <Select label="Documents required (for QC to verify)" value={docRequirement} onChange={(e) => setDocRequirement(e.target.value)}>
            <option value="">— None / any —</option>
            <option value="COA">COA</option>
            <option value="COC">COC</option>
            <option value="Test Report">Test Report</option>
            <option value="3rd Party / Customer Clearance">3rd Party / Customer Clearance</option>
          </Select>
          <Textarea label="Remark / note to QC" rows={2} value={form.storesRemark} onChange={(e) => set('storesRemark', e.target.value)} placeholder="Anything QC should know before reviewing…" />
        </FormBlock>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Send to QC'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── QC review — the full IIR report, pre-filled from the PO/inward data.
// QC just reviews/adjusts, sets the result + remark, and finishes.
function ReviewModal({ row, onClose, onDone }) {
  const rep = row.qcReport || {};
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    reportDate: rep.reportDate ? String(rep.reportDate).slice(0, 10) : today,
    inspectionLocation: rep.inspectionLocation || 'At RAPS Inward Store',
    reportReferenceNo: rep.reportReferenceNo || row.docNumber || '',
    materialDescription: rep.materialDescription || row.itemDescription || '',
    materialCategory: rep.materialCategory || '',
    packingCondition: rep.packingCondition || 'Sealed',
    packingDamageNotes: rep.packingDamageNotes || '',
    dateOfManufacturing: rep.dateOfManufacturing ? String(rep.dateOfManufacturing).slice(0, 10) : '',
    tappedHolesCondition: rep.tappedHolesCondition || '',
    dimInspectionSupplier: rep.dimInspectionSupplier || false,
    dimInspectionRaps: rep.dimInspectionRaps || false,
    qtyAsPerPR: rep.qtyAsPerPR ?? row.orderedQty ?? '',
    qtyOrdered: rep.qtyOrdered ?? row.orderedQty ?? '',
    rejectionReason: rep.rejectionReason || '',
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [documentTypes, setDocumentTypes] = useState(
    Array.isArray(rep.documentTypes) && rep.documentTypes.length
      ? rep.documentTypes
      : (DOC_TYPE_CHECKS.includes(row.qcDocRequirement) ? [row.qcDocRequirement] : []),
  );
  const toggleDoc = (d) => setDocumentTypes((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));

  const [result, setResult] = useState(row.qcResult || 'PASSED');
  const [qtyAccepted, setQtyAccepted] = useState(row.qtyAccepted ?? row.qtyReceived ?? '');
  const [qtyRejected, setQtyRejected] = useState(row.qtyRejected ?? '');
  const [reportNo, setReportNo] = useState(row.qcReportNo || '');
  const [remark, setRemark] = useState(row.qcReportRemark || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!remark.trim()) return setError('A report remark is required.');
    setSaving(true);
    try {
      await api.post(`/material-inward/${row.id}/finish-review`, {
        qcResult: result, qtyAccepted, qtyRejected, qcReportNo: reportNo, qcReportRemark: remark,
        qcReport: { ...f, documentTypes },
      });
      onDone();
    } catch (err) { setError(err.response?.data?.error || 'Failed'); setSaving(false); }
  };

  const Read = ({ label, value }) => (
    <div><span className="text-gray-500">{label}:</span> <span className="font-medium text-navy-800">{value || '—'}</span></div>
  );

  return (
    <Modal isOpen onClose={onClose} title={`QC Inward Inspection Report — ${row.mirNo}`} size="full">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        {/* Auto-filled context (from PO / inward) + the docs Stores sent */}
        <div className="text-[11px] bg-navy-50 border border-navy-100 rounded-md p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Read label="PO" value={row.poNumber} />
          <Read label="PR" value={row.prNumbers} />
          <Read label="Supplier" value={row.supplierName} />
          <Read label="Issued to" value={row.issuedToLabel || row.issuedToDept} />
          <Read label="Indenter" value={row.indenterName} />
          <Read label="Received" value={`${fmtQty(row.qtyReceived)} ${row.uom || ''}`} />
          <Read label="Ordered" value={row.orderedQty != null ? fmtQty(row.orderedQty) : '—'} />
          <Read label="Batch" value={row.batchNo} />
          <Read label="Expiry" value={row.dateOfExpiry ? formatDate(row.dateOfExpiry) : '—'} />
        </div>
        {row.documents?.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-navy-600 mb-1">Documents from Stores (invoice / reports)</p>
            <DocList docs={row.documents} />
          </div>
        )}
        {refDocsFor(row).length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-navy-600 mb-1">Reference documents (PO / PR / supplier / T&amp;C)</p>
            <RefDocsList docs={refDocsFor(row)} />
          </div>
        )}
        {row.qcRequest && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-navy-600">Stores inspection request form:</span>
            <DownloadPdfButton document={<InwardInspectionRequestPdf row={row} />} fileName={`IIR-Request-${row.mirNo}.pdf`} label="View request form" />
          </div>
        )}
        {row.qcRequestNote && <p className="text-xs text-gray-600"><span className="text-gray-500">Stores note:</span> {row.qcRequestNote}</p>}
        {row.qcDocRequirement && <p className="text-xs text-gray-600"><span className="text-gray-500">Docs required:</span> {row.qcDocRequirement}</p>}

        {/* Report — pre-filled, editable */}
        <FormBlock title="Inspection report">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Report date" type="date" value={f.reportDate} onChange={(e) => set('reportDate', e.target.value)} />
            <Input label="Inspection location" value={f.inspectionLocation} onChange={(e) => set('inspectionLocation', e.target.value)} />
            <Input label="Report reference no." value={f.reportReferenceNo} onChange={(e) => set('reportReferenceNo', e.target.value)} />
            <Input label="Material description" value={f.materialDescription} onChange={(e) => set('materialDescription', e.target.value)} className="sm:col-span-2" />
            <Select label="Material category" value={f.materialCategory} onChange={(e) => set('materialCategory', e.target.value)}>
              <option value="">—</option>
              <option>Raw materials</option>
              <option>Consumables</option>
              <option>Tooling & Fixtures</option>
              <option>FIM</option>
            </Select>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-navy-700 mb-1">Documents verified</p>
            <div className="flex flex-wrap gap-3">
              {DOC_TYPE_CHECKS.map((d) => (
                <label key={d} className="inline-flex items-center gap-1.5 text-xs text-navy-700">
                  <input type="checkbox" checked={documentTypes.includes(d)} onChange={() => toggleDoc(d)} /> {d}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-navy-700 mb-1">Dimensional inspection</p>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-1.5 text-xs text-navy-700">
                <input type="checkbox" checked={!!f.dimInspectionSupplier} onChange={(e) => set('dimInspectionSupplier', e.target.checked)} /> At Supplier Place
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-navy-700">
                <input type="checkbox" checked={!!f.dimInspectionRaps} onChange={(e) => set('dimInspectionRaps', e.target.checked)} /> At RAPS inward
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label="Packing condition" value={f.packingCondition} onChange={(e) => set('packingCondition', e.target.value)}>
              <option>Sealed</option>
              <option>Broken</option>
            </Select>
            <Input label="Packing / damage notes" value={f.packingDamageNotes} onChange={(e) => set('packingDamageNotes', e.target.value)} className="sm:col-span-2" />
            <Input label="Date of manufacturing" type="date" value={f.dateOfManufacturing} onChange={(e) => set('dateOfManufacturing', e.target.value)} />
            <Input label="Tapped holes / weld lugs condition" value={f.tappedHolesCondition} onChange={(e) => set('tappedHolesCondition', e.target.value)} className="sm:col-span-2" />
          </div>
        </FormBlock>

        <FormBlock title="Quantity & result">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input label="Qty as per PR" type="number" min="0" step="any" value={f.qtyAsPerPR} onChange={(e) => set('qtyAsPerPR', e.target.value)} />
            <Input label="Qty ordered" type="number" min="0" step="any" value={f.qtyOrdered} onChange={(e) => set('qtyOrdered', e.target.value)} />
            <Input label="Qty accepted" type="number" min="0" step="any" value={qtyAccepted} onChange={(e) => setQtyAccepted(e.target.value)} />
            <Input label="Qty rejected" type="number" min="0" step="any" value={qtyRejected} onChange={(e) => setQtyRejected(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label="Result *" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="PASSED">Passed</option>
              <option value="PARTIAL">Partial</option>
              <option value="FAILED">Failed</option>
            </Select>
            <Input label="Report no. (auto if blank)" value={reportNo} onChange={(e) => setReportNo(e.target.value)} className="sm:col-span-2" />
          </div>
          {(result === 'FAILED' || result === 'PARTIAL') && (
            <Input label="Reason for rejection / non-conformity" value={f.rejectionReason} onChange={(e) => set('rejectionReason', e.target.value)} />
          )}
          <Textarea label="Report remark *" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Inspection findings / report details…" />
        </FormBlock>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Finishing…' : 'Finish Review'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function FormBlock({ title, children }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wider font-bold text-navy-600 border-b border-gray-100 pb-1">{title}</p>
      {children}
    </div>
  );
}

// ── Final inward confirm ──
function InwardConfirmModal({ row, onClose, onDone }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const qty = row.qtyAccepted != null ? row.qtyAccepted : row.qtyReceived;
  const submit = async () => {
    setSaving(true); setError('');
    try { await api.post(`/material-inward/${row.id}/inward`); onDone(); }
    catch (err) { setError(err.response?.data?.error || 'Failed'); setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Inward into stock — ${row.mirNo}`} size="md">
      <div className="space-y-3">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
        <div className="text-sm text-gray-700 space-y-1">
          <p><strong>{row.itemDescription}</strong></p>
          <p className="text-xs text-gray-500">
            Adding <strong className="text-navy-800">{fmtQty(qty)} {row.uom || ''}</strong> to stock
            {row.batchNo ? <> · Batch <span className="font-mono">{row.batchNo}</span></> : ''}
            {row.issuedToLabel ? <> · for {row.issuedToLabel}</> : ''}.
          </p>
          {!row.product && <p className="text-[11px] text-amber-600">No linked product — this will mark the row inwarded without a stock movement.</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Recording…' : 'Confirm Inward'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── View the filled inspection report (read-only, same format) ──
// Shows the IIR fields QC filled and offers a print-ready PDF that merges the
// reference PDFs (PO / supplier assessment / T&C / uploaded reports).
function ReportViewModal({ row, onClose }) {
  const rep = row.qcReport || {};
  const refDocs = refDocsFor(row);
  const pdfAttachments = [
    ...refDocs.map((d) => fileUrl(d.url)),
    ...((row.documents || []).map((d) => fileUrl(d.url))),
  ].filter((u) => /\.pdf(\?|$)/i.test(u));

  return (
    <Modal isOpen onClose={onClose} title={`Inward Inspection Report — ${row.mirNo}`} size="full">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-navy-800">{row.qcReportNo || row.mirNo}</p>
            <p className="text-[11px] text-gray-500">
              Result: <span className={`font-semibold ${row.qcResult === 'FAILED' ? 'text-rose-600' : row.qcResult === 'PARTIAL' ? 'text-amber-600' : 'text-emerald-600'}`}>{row.qcResult || '—'}</span>
              {row.qcReviewer ? ` · by ${row.qcReviewer.name}` : ''}{row.qcFinishedAt ? ` · ${formatDate(row.qcFinishedAt)}` : ''}
            </p>
          </div>
          <DownloadPdfButton
            document={<InwardInspectionReportPdf row={row} />}
            fileName={`IIR-${row.mirNo}.pdf`}
            label="View / Print PDF"
            appendPdfs={pdfAttachments}
          />
        </div>

        <FormBlock title="Identification">
          <div className="text-[11px] bg-navy-50 border border-navy-100 rounded-md p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ReadKV label="MIR No." value={row.mirNo} />
            <ReadKV label="Lot" value={row.lotNo != null ? `Lot ${row.lotNo}` : '—'} />
            <ReadKV label="Report No." value={row.qcReportNo} />
            <ReadKV label="Report date" value={rep.reportDate ? formatDate(rep.reportDate) : '—'} />
            <ReadKV label="PO" value={row.poNumber || 'Direct / Cash'} />
            <ReadKV label="PR" value={row.prNumbers} />
            <ReadKV label="Supplier" value={row.supplierName} />
            <ReadKV label="Issued to" value={row.issuedToLabel || row.issuedToDept} />
            <ReadKV label="Indenter" value={row.indenterName} />
            <ReadKV label="Inspection location" value={rep.inspectionLocation} />
            <ReadKV label="Ref. no." value={rep.reportReferenceNo} />
          </div>
        </FormBlock>

        <FormBlock title="Material & inspection">
          <div className="text-[11px] bg-gray-50 border border-gray-200 rounded-md p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ReadKV label="Description" value={rep.materialDescription || row.itemDescription} span />
            <ReadKV label="Category" value={rep.materialCategory} />
            <ReadKV label="Batch" value={row.batchNo} />
            <ReadKV label="Date of mfg." value={rep.dateOfManufacturing ? formatDate(rep.dateOfManufacturing) : '—'} />
            <ReadKV label="Expiry" value={row.dateOfExpiry ? formatDate(row.dateOfExpiry) : '—'} />
            <ReadKV label="Packing" value={rep.packingCondition} />
            <ReadKV label="Packing notes" value={rep.packingDamageNotes} />
            <ReadKV label="Tapped holes / weld lugs" value={rep.tappedHolesCondition} span />
            <ReadKV label="Documents verified" value={(rep.documentTypes || []).join(', ')} span />
          </div>
        </FormBlock>

        <FormBlock title="Quantity & result">
          <div className="text-[11px] bg-gray-50 border border-gray-200 rounded-md p-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <ReadKV label="As per PR" value={`${fmtQty(rep.qtyAsPerPR)} ${row.uom || ''}`} />
            <ReadKV label="Ordered" value={`${fmtQty(rep.qtyOrdered != null ? rep.qtyOrdered : row.orderedQty)} ${row.uom || ''}`} />
            <ReadKV label="Received" value={`${fmtQty(row.qtyReceived)} ${row.uom || ''}`} />
            <ReadKV label="Accepted" value={`${fmtQty(row.qtyAccepted)} ${row.uom || ''}`} />
            <ReadKV label="Rejected" value={`${fmtQty(row.qtyRejected)} ${row.uom || ''}`} />
          </div>
          {(row.qcResult === 'FAILED' || row.qcResult === 'PARTIAL') && rep.rejectionReason && (
            <p className="text-xs text-rose-700"><span className="text-gray-500">Reason for rejection:</span> {rep.rejectionReason}</p>
          )}
          {row.qcReportRemark && (
            <div>
              <p className="text-[13px] font-semibold text-navy-700 mb-1">Report remark</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap bg-white border border-gray-200 rounded-md p-2">{row.qcReportRemark}</p>
            </div>
          )}
        </FormBlock>

        {(row.documents?.length > 0 || refDocs.length > 0) && (
          <FormBlock title="Attached & reference documents">
            {row.documents?.length > 0 && <DocList docs={row.documents} />}
            {refDocs.length > 0 && <div className="mt-2"><RefDocsList docs={refDocs} /></div>}
          </FormBlock>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Sheet primitives ──
function Th({ children, sticky = false, groupEnd = false }) {
  return (
    <th className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-navy-500 bg-navy-50 border-b border-navy-100 whitespace-nowrap
      ${sticky ? 'sticky left-0 z-30 bg-navy-50' : ''} ${groupEnd ? 'border-r-2 border-navy-100' : ''}`}>
      {children}
    </th>
  );
}
function Td({ children, sticky = false, groupEnd = false, nowrap = true, className = '' }) {
  return (
    <td className={`px-3 py-2.5 align-top border-b border-gray-100 text-navy-700
      ${nowrap ? 'whitespace-nowrap' : ''} ${sticky ? 'sticky left-0 z-10 bg-inherit' : ''} ${groupEnd ? 'border-r-2 border-gray-100' : ''} ${className}`}>
      {children}
    </td>
  );
}
const Dash = () => <span className="text-gray-300 select-none">—</span>;

const PILL_TONES = {
  gray:  'bg-gray-100 text-gray-600 ring-gray-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue:  'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red:   'bg-rose-50 text-rose-700 ring-rose-200',
};
const Pill = ({ tone = 'gray', children }) => (
  <span className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ${PILL_TONES[tone]}`}>{children}</span>
);

const ACT_TONES = {
  amber: 'bg-amber-500 hover:bg-amber-600',
  blue:  'bg-blue-600 hover:bg-blue-700',
  green: 'bg-emerald-600 hover:bg-emerald-700',
};
const ActBtn = ({ tone = 'blue', busy, onClick, children }) => (
  <button onClick={onClick} disabled={busy}
    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-white transition disabled:opacity-50 ${ACT_TONES[tone]}`}>
    {children}
  </button>
);
const IconBtn = ({ title, danger, onClick, children }) => (
  <button title={title} onClick={onClick}
    className={`p-1.5 rounded-md transition ${danger ? 'text-gray-400 hover:text-rose-600 hover:bg-rose-100' : 'text-navy-600 hover:text-navy-800 hover:bg-navy-100'}`}>
    {children}
  </button>
);
