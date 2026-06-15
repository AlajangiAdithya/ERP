import { useState, useEffect, useMemo } from 'react';
import {
  Package, Plus, Truck, FlaskConical, ClipboardCheck, CheckCircle2,
  Search, Filter, X, Pencil, Trash2, ArrowDownToLine, Building2,
  Paperclip, Upload, Eye, FileText, FileSearch, ExternalLink, UserRound,
  Send, FileInput,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
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
  ON_HOLD:      { label: 'On Hold',      tone: 'red' },
  INWARDED:     { label: 'Inwarded',     tone: 'green' },
};
const RESULT_TONE = { PASSED: 'green', PARTIAL: 'amber', FAILED: 'red', ON_HOLD: 'red' };

const STATUS_TABS = ['ALL', 'DRAFT', 'QC_REQUESTED', 'QC_IN_REVIEW', 'QC_DONE', 'ON_HOLD', 'INWARDED'];

const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

// Mirror of the server's per-unit split (proportional to allocated qty; the last
// unit absorbs the rounding remainder). Used only to preview where stock lands.
function splitPreview(allocs, qty) {
  const list = Array.isArray(allocs) ? allocs.filter((a) => a && a.unitId) : [];
  const total = list.reduce((s, a) => s + (a.allocatedQty || 0), 0);
  const round3 = (n) => Math.round(n * 1000) / 1000;
  let assigned = 0;
  return list.map((a, i) => {
    let q;
    if (i === list.length - 1) {
      q = round3((qty || 0) - assigned);
    } else {
      q = total > 0 ? round3((qty || 0) * ((a.allocatedQty || 0) / total)) : round3((qty || 0) / list.length);
      assigned += q;
    }
    return { unitId: a.unitId, unitName: a.unitName, unitCode: a.unitCode, qty: q };
  });
}

// Two ways material comes inward: the PO/direct register (left tab) and
// customer-supplied Free Issue Material recorded via inward gate passes (FIM tab).
const MAIN_TABS = [
  { key: 'register', label: 'Inward Material Register', Icon: Package },
  { key: 'fim',      label: 'Inward FIM / Customer Property', Icon: FileInput },
];

export default function InwardEntry() {
  const { user } = useAuth();
  const role = user?.role;
  const canWrite = WRITE_ROLES.includes(role);
  const [mainTab, setMainTab] = useState('register');

  return (
    <div className="space-y-6">
      <PageHero
        title="Material Inward"
        subtitle="Receive materials into stores — the inward register for PO / direct purchases, or customer-supplied Free Issue Material (FIM) via inward gate passes."
        eyebrow="Stores"
        icon={Package}
      />

      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {MAIN_TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              mainTab === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={16} className="inline mr-2" />{label}
          </button>
        ))}
      </div>

      {mainTab === 'register'
        ? <MaterialInwardRegister />
        : <FromGatePassMode canEdit={canWrite} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Inward Material Register — PO & direct/cash receipts (request QC, review,
// then inward into stock).
// ────────────────────────────────────────────────────────────────────
function MaterialInwardRegister() {
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
  const [resendFor, setResendFor] = useState(null);    // row -> resend held/failed lot to QC
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
          {canWrite && (
            <Button onClick={() => setShowNew(true)}>
              <Plus size={16} className="mr-1.5" /> New Inward
            </Button>
          )}
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
          onResend={setResendFor}
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
      {resendFor && (
        <ResendQcModal row={resendFor} onClose={() => setResendFor(null)} onDone={() => { setResendFor(null); load(); }} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// The Excel-style register sheet (horizontal scroll, sticky header + MIR col)
// ────────────────────────────────────────────────────────────────────
function InwardSheet({ rows, canWrite, isQC, busyId, onRequestQc, onTakeReview, onContinueReview, onInward, onEdit, onDelete, onDocs, onViewReport, onResend }) {
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
                : r.status === 'ON_HOLD' ? 'border-l-red-500'
                : r.qcResult === 'FAILED' ? 'border-l-red-500'
                : r.status === 'QC_REQUESTED' ? 'border-l-amber-500'
                : r.status === 'QC_IN_REVIEW' ? 'border-l-blue-500'
                : 'border-l-navy-300';
              const busy = busyId === r.id;
              return (
                <tr key={r.id} className={`group ${zebra} hover:bg-navy-50 transition-colors`}>
                  <Td sticky className={`border-l-4 ${accent}`}>
                    <div className="font-mono text-[11px] font-semibold text-navy-800">{r.mirNo}</div>
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                      {r.lotNo != null && (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Lot {r.lotNo}</span>
                      )}
                      {r.qcRound > 1 && (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700" title="Re-inspection round">Re-insp {r.qcRound}</span>
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
                    {r.qcReportNo && <div className="text-[10px] text-gray-500 mt-0.5 font-mono" title="Inward Inspection No.">{r.qcReportNo}</div>}
                    {r.qtyAccepted != null && (
                      <div className="text-[10px] text-gray-500">Acc {fmtQty(r.qtyAccepted)}{r.qtyRejected ? ` · Rej ${fmtQty(r.qtyRejected)}` : ''}</div>
                    )}
                    {r.status === 'ON_HOLD' && r.qtyHeld != null && (
                      <div className="text-[10px] text-rose-600">Held {fmtQty(r.qtyHeld)}{r.uom ? ` ${r.uom}` : ''}</div>
                    )}
                    {r.status === 'ON_HOLD' && r.holdReason && (
                      <div className="text-[10px] text-rose-700 mt-0.5 line-clamp-2" title={r.holdReason}>⚠ {r.holdReason}</div>
                    )}
                    {r.qcReportRemark && (
                      <div className="text-[10px] text-gray-600 mt-0.5 line-clamp-2" title={r.qcReportRemark}>“{r.qcReportRemark}”</div>
                    )}
                    {r.qcReviewer && <div className="text-[10px] text-gray-400 mt-0.5">by {r.qcReviewer.name}</div>}
                    {(r.status === 'QC_DONE' || r.status === 'INWARDED' || r.status === 'ON_HOLD') && r.qcResult && (
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
                        {canWrite && r.status === 'ON_HOLD' && (
                          <ActBtn tone="amber" busy={busy} onClick={() => onResend(r)}><Send size={11} /> Resend to QC</ActBtn>
                        )}
                        {r.status === 'QC_DONE' && r.qcResult === 'FAILED' && (
                          <>
                            <Pill tone="red">Rejected</Pill>
                            {canWrite && (
                              <ActBtn tone="amber" busy={busy} onClick={() => onResend(r)}><Send size={11} /> Re-inspect</ActBtn>
                            )}
                          </>
                        )}
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
  // Multi-line PO receipt: sel[poItemId] = { qty, batchNo, dateOfExpiry }. A key's
  // presence means the line is ticked for this delivery.
  const [sel, setSel] = useState({});
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

  // New + From PO → per-line qty/batch/expiry (a delivery carries several lines,
  // each in its own batch). Direct & edit keep the single scalar fields.
  const perLine = !isEdit && source === 'po';

  useEffect(() => {
    if (isEdit) return; // edit only touches scalar fields
    if (source === 'po') api.get('/material-inward/active-pos').then(({ data }) => setPos(data.orders || [])).catch(() => setPos([]));
    if (source === 'direct') api.get('/products', { params: { limit: 'all' } }).then(({ data }) => setProducts(data.products || [])).catch(() => setProducts([]));
  }, [source, isEdit]);

  const po = pos.find((p) => p.id === poId);
  const remainingOf = (it) => (it.quantity || 0) - (it.receivedQty || 0);
  const toggleLine = (it) => setSel((prev) => {
    const next = { ...prev };
    if (next[it.id]) { delete next[it.id]; return next; }
    const rem = remainingOf(it);
    next[it.id] = { qty: rem > 0 ? String(rem) : '', batchNo: '', dateOfExpiry: '' };
    return next;
  });
  const setLine = (id, k, v) => setSel((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v } }));
  const selectedCount = Object.keys(sel).length;

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.materialCode || '').toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(productSearch.toLowerCase()));
  const product = products.find((p) => p.id === productId);

  const submit = async () => {
    setError('');
    if (perLine) {
      if (!poId) return setError('Pick a PO.');
      const lines = Object.entries(sel);
      if (!lines.length) return setError('Tick at least one material line.');
      for (const [id, v] of lines) {
        if (!v.qty || Number(v.qty) <= 0) {
          const it = po?.items.find((x) => x.id === id);
          return setError(`Enter a received quantity for ${it?.productName || 'each ticked line'}.`);
        }
      }
    } else if (!isEdit && source === 'direct' && !f.itemDescription.trim()) {
      return setError('Item description is required.');
    } else if (!perLine && (!f.qtyReceived || Number(f.qtyReceived) <= 0)) {
      return setError('Enter the received quantity.');
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/material-inward/${editRow.id}`, {
          vehicleDetails: f.vehicleDetails, docType: f.docType, docNumber: f.docNumber,
          qtyReceived: f.qtyReceived, batchNo: f.batchNo, dateOfExpiry: f.dateOfExpiry || null,
          purpose: f.purpose,
          ...(editRow.poNumber ? {} : { itemDescription: f.itemDescription, uom: f.uom, productId: productId || editRow.productId || null }),
        });
      } else if (perLine) {
        // One delivery → many lines → one MIR row each (server assigns lots).
        await api.post('/material-inward/bulk', {
          purchaseOrderId: poId,
          vehicleDetails: f.vehicleDetails,
          docType: f.docType,
          docNumber: f.docNumber,
          purpose: f.purpose,
          lines: Object.entries(sel).map(([poItemId, v]) => ({
            purchaseOrderItemId: poItemId,
            qtyReceived: v.qty,
            batchNo: v.batchNo,
            dateOfExpiry: v.dateOfExpiry || null,
          })),
        });
      } else {
        const payload = {
          vehicleDetails: f.vehicleDetails, docNumber: f.docNumber,
          qtyReceived: f.qtyReceived, batchNo: f.batchNo, dateOfExpiry: f.dateOfExpiry || null,
          purpose: f.purpose,
          itemDescription: f.itemDescription,
          uom: f.uom,
          supplierName: f.supplierName,
          productId: productId || null,
          // Direct/cash entries default an invoice doc-type to Cash Purchase.
          docType: f.docType === 'INVOICE' ? 'CASH_PURCHASE' : f.docType,
        };
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

        {/* From PO — pick the PO, then tick every line that arrived (each can be a
            partial / batch receipt). Units are auto-assigned per line. */}
        {!isEdit && source === 'po' && (
          <div className="space-y-3">
            <Select label="RAPS Purchase Order *" value={poId} onChange={(e) => { setPoId(e.target.value); setSel({}); }}>
              <option value="">Select active PO…</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.orderNumber} — {p.supplierName} {p.isUnion ? '(UNION)' : ''}</option>)}
            </Select>
            {po && (
              <div className="text-[11px] bg-navy-50 border border-navy-100 rounded-md p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><span className="text-gray-500">Supplier:</span> {po.supplierName}</div>
                <div><span className="text-gray-500">PR:</span> {po.prNumbers || '—'}</div>
                <div><span className="text-gray-500">Issued to:</span> {po.issuedToLabel || po.issuedToDept || '—'}</div>
                <div><span className="text-gray-500">Indenter:</span> {po.indenterName || '—'}</div>
              </div>
            )}
            {po && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[13px] font-semibold text-navy-700">Material lines received *</label>
                  <span className="text-[11px] text-navy-500">{selectedCount} of {po.items.length} ticked</span>
                </div>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[320px] overflow-y-auto">
                  {po.items.map((it) => {
                    const checked = !!sel[it.id];
                    const v = sel[it.id] || {};
                    const rem = remainingOf(it);
                    return (
                      <div key={it.id} className={`p-2.5 ${checked ? 'bg-navy-50/50' : ''}`}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" className="mt-0.5" checked={checked} onChange={() => toggleLine(it)} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-navy-800">{it.productName}</div>
                            <div className="text-[11px] text-gray-500">
                              Ordered {fmtQty(it.quantity)} {it.productUnit} · Received {fmtQty(it.receivedQty || 0)} · <span className={rem > 0 ? 'text-emerald-600 font-semibold' : 'text-gray-400'}>Remaining {fmtQty(rem)}</span>
                            </div>
                            {it.issuedToLabel && (
                              <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-navy-600">
                                <Building2 size={10} /> → {it.issuedToLabel}
                                {it.unitAllocations?.length > 1 && <span className="text-amber-600">(auto-split)</span>}
                              </div>
                            )}
                          </div>
                        </label>
                        {checked && (
                          <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <Input label="Qty received *" type="number" min="0" step="any" value={v.qty} onChange={(e) => setLine(it.id, 'qty', e.target.value)} />
                            <Input label="Batch no." value={v.batchNo} onChange={(e) => setLine(it.id, 'batchNo', e.target.value)} />
                            <Input label="Expiry" type="date" value={v.dateOfExpiry} onChange={(e) => setLine(it.id, 'dateOfExpiry', e.target.value)} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">Each ticked line becomes its own MIR row (lot) with its own QC track. A line can be received in batches across several deliveries — just record the part that arrived.</p>
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

        {/* Common header fields. Qty / batch / expiry are per-line in PO mode. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="Vehicle details" value={f.vehicleDetails} onChange={(e) => set('vehicleDetails', e.target.value)} placeholder="e.g. AP 31 CD 1234" />
          <Select label="Document type" value={f.docType} onChange={(e) => set('docType', e.target.value)}>
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
          <Input label="Document number" value={f.docNumber} onChange={(e) => set('docNumber', e.target.value)} placeholder="Invoice / DC / GP no." />
          {!perLine && <Input label="Qty received *" type="number" min="0" step="any" value={f.qtyReceived} onChange={(e) => set('qtyReceived', e.target.value)} />}
          {!perLine && <Input label="Batch number" value={f.batchNo} onChange={(e) => set('batchNo', e.target.value)} />}
          {!perLine && <Input label="Expiry date" type="date" value={f.dateOfExpiry} onChange={(e) => set('dateOfExpiry', e.target.value)} />}
        </div>
        <Textarea label="Purpose" rows={2} value={f.purpose} onChange={(e) => set('purpose', e.target.value)} />

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : perLine ? `Create ${selectedCount || ''} ${selectedCount === 1 ? 'Entry' : 'Entries'}`.trim() : 'Create Entry'}
          </Button>
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
  const [qtyHeld, setQtyHeld] = useState(row.qtyHeld ?? '');
  const [holdReason, setHoldReason] = useState(row.holdReason || '');
  const [reportNo, setReportNo] = useState(row.qcReportNo || '');
  const [remark, setRemark] = useState(row.qcReportRemark || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const onHold = result === 'ON_HOLD';

  const submit = async () => {
    setError('');
    if (!reportNo.trim()) return setError('Inward Inspection No. is required.');
    if (!remark.trim()) return setError('A report remark is required.');
    if (onHold && !holdReason.trim()) return setError('A hold reason is required to place the lot on hold.');
    setSaving(true);
    try {
      await api.post(`/material-inward/${row.id}/finish-review`, {
        qcResult: result, qtyAccepted, qtyRejected, qtyHeld, holdReason,
        qcReportNo: reportNo, qcReportRemark: remark,
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
            {!onHold && <Input label="Qty accepted" type="number" min="0" step="any" value={qtyAccepted} onChange={(e) => setQtyAccepted(e.target.value)} />}
            {!onHold && <Input label="Qty rejected" type="number" min="0" step="any" value={qtyRejected} onChange={(e) => setQtyRejected(e.target.value)} />}
            {onHold && <Input label="Qty held" type="number" min="0" step="any" value={qtyHeld} onChange={(e) => setQtyHeld(e.target.value)} />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label="Result *" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="PASSED">Passed</option>
              <option value="PARTIAL">Partial (some accepted)</option>
              <option value="FAILED">Failed (all rejected)</option>
              <option value="ON_HOLD">On Hold (re-inspect later)</option>
            </Select>
            <Input label="Inward Inspection No. *" value={reportNo} onChange={(e) => setReportNo(e.target.value)} className="sm:col-span-2" placeholder="e.g. RAPS/IR/25/021" />
          </div>
          {onHold && (
            <Input label="Hold reason *" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} placeholder="Why is this lot held? (pending COA / retest / clarification…)" />
          )}
          {(result === 'FAILED' || result === 'PARTIAL') && (
            <Input label="Reason for rejection / non-conformity" value={f.rejectionReason} onChange={(e) => set('rejectionReason', e.target.value)} />
          )}
          {onHold && (
            <p className="text-[11px] text-rose-600">On hold won't add stock. Once the issue is sorted, Stores can resend the lot to QC for re-inspection.</p>
          )}
          <Textarea label="Report remark *" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Inspection findings / report details…" />
        </FormBlock>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : onHold ? 'Place on Hold' : 'Finish Review'}</Button>
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
        <div className="text-sm text-gray-700 space-y-2">
          <p><strong>{row.itemDescription}</strong></p>
          <p className="text-xs text-gray-500">
            Adding <strong className="text-navy-800">{fmtQty(qty)} {row.uom || ''}</strong> to stock
            {row.batchNo ? <> · Batch <span className="font-mono">{row.batchNo}</span></> : ''}
            {row.issuedToLabel ? <> · for {row.issuedToLabel}</> : ''}.
          </p>
          {!row.issuedToUnitId && row.unitAllocations?.length > 1 && (
            <div className="text-[11px] bg-navy-50 border border-navy-100 rounded p-2 space-y-0.5">
              <p className="font-semibold text-navy-700">Auto-split across units (by PR allocation):</p>
              {splitPreview(row.unitAllocations, qty).map((s) => (
                <div key={s.unitId} className="flex justify-between">
                  <span className="text-gray-600">{s.unitName} ({s.unitCode})</span>
                  <span className="font-semibold text-navy-800">{fmtQty(s.qty)} {row.uom || ''}</span>
                </div>
              ))}
            </div>
          )}
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

// ── Resend a held / failed lot to QC for re-inspection ──
function ResendQcModal({ row, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setSaving(true); setError('');
    try { await api.post(`/material-inward/${row.id}/resend-qc`, { note: note.trim() || null }); onDone(); }
    catch (err) { setError(err.response?.data?.error || 'Failed'); setSaving(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Resend to QC — ${row.mirNo}`} size="md">
      <div className="space-y-3">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
        <div className="text-sm text-gray-700 space-y-1">
          <p>Send <strong>{row.itemDescription || row.mirNo}</strong> back to QC for re-inspection.</p>
          {row.status === 'ON_HOLD' && row.holdReason && (
            <p className="text-xs text-rose-700">Held: “{row.holdReason}”</p>
          )}
          {row.status === 'QC_DONE' && row.qcResult === 'FAILED' && (
            <p className="text-xs text-rose-700">Previously failed — re-inspecting after rework / clarification.</p>
          )}
        </div>
        <p className="text-[11px] text-gray-500">The finished round ({row.qcRound || 1}) is kept in history; QC files a fresh outcome for the next round.</p>
        <Textarea label="Note to QC (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was addressed / what to re-check…" />
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Sending…' : 'Resend to QC'}</Button>
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

// ─── Inward FIM / Customer Property ─────────────────────────────────────
// Records customer-supplied material (FIM) and accepts it into Products.
// Created ProductBatches are tagged FIM and linked back to the originating
// inward gate pass so we can trace each batch back to the customer.
function FromGatePassMode({ canEdit }) {
  const [view, setView] = useState('accepted'); // 'pending' | 'accepted'
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showRecord, setShowRecord] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);

  const load = () => {
    setLoading(true);
    const status = view === 'pending' ? 'PENDING_ACCEPTANCE' : 'ACCEPTED';
    api.get('/gatepasses', { params: { direction: 'INWARD', status, limit: 100 } })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .catch(() => setGatePasses([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [localRefresh, view]);

  if (selected) {
    return (
      <AcceptInwardForm
        gatePass={selected}
        canEdit={canEdit && view === 'pending'}
        onCancel={() => setSelected(null)}
        onComplete={() => { setSelected(null); load(); }}
      />
    );
  }

  const viewBtn = (key, label) => (
    <button
      onClick={() => setView(key)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
        view === key
          ? 'bg-navy-700 text-white border-navy-700'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-800">
          {view === 'pending' ? 'FIM Awaiting Acceptance' : 'Accepted FIM Inward'}
        </h3>
        <div className="flex items-center gap-2">
          {viewBtn('accepted', 'Accepted')}
          {viewBtn('pending', 'Pending')}
          {canEdit && (
            <Button onClick={() => setShowRecord(true)}>
              <Plus size={14} /> Record Inward (FIM)
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Items recorded here are added to stock immediately — no separate acceptance step. They show up under
        Products → FIM Status straight away.
      </p>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : gatePasses.length === 0 ? (
        <Card className="text-center text-gray-500 py-8">
          {view === 'pending'
            ? 'No legacy inward entries awaiting acceptance. New ones are inwarded automatically on submission.'
            : 'No accepted FIM gate passes yet. Click “Record Inward (FIM)” when customer material arrives.'}
        </Card>
      ) : (
        <>
          {view === 'pending' && (
            <div className="mb-3 text-xs text-amber-700">
              The entries below were created before auto-acceptance was enabled and still need to be processed.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {gatePasses.map(g => {
              const pending = (g.items || []).filter(i => (i.inwardedQty || 0) < (i.quantity || 0));
              const inwardedCount = (g.items || []).length - pending.length;
              return (
                <Card key={g.id} className="cursor-pointer hover:border-navy-400 hover:shadow-md transition-all border border-gray-200"
                  onClick={() => setSelected(g)}>
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-navy-700">{g.fimNumber || g.passNumber}</h4>
                    <Badge color={view === 'pending' ? 'yellow' : 'green'}>
                      {view === 'pending' ? 'Pending Acceptance' : 'Accepted'}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    {g.fimNumber && <div className="font-mono text-[11px] text-gray-500">{g.passNumber}</div>}
                    <div><span className="text-gray-500">Customer:</span> {g.customerName || '—'}</div>
                    <div><span className="text-gray-500">Customer GP:</span> {g.customerGatePassNo || '—'}{g.customerGatePassDate ? ` (${formatDate(g.customerGatePassDate)})` : ''}</div>
                    <div>
                      <span className="text-gray-500">Items {view === 'pending' ? 'pending' : 'accepted'}:</span>{' '}
                      {view === 'pending' ? pending.length : inwardedCount} of {g.items?.length || 0}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {showRecord && canEdit && (
        <RecordInwardModal
          onClose={() => setShowRecord(false)}
          onCreated={() => { setShowRecord(false); setView('accepted'); setLocalRefresh(k => k + 1); }}
        />
      )}
    </div>
  );
}

// ─── Record Inward Modal ────────────────────────────────────────────────
// Captures customer FIM details and posts an INWARD gate pass (inwardKind
// STORES). STORES inward auto-accepts into the product list immediately.
const blankInwardItem = () => ({
  description: '', quantity: 1, unit: 'pcs',
  dispatchedTo: '', itemPurpose: '', probableReturnDate: '',
  itemPassType: 'RETURNABLE', gatePassDetails: '', transportation: '',
  contactPersonDetails: '', remarks: '',
});

function RecordInwardModal({ onClose, onCreated }) {
  const [customerName, setCustomerName] = useState('');
  const [customerGatePassNo, setCustomerGatePassNo] = useState('');
  const [customerGatePassDate, setCustomerGatePassDate] = useState('');
  const [customerGpDocType, setCustomerGpDocType] = useState('ORIGINAL');
  const [customerGpPdf, setCustomerGpPdf] = useState(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [gpRequisitionNo, setGpRequisitionNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState([blankInwardItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, blankInwardItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (!customerName.trim()) return setError('Customer name is required');
    if (!customerGatePassNo.trim()) return setError("Customer's gate pass number is required");
    if (items.some(i => !i.description.trim())) return setError('Each item needs a name/description');
    if (items.some(i => !i.quantity || Number(i.quantity) <= 0)) return setError('Each item needs a positive quantity');
    if (items.some(i => i.itemPassType === 'RETURNABLE' && !i.probableReturnDate)) {
      return setError('Returnable items need a probable date of return');
    }

    setSaving(true);
    try {
      const itemsPayload = items.map(i => ({
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
        remarks: i.remarks?.trim() || null,
      }));

      // Use multipart when a PDF is attached so the server can store the file alongside the GP record.
      if (customerGpPdf) {
        const fd = new FormData();
        fd.append('direction', 'INWARD');
        fd.append('inwardKind', 'STORES');
        if (remarks.trim()) fd.append('remarks', remarks.trim());
        fd.append('customerName', customerName.trim());
        fd.append('customerGatePassNo', customerGatePassNo.trim());
        if (customerGatePassDate) fd.append('customerGatePassDate', customerGatePassDate);
        fd.append('customerGpDocType', customerGpDocType);
        if (vehicleNo.trim()) fd.append('vehicleNo', vehicleNo.trim());
        if (driverName.trim()) fd.append('driverName', driverName.trim());
        if (gpRequisitionNo.trim()) fd.append('gpRequisitionNo', gpRequisitionNo.trim());
        fd.append('customerGpPdf', customerGpPdf);
        fd.append('items', JSON.stringify(itemsPayload));
        await api.post('/gatepasses', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/gatepasses', {
          direction: 'INWARD',
          inwardKind: 'STORES',
          remarks: remarks.trim() || undefined,
          customerName: customerName.trim(),
          customerGatePassNo: customerGatePassNo.trim(),
          customerGatePassDate: customerGatePassDate || null,
          customerGpDocType,
          vehicleNo: vehicleNo.trim() || null,
          driverName: driverName.trim() || null,
          gpRequisitionNo: gpRequisitionNo.trim() || null,
          items: itemsPayload,
        });
      }
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record inward entry');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Modal isOpen onClose={onClose} title="FIM / Customer Property Register Entry" size="full">
      <div className="space-y-5">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <p className="text-xs text-gray-500">
          FIM No. (RAPS/FIM/&lt;FY&gt;/&lt;count&gt;) and Date are auto-generated on submit. Returned Date and Return-by Vehicle/Driver are filled later when the material is sent back.
        </p>

        {/* Register header — applies to every row in this entry */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">FIM No.</label>
              <div className="px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-500 bg-white">
                Auto: RAPS/FIM/&lt;FY&gt;/&lt;next&gt;
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <div className="px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-500 bg-white">
                {new Date().toLocaleDateString()}
              </div>
            </div>
            <Input label="Customer *" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. ABC Pvt. Ltd." />
            <Input label="Gate Pass Requisition No." value={gpRequisitionNo} onChange={e => setGpRequisitionNo(e.target.value)} placeholder="Internal reference (if any)" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input label="Vehicle No." value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="e.g. AP 31 CD 1234" />
            <Input label="Driver name / sign" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Driver name" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice / DC / Gate Pass Type *</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                value={customerGpDocType}
                onChange={e => setCustomerGpDocType(e.target.value)}
              >
                <option value="ORIGINAL">Original</option>
                <option value="DUPLICATE">Duplicate</option>
              </select>
            </div>
            <Input type="date" label="Customer's GP date" value={customerGatePassDate} onChange={e => setCustomerGatePassDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Invoice / DC / Gate Pass Details *" value={customerGatePassNo} onChange={e => setCustomerGatePassNo(e.target.value)} placeholder="Customer's GP / DC / Invoice number" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload GP / DC / Invoice PDF (optional)</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => {
                  const f = e.target.files?.[0] || null;
                  if (f && !checkFileSize(f)) { e.target.value = ''; return; }
                  setCustomerGpPdf(f);
                }}
                className="w-full text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-navy-700 file:text-white hover:file:bg-navy-800"
              />
              {customerGpPdf && (
                <div className="mt-1 text-xs text-gray-500 truncate" title={customerGpPdf.name}>
                  {customerGpPdf.name}
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800">Items</h4>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add row</Button>
          </div>

          <div className="border border-gray-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1200 }}>
              <colgroup>
                <col style={{ width: '36px' }} />
                <col style={{ width: '220px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '170px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '40px' }} />
              </colgroup>
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr className="text-left">
                  <th className="px-3 py-2.5 text-center font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Item Description</th>
                  <th className="px-3 py-2.5 text-center font-medium">Quantity</th>
                  <th className="px-3 py-2.5 text-center font-medium">UOM</th>
                  <th className="px-3 py-2.5 font-medium">Purpose</th>
                  <th className="px-3 py-2.5 font-medium">Probable Return Date</th>
                  <th className="px-3 py-2.5 font-medium">Issued to Dept / Person</th>
                  <th className="px-3 py-2.5 font-medium">Pass Type</th>
                  <th className="px-3 py-2.5 font-medium">Remarks</th>
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
                        value={it.itemPurpose} onChange={e => updateItem(idx, 'itemPurpose', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" className={cellInput}
                        value={it.probableReturnDate} onChange={e => updateItem(idx, 'probableReturnDate', e.target.value)}
                        disabled={it.itemPassType !== 'RETURNABLE'} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        placeholder="Dept / person"
                        value={it.dispatchedTo} onChange={e => updateItem(idx, 'dispatchedTo', e.target.value)} />
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
                        value={it.remarks} onChange={e => updateItem(idx, 'remarks', e.target.value)} />
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
          <p className="text-xs text-gray-400 mt-1.5">
            Returned Date and Return-by Vehicle / Driver columns appear in the FIM register once the material is sent back via Delivery Challan.
          </p>
        </div>

        <Textarea label="Entry-level remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Send size={14} /> {saving ? 'Submitting…' : 'Record Inward'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AcceptInwardForm({ gatePass, onCancel, onComplete, canEdit }) {
  const items = (gatePass.items || []).filter(i => (i.inwardedQty || 0) < (i.quantity || 0));
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState(
    items.map(i => ({
      itemId: i.id,
      description: i.description,
      quantity: i.quantity,
      inwardedQty: i.inwardedQty || 0,
      unit: i.unit || 'pcs',
      probableReturnDate: i.probableReturnDate,
      itemPassType: i.itemPassType,
      // Form state
      mode: 'new', // 'new' | 'existing'
      productId: '',
      newName: i.description,
      newMaterialType: 'Others',
      acceptQty: (i.quantity || 0) - (i.inwardedQty || 0),
      batchNumber: '',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products', { params: { limit: 'all' } })
      .then(({ data }) => setProducts(data.products || []))
      .catch(() => setProducts([]));
  }, []);

  const update = (idx, field, value) => {
    const copy = [...rows];
    copy[idx] = { ...copy[idx], [field]: value };
    setRows(copy);
  };

  const submit = async () => {
    setError('');
    for (const r of rows) {
      const qty = parseFloat(r.acceptQty);
      const remaining = r.quantity - r.inwardedQty;
      if (!qty || qty <= 0) return setError(`Enter accept qty for ${r.description}`);
      if (qty > remaining + 1e-9) return setError(`${r.description}: cannot accept ${qty} (only ${remaining} pending)`);
      if (r.mode === 'existing' && !r.productId) return setError(`${r.description}: select a product or switch to "New product"`);
      if (r.mode === 'new' && !r.newName.trim()) return setError(`${r.description}: new product name is required`);
    }

    setSaving(true);
    try {
      await api.put(`/gatepasses/${gatePass.id}/accept-inward`, {
        items: rows.map(r => ({
          itemId: r.itemId,
          quantity: parseFloat(r.acceptQty),
          batchNumber: r.batchNumber || undefined,
          productId: r.mode === 'existing' ? r.productId : undefined,
          newProduct: r.mode === 'new' ? {
            name: r.newName.trim(),
            materialType: r.newMaterialType,
            unit: r.unit || 'pcs',
          } : undefined,
        })),
      });
      onComplete();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept inward gate pass');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-navy-700">{gatePass.fimNumber || gatePass.passNumber}</h3>
          <p className="text-xs text-gray-500">
            Customer: <strong>{gatePass.customerName}</strong> · Customer GP <strong>{gatePass.customerGatePassNo}</strong>
            {gatePass.customerGatePassDate ? ` (${formatDate(gatePass.customerGatePassDate)})` : ''}
            {' · '}
            Type: <strong>{gatePass.passType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}</strong>
          </p>
        </div>
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
      </div>

      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
        <strong>FIM (Free Issue Material):</strong> these items belong to the customer. Each accepted item creates (or adds to) a Product
        and marks the resulting batch as <em>FIM</em>, linked to this gate pass so the product can be traced back to the customer.
      </div>

      {error && <div className="p-3 mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

      <div className="space-y-4">
        {rows.map((r, idx) => (
          <div key={r.itemId} className="border border-gray-200 rounded p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-medium text-gray-800">{r.description}</span>
                <span className="ml-2 text-xs text-gray-500">
                  on gatepass: {r.quantity} {r.unit} · pending: {(r.quantity - r.inwardedQty).toFixed(2)} {r.unit}
                </span>
              </div>
              <Badge color={r.itemPassType === 'NON_RETURNABLE' ? 'orange' : 'blue'}>
                {r.itemPassType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}
              </Badge>
            </div>

            <div className="flex gap-3 text-xs mb-2">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={r.mode === 'new'} onChange={() => update(idx, 'mode', 'new')} />
                Create new product
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={r.mode === 'existing'} onChange={() => update(idx, 'mode', 'existing')} />
                Add to existing product
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
              {r.mode === 'new' ? (
                <>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Product name *</label>
                    <input className={cellInput}
                      value={r.newName} onChange={(e) => update(idx, 'newName', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Material type</label>
                    <select className={cellInput}
                      value={r.newMaterialType} onChange={(e) => update(idx, 'newMaterialType', e.target.value)}>
                      <option>Others</option>
                      <option>Raw Material</option>
                      <option>Consumable</option>
                      <option>Hand Tools & Fastners</option>
                      <option>Tools & Fixtures</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="md:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Pick product *</label>
                  <select className={cellInput}
                    value={r.productId} onChange={(e) => update(idx, 'productId', e.target.value)}>
                    <option value="">— Select existing product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Accept qty * ({r.unit})</label>
                <input type="number" min="0" step="any" className={cellInput}
                  value={r.acceptQty} onChange={(e) => update(idx, 'acceptQty', e.target.value)} />
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs text-gray-500 mb-1">Batch number (optional)</label>
                <input className={cellInput}
                  value={r.batchNumber} onChange={(e) => update(idx, 'batchNumber', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
        {canEdit && (
          <Button onClick={submit} disabled={saving || rows.length === 0}>
            {saving ? 'Saving…' : 'Accept & Inward FIM'}
          </Button>
        )}
      </div>
    </Card>
  );
}
