import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, CheckCircle, XCircle, ShoppingCart, Package, PackageCheck, X, FileText, TrendingUp, Layers, Eye, RefreshCw, GitMerge, Unlink, Upload, Lock, Paperclip, Pencil, History, ArrowRight, PauseCircle, Send } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Pagination from '../components/shared/Pagination';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select } from '../components/ui/Input';
import { formatDate, formatDateTime } from '../utils/formatters';
import { UOM_OPTIONS } from '../utils/units';
import { MATERIAL_TYPE_OPTIONS, withStoredType } from '../utils/materialTypes';
import MaterialCategoryReference from '../components/shared/MaterialCategoryReference';
import { reasonError } from '../utils/reasonValidation';
import { slaRemarkState } from '../utils/sla';
import { SlaNotice, SlaDelayRemark } from '../components/shared/SlaGate';
import TatBadge from '../components/shared/TatBadge';
import { tatStatus, tatRowClass } from '../utils/tat';
import PRPdf from '../components/pdf/PRPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import MaterialNameInput from '../components/shared/MaterialNameInput';
import ExportExcelButton from '../components/shared/ExportExcelButton';
import WorkOrderPicker from '../components/shared/WorkOrderPicker';
import { PO_NUMBER_PENDING_LABEL, poNumberLabel, canCreateProduct } from '../utils/roles';
import SearchBar from '../components/shared/SearchBar';
import AddMasterMaterialModal from '../components/shared/AddMasterMaterialModal';

// Allowed spec / note attachment formats — any common document or drawing type.
// Validated by extension (DWG/office/zip mime types vary across browsers).
const ATT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.dwg,.doc,.docx,.xls,.xlsx,.zip';
const ATT_EXT_RE = /\.(pdf|png|jpe?g|dwg|docx?|xlsx?|zip)$/i;
const ATT_MAX_MB = 15;
// Mirrors the server cap on PUT /purchase-requests/:id/remarks.
const MAX_REMARK_LEN = 1000;
// PRs per page in the list. The status tab and date range are applied on the
// server, so a page is always a full page of matching PRs.
const PR_PAGE_SIZE = 50;

// Normalise any PR item/note attachment list coming from the API (new multi-file
// `attachments` array; falls back to the legacy single specAttachment* fields).
const itemAttachmentList = (i) => {
  if (Array.isArray(i?.attachments) && i.attachments.length) {
    return i.attachments.map((a) => ({ url: a.url, name: a.name }));
  }
  if (i?.specAttachmentUrl) return [{ url: i.specAttachmentUrl, name: i.specAttachmentName || 'spec.pdf' }];
  return [];
};

// Read-only wrapped list of attachment links — used across every PR detail view.
function AttachmentLinks({ items, label }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      {label && <span className="font-medium text-gray-600">{label}</span>}{' '}
      <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5 align-top">
        {items.map((a, i) => (
          <a
            key={a.id || a.url || i}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-navy-700 hover:underline"
          >
            <Paperclip size={10} /> {a.name || 'View'}
          </a>
        ))}
      </span>
    </div>
  );
}

// Inline remark editor — shared by the PR-level note and each material line's
// remark in the detail view. Remarks stay editable at every PR stage, and each
// save notifies Purchase + Stores (they buy / issue against what it says), so
// the reminder is spelled out next to the Save button.
function RemarkEditor({ value, onChange, onSave, onCancel, saving, rows = 2 }) {
  return (
    <div className="mt-1 space-y-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={MAX_REMARK_LEN}
        autoFocus
        placeholder="Type the remark…"
        className="w-full px-2 py-1.5 border border-gray-400 rounded text-xs text-gray-800 focus:outline-none focus:bg-yellow-50"
      />
      <div className="flex items-center gap-1 flex-wrap">
        <Button size="sm" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
        <span className="text-[10px] text-gray-500">Purchase &amp; Stores get notified</span>
      </div>
    </div>
  );
}

// ─── Required-by date change trail ───
// Every time a line's required-by date is moved, the server records who did it,
// when, and the old → new value (PurchaseRequestDateHistory, sent back on the PR
// as `dateHistory`, newest first). The date is a commitment other departments
// plan against, so a silent change is never acceptable — it is shown on the line
// itself and listed in full below the materials table.
const rbLabel = (d) => (d ? formatDate(d) : 'not set');

const roleLabel = (r) => (r ? r.replace(/_/g, ' ') : '');

// Changes for one material line, newest first. Matched on itemId; a PR edited
// while still pending recreates its item rows, so those older entries no longer
// match a line and only appear in the full list (which keeps the product name).
const rbHistoryFor = (history, itemId) =>
  (history || []).filter((h) => h.itemId && h.itemId === itemId);

// Compact "this date was changed" note shown right under the date in the line.
function RequiredByChangeNote({ entries }) {
  if (!entries || entries.length === 0) return null;
  const [latest, ...older] = entries;
  return (
    <div className="mt-1 whitespace-normal text-[10px] leading-tight">
      <div className="flex items-center gap-1 text-amber-700 font-medium">
        <History size={10} className="shrink-0" />
        <span>{rbLabel(latest.fromDate)} → {rbLabel(latest.toDate)}</span>
      </div>
      <div className="text-gray-500">
        by {latest.changedByName || 'Unknown user'}
        {latest.changedByRole ? ` (${roleLabel(latest.changedByRole)})` : ''}
        {' • '}{formatDateTime(latest.createdAt)}
      </div>
      {older.length > 0 && (
        <div className="text-gray-400">+{older.length} earlier change{older.length > 1 ? 's' : ''}</div>
      )}
    </div>
  );
}

// Full trail for the PR — every line, every change, newest first.
function RequiredByHistoryPanel({ entries }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-amber-900">
        <History size={14} /> Required-By Date Changes ({entries.length})
      </div>
      <p className="text-[11px] text-amber-800 mb-2">
        Every change to a required-by date on this PR — who made it, when, and the exact old → new value.
      </p>
      <ul className="space-y-1.5">
        {entries.map((h) => (
          <li key={h.id} className="text-xs bg-white border border-amber-100 rounded px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-gray-800">
              <span className="font-medium">{h.productName || 'Material'}</span>
              <span className="text-gray-400">·</span>
              <span>{rbLabel(h.fromDate)}</span>
              <ArrowRight size={11} className="text-gray-400 shrink-0" />
              <span className="font-semibold">{rbLabel(h.toDate)}</span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              changed by <span className="font-medium text-gray-700">{h.changedByName || 'Unknown user'}</span>
              {h.changedByRole ? ` (${roleLabel(h.changedByRole)})` : ''}
              {' on '}{formatDateTime(h.createdAt)}
              {h.prStatus ? ` • PR was ${statusLabel(h.prStatus)}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The admin-hold conversation: every round of "Admin asked → raiser answered".
// The last round is left open (no response yet) while the PR sits ON_HOLD.
// Shown to both sides — Admin in the review modal, the raiser in the detail view.
function HoldThread({ request }) {
  const rounds = Array.isArray(request?.holdHistory) ? request.holdHistory : [];
  if (rounds.length === 0) return null;
  const isHeld = request.status === 'ON_HOLD';
  return (
    <div className={`border rounded-lg p-3 ${isHeld ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`flex items-center gap-1.5 mb-2 text-sm font-semibold ${isHeld ? 'text-orange-900' : 'text-gray-700'}`}>
        <PauseCircle size={14} />
        {isHeld ? 'On hold — clarification needed' : `Clarification history (${rounds.length})`}
      </div>
      <ul className="space-y-2">
        {rounds.map((r, idx) => (
          <li key={idx} className="text-xs bg-white border border-gray-200 rounded px-2 py-1.5 space-y-1">
            <div>
              <span className="font-semibold text-orange-800">Admin asked</span>
              <span className="text-gray-500">
                {' '}· {r.heldByName || 'Admin'}{r.heldAt ? ` · ${formatDateTime(r.heldAt)}` : ''}
              </span>
              <div className="text-gray-800 mt-0.5">{r.remark}</div>
            </div>
            {r.response ? (
              <div className="border-t border-gray-100 pt-1">
                <span className="font-semibold text-green-800">Answered</span>
                <span className="text-gray-500">
                  {' '}· {r.respondedByName || 'Requester'}{r.respondedAt ? ` · ${formatDateTime(r.respondedAt)}` : ''}
                </span>
                <div className="text-gray-800 mt-0.5">{r.response}</div>
              </div>
            ) : (
              <div className="border-t border-gray-100 pt-1 text-[11px] italic text-orange-700">
                Waiting on {request.manager?.name || 'the requester'} to respond.
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// When a PR is waiting for a decision, this is when the wait started — drives
// the turnaround ageing badge (yellow ≥24h, red ≥48h) in the list.
// Pending-since drives the TAT badge. A PR that Admin sent back for
// clarification is waiting on the RAISER, not on an approver, so the approval
// clock stops until they respond and it returns to PENDING_ADMIN.
const prPendingSince = (r) =>
  r?.status === 'PENDING_QC' ? r.createdAt
    : r?.status === 'PENDING_ADMIN' ? (r.qcApprovedAt || r.createdAt)
      : null;

const statusColor = (s) => ({
  PENDING_QC: 'yellow',
  PENDING_ADMIN: 'yellow',
  ON_HOLD: 'orange',
  APPROVED: 'blue',
  QUOTATION_SUBMITTED: 'purple',
  QUOTATION_APPROVED: 'navy',
  ORDER_PLACED: 'navy',
  GOODS_ARRIVED: 'purple',
  QC_PASSED: 'green',
  INWARD_DONE: 'green',
  IN_PROGRESS: 'navy',
  COMPLETED: 'green',
  REJECTED: 'red',
  CASH_PURCHASE: 'orange',
}[s] || 'gray');

const statusLabel = (s) => ({
  PENDING_QC: 'Pending QC',
  PENDING_ADMIN: 'Pending Admin',
  ON_HOLD: 'On Hold',
  APPROVED: 'Approved',
  QUOTATION_SUBMITTED: 'Quotation Submitted',
  QUOTATION_APPROVED: 'Quotation Approved',
  ORDER_PLACED: 'Order Placed',
  GOODS_ARRIVED: 'Goods Arrived',
  QC_PASSED: 'QC Passed',
  INWARD_DONE: 'Inward Done',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CASH_PURCHASE: 'Cash Purchase',
}[s] || s);

const itemStatusColor = (s) => ({
  WAITING: 'gray',
  ORDERED: 'blue',
  ON_THE_WAY: 'purple',
  RECEIVED: 'green',
  CANCELLED: 'red',
}[s] || 'gray');

const itemStatusLabel = (s) => ({
  WAITING: 'Waiting',
  ORDERED: 'Ordered',
  ON_THE_WAY: 'On the Way',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}[s] || s);

const quotationStatusColor = (s) => ({
  AWAITING_QUOTATION: 'gray',
  QUOTATION_SUBMITTED: 'yellow',
  QUOTATION_HELD: 'red',
  QUOTATION_APPROVED: 'green',
  CANCELLED: 'red',
}[s] || 'gray');

const quotationStatusLabel = (s) => ({
  AWAITING_QUOTATION: 'Quotation not sent yet',
  QUOTATION_SUBMITTED: 'Quotation submitted — pending admin',
  QUOTATION_HELD: 'On hold by admin',
  QUOTATION_APPROVED: 'Approved',
  CANCELLED: 'Cancelled',
}[s] || s);

// ──── REQUIRED-BY DATE FLOOR ────
// Procurement needs a workable lead time, so a PR line can never be needed sooner
// than 15 days out. Server mirror: MIN_REQUIRED_BY_DAYS in
// server/src/utils/helpers.js — keep both in sync. Every date input for this
// field takes `min={requiredByMin()}`, and submit re-checks it so a typed date
// (which bypasses the picker's min) can't slip through either.
const MIN_REQUIRED_BY_DAYS = 15;

const toDateInput = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Earliest date the user may pick, as a 'YYYY-MM-DD' string for <input type="date" min>.
const requiredByMin = () => {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + MIN_REQUIRED_BY_DAYS));
};

// True when a 'YYYY-MM-DD' value is inside the blocked window. Empty passes —
// the field is optional.
const requiredByTooSoon = (value) => !!value && value < requiredByMin();

// The one material type a requisition line may name in free text instead of
// picking from Master Data (kept in step with FREE_TEXT_MATERIAL_TYPE on the
// server — purchaseRequest.routes.js).
const FREE_TEXT_MATERIAL_TYPE = 'Tools & Fixtures';
// Material types offered on a requisition line. Same vocabulary as Master Data /
// inward (see utils/materialTypes.js) minus Stationery, which is not purchased
// through a requisition.
const PR_MATERIAL_TYPES = MATERIAL_TYPE_OPTIONS.filter((t) => t !== 'Stationery');
// A line that is allowed to stay unlinked: typed as Tools & Fixtures and not
// already tied to a catalogue material.
const isFreeTextLine = (item) => !item.productId && item.materialType === FREE_TEXT_MATERIAL_TYPE;

// ─── Manager: Create or Edit Request (paper-table format) ───
// Dual-mode form: when `requestToEdit` is provided, the modal pre-loads its
// items + notes and submits a PUT instead of POST. Edit is gated server-side
// to PENDING_ADMIN PRs owned by the current user (or admin).
function RequestFormModal({ isOpen, onClose, onSaved, prefillItems = null, prefillNotes = '', requestToEdit = null }) {
  const { user } = useAuth();
  const isEdit = !!requestToEdit;
  const emptyItem = {
    productId: null,
    // Material code of the linked Master Data material — display only, so the
    // requester can see which code block the line is drawing from. It is not part
    // of the payload: the PR line stores the link (productId), not the code.
    productCode: '',
    productName: '', productUnit: 'kg', requestedQty: '',
    materialType: '', materialSpecification: '', qapNo: '', drawingNo: '',
    purpose: '', sourceOfSupply: '', scopeOfWork: '',
    inspectionType: '', requiredByDate: '', itemRemarks: '',
    // Per-line spec files (multi-file, any format) — uploaded ahead of submit.
    attachments: [],
  };
  const itemFromExisting = (i) => ({
    productId: i.productId || null,
    productCode: i.product?.materialCode || i.product?.sku || '',
    productName: i.productName || '',
    productUnit: i.productUnit || 'pcs',
    requestedQty: i.requestedQty != null ? String(i.requestedQty) : '',
    materialType: i.materialType || '',
    materialSpecification: i.materialSpecification || '',
    qapNo: i.qapNo || '',
    drawingNo: i.drawingNo || '',
    purpose: i.purpose || '',
    sourceOfSupply: i.sourceOfSupply || '',
    scopeOfWork: i.scopeOfWork || '',
    inspectionType: i.inspectionType || '',
    requiredByDate: i.requiredByDate ? new Date(i.requiredByDate).toISOString().split('T')[0] : '',
    itemRemarks: i.itemRemarks || '',
    attachments: itemAttachmentList(i),
  });
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [notes, setNotes] = useState('');
  // Header-level "note" attachments (multi-file) + their upload progress/error.
  const [noteAttachments, setNoteAttachments] = useState([]);
  const [noteUpload, setNoteUpload] = useState({ uploading: false, error: '' });
  const [saving, setSaving] = useState(false);
  // Work orders assigned to this requester's unit — header-level dropdown so the
  // PR can be tied to the WO it's raised for ("" = No work order).
  const [workOrders, setWorkOrders] = useState([]);
  const [workOrderId, setWorkOrderId] = useState('');
  // Saved spec library of every catalogue material linked on the form, keyed by
  // productId, so the Spec Attachments row can offer them for ticking.
  const [productSpecs, setProductSpecs] = useState({});
  const specsFetched = useRef(new Set());
  // Per-item upload state — keyed by row index; tracks {uploading, error} so the
  // UI can show a spinner / error inline without blocking other rows.
  const [specUpload, setSpecUpload] = useState({});
  // Global-role requesters (STORE_MANAGER, DESIGNS, PLANNING, QC, SAFETY) raise PRs in
  // their own name with no unit attached. Unit-bound roles (MANAGER, RND) get
  // their unit auto-filled server-side. Either way the form never shows a
  // unit picker. In edit mode the unit is locked to the original PR's unit.
  const GLOBAL_ROLES = ['STORE_MANAGER', 'DESIGNS', 'QC', 'SAFETY', 'PLANNING'];
  const isGlobalRole = GLOBAL_ROLES.includes(user?.role);

  useEffect(() => {
    if (isOpen) {
      api.get('/work-orders/assignable')
        .then(({ data }) => setWorkOrders(data.workOrders || []))
        .catch(() => setWorkOrders([]));
      if (isEdit && requestToEdit.items?.length > 0) {
        setItems(requestToEdit.items.map(itemFromExisting));
        setNotes(requestToEdit.notes || '');
      } else if (prefillItems && prefillItems.length > 0) {
        setItems(prefillItems.map(p => ({ ...emptyItem, ...p })));
        setNotes(prefillNotes || '');
      } else {
        setItems([{ ...emptyItem }]);
        setNotes(prefillNotes || '');
      }
      setWorkOrderId(isEdit ? (requestToEdit.isRnd ? 'RND' : (requestToEdit.workOrderId || '')) : '');
      setSpecUpload({});
      setProductSpecs({});
      specsFetched.current = new Set();
      setNoteAttachments(isEdit ? (requestToEdit.noteAttachments || []).map((a) => ({ url: a.url, name: a.name })) : []);
      setNoteUpload({ uploading: false, error: '' });
      setAddMaterialFor(null);
    }
  }, [isOpen, prefillItems, prefillNotes, requestToEdit]);

  // Fetch a catalogue material's stored spec files once per form session.
  const loadProductSpecs = async (productId) => {
    if (!productId || specsFetched.current.has(productId)) return;
    specsFetched.current.add(productId);
    try {
      const { data } = await api.get(`/products/${productId}/specs`);
      setProductSpecs((prev) => ({ ...prev, [productId]: Array.isArray(data) ? data : [] }));
    } catch {
      setProductSpecs((prev) => ({ ...prev, [productId]: [] }));
    }
  };

  // Rows can arrive already linked (edit mode / prefill) — pull their spec
  // libraries too, so those files are tickable without re-picking the material.
  useEffect(() => {
    if (!isOpen) return;
    items.forEach((i) => i.productId && loadProductSpecs(i.productId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, items]);

  // "Fabric" materials get a 2-month default required-by date (overridable).
  // 60 days clears the 15-day floor, so the default is always a legal pick.
  const fabricDefaultDate = () => {
    const now = new Date();
    return toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60));
  };
  const looksLikeFabric = (item) => {
    const hay = `${item.materialType} ${item.productName} ${item.materialSpecification}`.toLowerCase();
    return hay.includes('fabric');
  };

  const addItem = () => setItems([...items, { ...emptyItem }]);
  const removeItem = (idx) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  // Validate a picked FileList against the allowed extensions + per-file size cap.
  const validateFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return { ok: false, error: '' };
    for (const f of files) {
      if (!ATT_EXT_RE.test(f.name)) return { ok: false, error: 'Allowed: PDF, JPG, PNG, DWG, DOC, XLS, ZIP' };
      if (f.size > ATT_MAX_MB * 1024 * 1024) return { ok: false, error: `Max ${ATT_MAX_MB} MB per file` };
    }
    return { ok: true, files };
  };

  // Upload one or more files to the shared spec/note endpoint. The server stores
  // them under /uploads/pr-specs/ and returns [{url,name,mimeType}] which we stash
  // on the item (or the note) so they travel with the PR payload.
  const uploadFiles = async (files) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    const { data } = await api.post('/purchase-requests/upload-spec', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.files || (data.url ? [{ url: data.url, name: data.name }] : []);
  };

  // Append newly-uploaded spec files to a material row (multi-file, any format).
  const uploadSpec = async (idx, fileList) => {
    const v = validateFiles(fileList);
    if (!v.ok) { if (v.error) setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: v.error } })); return; }
    setSpecUpload((s) => ({ ...s, [idx]: { uploading: true, error: '' } }));
    try {
      const uploaded = await uploadFiles(v.files);
      setItems((prev) => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], attachments: [...(updated[idx].attachments || []), ...uploaded] };
        return updated;
      });
      setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: '' } }));
    } catch (err) {
      setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: err.response?.data?.error || 'Upload failed' } }));
    }
  };
  // Remove a single spec file from a row.
  const removeSpec = (idx, fileIdx) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], attachments: (updated[idx].attachments || []).filter((_, i) => i !== fileIdx) };
      return updated;
    });
  };

  // Header-level note files — same rules, stored on the PR itself.
  const uploadNoteFiles = async (fileList) => {
    const v = validateFiles(fileList);
    if (!v.ok) { if (v.error) setNoteUpload({ uploading: false, error: v.error }); return; }
    setNoteUpload({ uploading: true, error: '' });
    try {
      const uploaded = await uploadFiles(v.files);
      setNoteAttachments((prev) => [...prev, ...uploaded]);
      setNoteUpload({ uploading: false, error: '' });
    } catch (err) {
      setNoteUpload({ uploading: false, error: err.response?.data?.error || 'Upload failed' });
    }
  };
  const removeNote = (fileIdx) => setNoteAttachments((prev) => prev.filter((_, i) => i !== fileIdx));
  const updateItemFields = (idx, patch) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], ...patch };
    // Auto-fill required-by date to today+60 days when the row turns into a fabric
    // and the user hasn't already chosen a date.
    if (!updated[idx].requiredByDate && looksLikeFabric(updated[idx])) {
      updated[idx].requiredByDate = fabricDefaultDate();
    }
    setItems(updated);
  };
  const updateItem = (idx, field, value) => updateItemFields(idx, { [field]: value });

  // ── Master data linking (material picker) ──
  // A line may only ask for a material that already exists in Master Data.
  // Picking a suggestion ties the row to that material and adopts its UOM and
  // material type; typing over the description again drops the link, and an
  // unlinked line is refused at submit.
  //
  // Tools & Fixtures is the exception (mirrored on the server): a fixture is a
  // one-off made to a drawing, so those lines may be free-typed and the
  // catalogue entry is created at inward instead. Everything else on the line
  // behaves exactly as it does for any other category.
  const pickProduct = (idx, p) => {
    updateItemFields(idx, {
      productId: p.id,
      productCode: p.materialCode || p.sku || '',
      productName: p.name,
      productUnit: p.unit || items[idx].productUnit,
      materialType: items[idx].materialType || p.category || '',
    });
    loadProductSpecs(p.id);
  };
  const typeProductName = (idx, text) =>
    updateItemFields(idx, { productName: text, productId: null, productCode: '' });

  // "Add to Master Data" from a line: the new material is created for real (under
  // this user's name), then linked to the row that asked for it.
  const [addMaterialFor, setAddMaterialFor] = useState(null); // { idx, name }
  const canAddMaterial = canCreateProduct(user);
  const openAddMaterial = (idx, name) => setAddMaterialFor({ idx, name });
  const onMaterialCreated = (product) => {
    if (addMaterialFor) pickProduct(addMaterialFor.idx, product);
    setAddMaterialFor(null);
  };

  // Tick / untick one of the linked material's saved specs onto this line.
  const toggleSavedSpec = (idx, spec) => {
    const files = items[idx].attachments || [];
    const has = files.some((f) => f.url === spec.url);
    updateItemFields(idx, {
      attachments: has
        ? files.filter((f) => f.url !== spec.url)
        : [...files, { url: spec.url, name: spec.name }],
    });
  };

  const submit = async () => {
    const validItems = items.filter(i => i.productName.trim());
    if (validItems.length === 0) return alert('Pick at least one material from Master Data');
    // Every line must be linked to a Master Data material — the server refuses
    // an unlinked one, so catch it here where we can name the offending row.
    // Tools & Fixtures lines are the exception and may stay free text.
    const unlinked = validItems.find(i => !i.productId && !isFreeTextLine(i));
    if (unlinked) {
      return alert(
        `"${unlinked.productName.trim()}" is not in Master Data.\n\n` +
        'A requisition can only ask for a material that is already in Master Data. ' +
        (canAddMaterial
          ? 'Pick it from the suggestions, or use "Add to Master Data" on that line.'
          : 'Pick it from the suggestions, or ask a unit manager to add it to Master Data first.') +
        `\n\nOnly "${FREE_TEXT_MATERIAL_TYPE}" lines may be typed in directly — set the Material Type row to that if this is a fixture.`
      );
    }
    // The picker's `min` only guards clicks — a typed date still needs checking.
    const tooSoon = validItems.find(i => requiredByTooSoon(i.requiredByDate));
    if (tooSoon) {
      return alert(
        `"${tooSoon.productName.trim()}" is needed too soon. The required-by date must be at least ` +
        `${MIN_REQUIRED_BY_DAYS} days from today — pick ${requiredByMin()} or later.`
      );
    }
    setSaving(true);
    try {
      const payload = {
        notes: notes || undefined,
        noteAttachments: noteAttachments.map(a => ({ url: a.url, name: a.name, mimeType: a.mimeType })),
        unitId: undefined,
        // "RND" is the sentinel for the R&D dropdown choice — it clears the WO link.
        workOrderId: workOrderId === 'RND' ? null : (workOrderId || null),
        isRnd: workOrderId === 'RND',
        items: validItems.map(i => ({
          productName: i.productName.trim(),
          productUnit: i.productUnit || 'pcs',
          productId: i.productId,
          requestedQty: parseFloat(i.requestedQty) || 1,
          materialType: i.materialType || undefined,
          materialSpecification: i.materialSpecification || undefined,
          qapNo: i.qapNo || undefined,
          drawingNo: i.drawingNo || undefined,
          purpose: i.purpose || undefined,
          sourceOfSupply: i.sourceOfSupply || undefined,
          scopeOfWork: i.scopeOfWork || undefined,
          inspectionType: i.inspectionType || undefined,
          requiredByDate: i.requiredByDate || undefined,
          itemRemarks: i.itemRemarks || undefined,
          attachments: (i.attachments || []).map(a => ({ url: a.url, name: a.name, mimeType: a.mimeType })),
        })),
      };
      if (isEdit) {
        await api.put(`/purchase-requests/${requestToEdit.id}`, payload);
      } else {
        await api.post('/purchase-requests', payload);
      }
      onClose();
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || (isEdit ? 'Failed to update request' : 'Failed to create request'));
    }
    setSaving(false);
  };

  const unitOptions = UOM_OPTIONS;
  const today = new Date().toISOString().split('T')[0];

  // Lines with text typed but no Master Data material behind them. These block
  // the submit, so they are named on screen rather than only in the alert.
  // Free-typed Tools & Fixtures lines are legitimate and don't count here.
  const unlinkedNames = items
    .filter((i) => i.productName.trim() && !i.productId && !isFreeTextLine(i))
    .map((i) => i.productName.trim());
  // Lines that will actually be submitted: catalogue-linked ones plus free-typed
  // Tools & Fixtures.
  const linkedCount = items.filter(
    (i) => i.productId || (i.productName.trim() && isFreeTextLine(i)),
  ).length;

  // Paper-form cell styles
  const cellInput = "w-full px-1.5 py-1 text-xs border-0 focus:outline-none focus:bg-yellow-50";
  const cellSelect = "w-full px-1.5 py-1 text-xs border-0 bg-white focus:outline-none focus:bg-yellow-50";
  const labelCell = "border border-gray-400 bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 align-middle";
  const dataCell = "border border-gray-400 p-0 align-middle";
  const headerCell = "border border-gray-400 bg-gray-200 px-2 py-1 text-xs font-bold text-center";

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? `Edit Purchase Requisition — ${requestToEdit.requestNumber}` : 'New Purchase Requisition Form'} size="full">
      <div className="space-y-3">
        {/* Paper form header */}
        <div className="border border-gray-400 bg-gray-50 p-3 text-center">
          <div className="text-base font-bold text-gray-800">PURCHASE REQUISITION FORM</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Form No: RAPS/PRF • Rev. 02 • Date: 31/08/2024</div>
        </div>

        {isEdit && (
          <div className="border border-blue-300 bg-blue-50 px-3 py-2 rounded text-[11px] text-blue-900">
            You're editing a PR that is still <strong>Pending Admin</strong>. Once admin approves it,
            the request can no longer be edited.
          </div>
        )}

        {/* Header fields in 2-col grid, paper style */}
        <table className="w-full border-collapse text-xs">
          <tbody>
            <tr>
              <td className={labelCell} style={{ width: '15%' }}>PR No.</td>
              <td className={dataCell} style={{ width: '35%' }}>
                <span className="px-2 py-1 text-xs text-gray-700">
                  {isEdit ? requestToEdit.requestNumber : <span className="text-gray-500 italic">Auto-generated on submit</span>}
                </span>
              </td>
              <td className={labelCell} style={{ width: '15%' }}>Date</td>
              <td className={dataCell} style={{ width: '35%' }}>
                <span className="px-2 py-1 text-xs text-gray-700">
                  {isEdit && requestToEdit.createdAt
                    ? new Date(requestToEdit.createdAt).toISOString().split('T')[0]
                    : today}
                </span>
              </td>
            </tr>
            <tr>
              <td className={labelCell}>Unit</td>
              <td className={dataCell}>
                {isEdit ? (
                  <span className="px-2 py-1 text-xs text-gray-700">
                    {requestToEdit.unit?.name || requestToEdit.unit?.code || (
                      <span className="italic text-gray-500">Unassigned — {requestToEdit.manager?.username || requestToEdit.manager?.name || '—'}</span>
                    )}
                  </span>
                ) : isGlobalRole ? (
                  <span className="px-2 py-1 text-xs italic text-gray-600">
                    Unassigned — raised in <strong>{user?.username || user?.name || 'your'}</strong> name
                  </span>
                ) : (
                  <span className="px-2 py-1 text-xs text-gray-700">{user?.unit?.name || user?.unit?.code || '—'}</span>
                )}
              </td>
              <td className={labelCell}>Indenter</td>
              <td className={dataCell}>
                <span className="px-2 py-1 text-xs text-gray-700">
                  {isEdit ? (requestToEdit.manager?.name || '—') : (user?.name || '—')}
                </span>
              </td>
            </tr>
            <tr>
              <td className={labelCell}>Work Order</td>
              <td className={dataCell} colSpan={3}>
                <WorkOrderPicker
                  workOrders={workOrders}
                  value={workOrderId}
                  onChange={setWorkOrderId}
                  className={`${cellSelect} flex items-center gap-2 text-left`}
                  specialOptions={[{ value: 'RND', label: 'R & D', hint: '— Product research (not a work order)' }]}
                />
              </td>
            </tr>
          </tbody>
        </table>

        {/* Materials table — rows=fields, cols=materials */}
        <div className="flex items-center justify-between mt-2">
          <h4 className="text-sm font-semibold text-gray-700">Material Details</h4>
          <Button size="sm" variant="secondary" onClick={addItem}>
            <Plus size={14} className="mr-1" /> Add Material
          </Button>
        </div>

        {/* The master-data rule, stated before the first line is filled in. */}
        <div className="flex items-start gap-2 border border-navy-200 bg-navy-50 px-3 py-2 rounded text-[11px] text-navy-900">
          <Package size={12} className="mt-0.5 flex-shrink-0" />
          <div>
            <strong>Materials come from Master Data.</strong> Type in <em>Material Description</em> to
            search and pick the material — free text is not accepted.
            {canAddMaterial
              ? ' If it isn’t there yet, use "Add to Master Data" in the suggestion list; it is saved under your name and you can complete its details later.'
              : ' If it isn’t there yet, ask a unit manager to add it to Master Data first.'}
            <div className="mt-1">
              <strong>Exception — {FREE_TEXT_MATERIAL_TYPE}:</strong> set the <em>Material Type</em> row
              to “{FREE_TEXT_MATERIAL_TYPE}” and you can simply type the fixture’s name. It is
              catalogued automatically when the material is inwarded; the rest of the line works the
              same as any other material.
            </div>
          </div>
        </div>

        {/* The material-code register — which material type covers what, and the
            codes reserved for it. Collapsed; it is a lookup while filling the
            Material Type row below. */}
        <MaterialCategoryReference />

        {/* Confidentiality disclaimer for the per-item spec attachment row. */}
        <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 px-3 py-2 rounded text-[11px] text-amber-900">
          <Lock size={12} className="mt-0.5 flex-shrink-0" />
          <div>
            <strong>Confidential:</strong> The <em>Spec Attachment</em> row is optional per material.
            Uploaded specifications are stored privately on the system and shared only through
            mail / direct download links — they are not surfaced in the public PR table inside the
            downloaded PR PDF.
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs" style={{ minWidth: items.length > 2 ? `${400 + items.length * 200}px` : '100%' }}>
            <thead>
              <tr>
                <th className={headerCell} style={{ width: '180px' }}>Field</th>
                {items.map((_, idx) => (
                  <th key={idx} className={headerCell}>
                    <div className="flex items-center justify-between">
                      <span>Material-{idx + 1}</span>
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 ml-1">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={labelCell}>Material Description *</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    {/* Type to search Master Data and pick a material. Anything
                        not picked from the list is refused at submit — unless the
                        line's Material Type is Tools & Fixtures, which may be
                        free-typed. */}
                    <MaterialNameInput
                      value={item.productName}
                      productId={item.productId}
                      allowFreeText={item.materialType === FREE_TEXT_MATERIAL_TYPE}
                      freeTextLabel={FREE_TEXT_MATERIAL_TYPE}
                      onChange={(text) => typeProductName(idx, text)}
                      onPick={(p) => pickProduct(idx, p)}
                      onUnlink={() => updateItemFields(idx, { productId: null, productName: '', productCode: '' })}
                      onAddToMasterData={canAddMaterial ? (name) => openAddMaterial(idx, name) : undefined}
                      className={cellInput}
                      placeholder={item.materialType === FREE_TEXT_MATERIAL_TYPE
                        ? 'Type the fixture name…'
                        : 'Search master data...'}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Material Code</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    {item.productCode ? (
                      <span className="px-2 py-1 font-mono text-xs text-navy-800">{item.productCode}</span>
                    ) : (
                      <span
                        className="px-2 py-1 text-xs text-gray-400"
                        title={item.materialType === FREE_TEXT_MATERIAL_TYPE
                          ? 'Free-typed fixture — it gets its material code when it is catalogued at inward'
                          : 'Pick the material from Master Data to see its code'}
                      >
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Material Type</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <select value={item.materialType}
                      onChange={(e) => updateItem(idx, 'materialType', e.target.value)}
                      className={cellSelect}>
                      <option value="">—</option>
                      {/* withStoredType keeps a retired label (e.g. the old
                          un-split 'Raw Material' still on older master data)
                          selectable instead of blanking the line. */}
                      {withStoredType(PR_MATERIAL_TYPES, item.materialType)
                        .map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Material Specification</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.materialSpecification}
                      onChange={(e) => updateItem(idx, 'materialSpecification', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>
                  <div className="flex flex-col">
                    <span>Spec Attachments</span>
                    <span className="text-[10px] font-normal text-gray-500 italic mt-0.5">
                      Multiple files · any format (PDF, image, DWG, DOC, XLS, ZIP)
                    </span>
                  </div>
                </td>
                {items.map((item, idx) => {
                  const st = specUpload[idx] || {};
                  const files = item.attachments || [];
                  // Specs already stored against the linked catalogue material —
                  // tick to reuse instead of re-uploading the same drawing.
                  const saved = (item.productId && productSpecs[item.productId]) || [];
                  return (
                    <td key={idx} className={dataCell}>
                      <div className="px-1.5 py-1 space-y-1">
                        {files.map((f, fi) => (
                          <div key={f.url || fi} className="flex items-center gap-1.5">
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-navy-700 hover:underline truncate max-w-[150px]"
                              title={f.name}
                            >
                              <Paperclip size={10} /> {f.name || 'file'}
                            </a>
                            <button
                              type="button"
                              onClick={() => removeSpec(idx, fi)}
                              className="text-gray-400 hover:text-red-600"
                              title="Remove"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        <label className="inline-flex items-center gap-1 cursor-pointer text-[11px] text-gray-600 hover:text-navy-700">
                          <Upload size={11} />
                          {st.uploading ? 'Uploading…' : (files.length ? 'Add more' : 'Upload files')}
                          <input
                            type="file"
                            multiple
                            accept={ATT_ACCEPT}
                            className="hidden"
                            disabled={st.uploading}
                            onChange={(e) => { uploadSpec(idx, e.target.files); e.target.value = ''; }}
                          />
                        </label>
                        {st.error && <div className="text-[10px] text-red-600">{st.error}</div>}
                        {saved.length > 0 && (
                          <div className="mt-1 pt-1 border-t border-dashed border-gray-200">
                            <div className="text-[10px] font-semibold text-gray-500 mb-0.5">
                              Saved specs for this material
                            </div>
                            <div className="space-y-0.5">
                              {saved.map((s) => (
                                <label key={s.id || s.url} className="flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="h-3 w-3 flex-shrink-0"
                                    checked={files.some((f) => f.url === s.url)}
                                    onChange={() => toggleSavedSpec(idx, s)}
                                  />
                                  <span className="text-[11px] text-gray-700 truncate flex-1" title={s.name}>{s.name}</span>
                                  <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[10px] text-navy-700 hover:underline flex-shrink-0"
                                  >
                                    view
                                  </a>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className={labelCell}>Quantity</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="number" min={0.01} step="any" value={item.requestedQty}
                      onChange={(e) => updateItem(idx, 'requestedQty', e.target.value)}
                      className={cellInput} placeholder="Qty" />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>UOM</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <select value={item.productUnit}
                      onChange={(e) => updateItem(idx, 'productUnit', e.target.value)}
                      className={cellSelect}>
                      {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Drawing No.</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.drawingNo}
                      onChange={(e) => updateItem(idx, 'drawingNo', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>QAP No.</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.qapNo}
                      onChange={(e) => updateItem(idx, 'qapNo', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Purpose</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.purpose}
                      onChange={(e) => updateItem(idx, 'purpose', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Source of Supply</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.sourceOfSupply}
                      onChange={(e) => updateItem(idx, 'sourceOfSupply', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Reports Required / Scope of Work</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.scopeOfWork}
                      onChange={(e) => updateItem(idx, 'scopeOfWork', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Inspection Type</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <select value={item.inspectionType}
                      onChange={(e) => updateItem(idx, 'inspectionType', e.target.value)}
                      className={cellSelect}>
                      <option value="">—</option>
                      <option value="Inhouse">Inhouse</option>
                      <option value="External - RAPS QC">External - RAPS QC</option>
                      <option value="External - Customer QC">External - Customer QC</option>
                    </select>
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>
                  Required By Date
                  <div className="font-normal text-[10px] text-gray-500">min {MIN_REQUIRED_BY_DAYS} days out</div>
                </td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="date" value={item.requiredByDate}
                      min={requiredByMin()}
                      onChange={(e) => updateItem(idx, 'requiredByDate', e.target.value)}
                      className={`${cellInput} ${requiredByTooSoon(item.requiredByDate) ? 'bg-red-50 text-red-700' : ''}`} />
                    {requiredByTooSoon(item.requiredByDate) && (
                      <div className="px-1.5 pb-1 text-[10px] text-red-600">
                        On or after {requiredByMin()}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Remarks</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.itemRemarks}
                      onChange={(e) => updateItem(idx, 'itemRemarks', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Additional Notes (optional)</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-400 text-xs focus:outline-none focus:bg-yellow-50"
            rows={2} placeholder="Reason for purchase request..."
          />
          {/* Header-level note attachments — multiple files, any format. */}
          <div className="mt-1.5 border border-gray-300 rounded p-2 space-y-1 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-600">Note attachments</span>
              <label className="inline-flex items-center gap-1 cursor-pointer text-[11px] text-navy-700 hover:underline">
                <Upload size={11} />
                {noteUpload.uploading ? 'Uploading…' : (noteAttachments.length ? 'Add more' : 'Attach files')}
                <input
                  type="file"
                  multiple
                  accept={ATT_ACCEPT}
                  className="hidden"
                  disabled={noteUpload.uploading}
                  onChange={(e) => { uploadNoteFiles(e.target.files); e.target.value = ''; }}
                />
              </label>
            </div>
            {noteAttachments.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {noteAttachments.map((f, fi) => (
                  <span key={f.url || fi} className="inline-flex items-center gap-1 text-[11px]">
                    <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-navy-700 hover:underline truncate max-w-[180px]" title={f.name}>
                      <Paperclip size={10} /> {f.name || 'file'}
                    </a>
                    <button type="button" onClick={() => removeNote(fi)} className="text-gray-400 hover:text-red-600" title="Remove"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            {noteUpload.error && <div className="text-[10px] text-red-600">{noteUpload.error}</div>}
            <div className="text-[10px] text-gray-400">Any format (PDF, image, DWG, DOC, XLS, ZIP), up to {ATT_MAX_MB} MB each.</div>
          </div>
        </div>

        {/* Unlinked lines can't be submitted — say so before the button is hit. */}
        {unlinkedNames.length > 0 && (
          <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-900">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">
                Not in Master Data: {unlinkedNames.map((n) => `"${n}"`).join(', ')}.
              </span>{' '}
              A requisition can only ask for a material that is already in Master Data — pick it
              from the suggestions{canAddMaterial ? ', or use “Add to Master Data” on that line' : ''}.
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || linkedCount === 0 || unlinkedNames.length > 0}>
            {saving
              ? (isEdit ? 'Saving...' : 'Submitting...')
              : isEdit
                ? `Save Changes (${linkedCount} material${linkedCount === 1 ? '' : 's'})`
                : `Submit Request (${linkedCount} material${linkedCount === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>
    </Modal>

    {/* Sibling, not a child, of the requisition modal — a `position: fixed`
        panel nested inside another modal's scroll container is fragile. */}
    {isOpen && addMaterialFor && (
      <AddMasterMaterialModal
        initialName={addMaterialFor.name}
        onClose={() => setAddMaterialFor(null)}
        onCreated={onMaterialCreated}
      />
    )}
    </>
  );
}

// ─── Admin: Review Modal ───
function AdminReviewModal({ request, onClose, onUpdated }) {
  const [adminNotes, setAdminNotes] = useState(request?.adminNotes || '');
  const [adminDelayRemark, setAdminDelayRemark] = useState('');
  const [adjustedItems, setAdjustedItems] = useState([]);
  const [processing, setProcessing] = useState(false);
  // Hold ("send back for clarification") — the remark is the question the raiser
  // has to answer, so it's kept separate from the internal Admin Notes field.
  const [showHold, setShowHold] = useState(false);
  const [holdRemark, setHoldRemark] = useState('');

  const slaStart = request?.qcApprovedAt ? new Date(request.qcApprovedAt) : request ? new Date(request.createdAt) : null;
  const isDelayed = slaStart && (Date.now() - slaStart.getTime()) > 48 * 60 * 60 * 1000;

  useEffect(() => {
    if (request) {
      setAdminNotes(request.adminNotes || '');
      setAdminDelayRemark('');
      setShowHold(false);
      setHoldRemark('');
      setAdjustedItems(request.items.map(i => ({
        id: i.id,
        adminApprovedQty: i.adminApprovedQty != null ? i.adminApprovedQty : i.requestedQty,
      })));
    }
  }, [request]);

  const delayErr = isDelayed ? reasonError(adminDelayRemark, { fieldLabel: 'delay remark' }) : '';
  const rejectErr = reasonError(adminNotes, { fieldLabel: 'reason for rejection' });
  const holdErr = reasonError(holdRemark, { fieldLabel: 'clarification you need' });

  const approve = async () => {
    if (isDelayed && !adminDelayRemark.trim()) {
      return alert('This PR has exceeded the 48-hour SLA. Please provide a delay remark before approving.');
    }
    if (delayErr) return alert(delayErr);
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/admin-approve`, {
        adminNotes: adminNotes || undefined,
        adminDelayRemark: adminDelayRemark.trim() || undefined,
        items: adjustedItems,
      });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve');
    }
    setProcessing(false);
  };

  const reject = async () => {
    if (!adminNotes.trim()) return alert('Please provide a reason for rejection');
    if (rejectErr) return alert(rejectErr);
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/admin-reject`, { adminNotes });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
    setProcessing(false);
  };

  // Send back for clarification instead of approving or rejecting. The PR goes
  // ON_HOLD to the raiser, who answers (and may edit it) and resends.
  const hold = async () => {
    if (!holdRemark.trim()) return alert('Please write what you need clarified');
    if (holdErr) return alert(holdErr);
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/admin-hold`, { holdRemark: holdRemark.trim() });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to put the request on hold');
    }
    setProcessing(false);
  };

  const saveNotes = async () => {
    try {
      await api.put(`/purchase-requests/${request.id}/admin-update-notes`, { adminNotes });
      alert('Notes saved');
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save notes');
    }
  };

  if (!request) return null;

  const isPending = request.status === 'PENDING_ADMIN';

  return (
    <Modal isOpen={!!request} onClose={onClose} title={`${isPending ? 'Review' : 'View'} ${request.requestNumber}`} size="xl">
      <div className="space-y-4">
        {/* Info Header */}
        <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
          <div><span className="text-gray-500">Request #:</span> <span className="font-medium">{request.requestNumber}</span></div>
          <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(request.status)}>{statusLabel(request.status)}</Badge></div>
          <div><span className="text-gray-500">Manager:</span> <span className="font-medium">{request.manager?.name}</span></div>
          <div><span className="text-gray-500">Unit:</span> <Badge color="blue">{request.unit?.name}</Badge></div>
          <div><span className="text-gray-500">Created:</span> <span>{formatDateTime(request.createdAt)}</span></div>
          {request.qcApprovedBy && (
            <div><span className="text-gray-500">QC Approved By:</span> <span className="font-medium">{request.qcApprovedBy.name}</span> • <span className="text-xs">{formatDateTime(request.qcApprovedAt)}</span></div>
          )}
          {request.adminApprovedBy && (
            <div><span className="text-gray-500">Reviewed By:</span> <span className="font-medium">{request.adminApprovedBy.name}</span> • <span className="text-xs">{formatDateTime(request.adminApprovedAt)}</span></div>
          )}
        </div>

        {request.qcNotes && (
          <div className="bg-green-50 rounded-md p-3 text-sm">
            <span className="text-green-700 font-medium">QC Notes:</span> <span>{request.qcNotes}</span>
          </div>
        )}

        {(request.notes || (request.noteAttachments || []).length > 0) && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm space-y-1">
            {request.notes && (<div><span className="text-yellow-700 font-medium">Manager's Note:</span> <span>{request.notes}</span></div>)}
            <AttachmentLinks label="Note attachments:" items={request.noteAttachments} />
          </div>
        )}

        {/* Items */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Requested Items</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                {isPending ? (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approve Qty</th>
                ) : (
                  <>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Purchased</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Received</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {request.items?.map((item, idx) => {
                const approvedQty = item.adminApprovedQty || 0;
                // Sum what actually reached stores across all linked POs (direct + union allocations)
                const allPoItems = [
                  ...(request.purchaseOrders || []).flatMap(o => o.items || []),
                  ...(request.purchaseOrderSources || []).flatMap(s => s.purchaseOrder?.items || []),
                ];
                const directReceived = allPoItems
                  .filter(pi => pi.purchaseRequestItemId === item.id)
                  .reduce((s, pi) => s + (pi.receivedQty || 0), 0);
                const allocReceived = allPoItems
                  .flatMap(pi => pi.allocations || [])
                  .filter(a => a.purchaseRequestItemId === item.id)
                  .reduce((s, a) => s + (a.receivedQty || 0), 0);
                const receivedQty = directReceived + allocReceived;
                const target = item.purchasedQty || approvedQty || item.requestedQty;
                const fullyReceived = target > 0 && receivedQty >= target;
                return (
                  <tr key={item.id} className={`border-b border-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-3 py-2 font-medium text-gray-700">{item.productName}</td>
                    <td className="px-3 py-2 text-gray-500">{item.product?.category || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{item.requestedQty} {item.productUnit}</td>
                    {isPending ? (
                      <td className="px-3 py-2">
                        <Input
                          type="number" min={0} step="any"
                          value={adjustedItems[idx]?.adminApprovedQty ?? ''}
                          onChange={(e) => {
                            const newItems = [...adjustedItems];
                            newItems[idx] = { ...newItems[idx], adminApprovedQty: parseFloat(e.target.value) || 0 };
                            setAdjustedItems(newItems);
                          }}
                          className="w-28"
                        />
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-gray-600">{approvedQty} {item.productUnit}</td>
                        <td className="px-3 py-2 text-gray-600">{item.purchasedQty} {item.productUnit}</td>
                        <td className={`px-3 py-2 ${fullyReceived ? 'text-green-700 font-medium' : receivedQty > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold">
                              {fullyReceived ? `✓ ${receivedQty}` : receivedQty > 0 ? `${receivedQty}` : 'None'}
                              {target > 0 && <span className="ml-1 text-xs font-normal text-gray-400">of {target} {item.productUnit}</span>}
                            </span>
                            {!fullyReceived && target > 0 && (
                              <span className="text-[11px] text-amber-700">
                                {(target - receivedQty).toFixed(2)} {item.productUnit} {receivedQty === 0 ? 'awaiting' : 'pending'}
                              </span>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Every clarification round on this PR. Once the raiser has answered,
            Admin reads the reply here before approving. */}
        <HoldThread request={request} />

        {/* Any required-by date that was moved after the PR was raised — Admin
            approves against the deadline, so the change must be visible here. */}
        <RequiredByHistoryPanel entries={request.dateHistory} />

        {/* Admin Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <FileText size={14} className="inline mr-1" />
            Admin Notes {!isPending && '(editable)'}
          </label>
          <textarea
            value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
            rows={3} placeholder="Internal admin notes / reason for rejection..."
          />
          {isPending && adminNotes.trim() && rejectErr && (
            <p className="mt-1 text-xs font-medium text-brand-red">{rejectErr} <span className="text-gray-400">(required to reject)</span></p>
          )}
          {!isPending && (
            <Button size="sm" variant="secondary" className="mt-1" onClick={saveNotes}>Save Notes</Button>
          )}
        </div>

        {/* Saved SLA delay remark — shown once approved so everyone sees why it was late */}
        {!isPending && request.adminDelayRemark && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-0.5">⚠ Approval delayed beyond 48h — remark</p>
            <p className="text-sm text-gray-700">{request.adminDelayRemark}</p>
          </div>
        )}

        {/* 48-hour rule stated up-front for the approver */}
        {isPending && <SlaNotice action="Admin approval" />}

        {/* SLA delay remark — shown when PR has been pending more than 48h */}
        {isPending && isDelayed && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
              ⚠ SLA overdue — This PR has been awaiting admin approval for more than 48 hours.
            </p>
            <textarea
              value={adminDelayRemark}
              onChange={(e) => setAdminDelayRemark(e.target.value)}
              className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-2 bg-white ${delayErr ? 'border-red-400 focus:ring-red-400' : 'border-amber-300 focus:ring-amber-500'}`}
              rows={2}
              placeholder="Delay remark (required) — explain why approval exceeded 48 hours…"
            />
            {delayErr && <p className="text-xs font-medium text-brand-red">{delayErr}</p>}
          </div>
        )}

        {/* Hold form — opens under the buttons so the question is written in
            full before the PR leaves the queue. Deliberately not the Admin
            Notes box: this text is sent TO the raiser, not kept internally. */}
        {isPending && showHold && (
          <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-orange-900 flex items-center gap-1.5">
              <PauseCircle size={14} /> Send back for clarification
            </p>
            <p className="text-[11px] text-orange-800">
              {request.manager?.name || 'The requester'} gets this question, can edit the request,
              and resends it for approval. The PR is not rejected — it moves to the On Hold tab.
            </p>
            <textarea
              value={holdRemark}
              onChange={(e) => setHoldRemark(e.target.value)}
              className={`w-full px-3 py-2 border rounded-md text-sm bg-white focus:ring-2 ${holdRemark.trim() && holdErr ? 'border-red-400 focus:ring-red-400' : 'border-orange-300 focus:ring-orange-500'}`}
              rows={3}
              maxLength={1000}
              placeholder="What do you need clarified? e.g. Why is 200 kg needed when the last PR for this material was 20 kg?"
            />
            {holdRemark.trim() && holdErr && <p className="text-xs font-medium text-brand-red">{holdErr}</p>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between items-center pt-2 gap-3">
          <DownloadPdfButton
            document={<PRPdf request={request} />}
            fileName={`PR-${request.requestNumber}.pdf`}
            label="View PR PDF"          />
          {isPending && (
            <div className="flex gap-3">
              <Button variant="danger" onClick={reject} disabled={processing || !adminNotes.trim() || !!rejectErr}>
                <XCircle size={16} className="mr-1" /> Reject
              </Button>
              {showHold ? (
                <>
                  <Button variant="secondary" onClick={() => { setShowHold(false); setHoldRemark(''); }} disabled={processing}>
                    Cancel Hold
                  </Button>
                  <Button onClick={hold} disabled={processing || !holdRemark.trim() || !!holdErr}>
                    <PauseCircle size={16} className="mr-1" /> {processing ? 'Processing...' : 'Send Back for Clarification'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setShowHold(true)} disabled={processing}>
                    <PauseCircle size={16} className="mr-1" /> Hold for Clarification
                  </Button>
                  <Button onClick={approve} disabled={processing || (isDelayed && (!adminDelayRemark.trim() || !!delayErr))}>
                    <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : 'Approve'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Raiser: answer an admin hold and resend for approval ───
// The PR is editable while it sits ON_HOLD, so the usual flow is: read the
// question → Edit the request if the answer is a change → come back here and
// reply. Submitting puts it straight back at PENDING_ADMIN.
function HoldResponseModal({ request, onClose, onUpdated }) {
  const [response, setResponse] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => { if (request) setResponse(''); }, [request]);

  const err = reasonError(response, { fieldLabel: 'clarification' });

  const submit = async () => {
    if (!response.trim()) return alert('Please write your clarification');
    if (err) return alert(err);
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/hold-response`, { response: response.trim() });
      onClose();
      onUpdated();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to send the clarification');
    }
    setProcessing(false);
  };

  if (!request) return null;

  return (
    <Modal isOpen={!!request} onClose={onClose} title={`Respond to hold — ${request.requestNumber}`} size="lg">
      <div className="space-y-4">
        <HoldThread request={request} />

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          If the answer means changing the request itself (quantity, specification, dates),
          close this and use <span className="font-semibold">Edit</span> first — a held PR is
          still editable. Then come back and reply.
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Your clarification <span className="text-brand-red">*</span>
          </label>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            className={`w-full px-3 py-2 border rounded-md text-sm focus:ring-2 ${response.trim() && err ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-navy-500'}`}
            rows={4}
            maxLength={1000}
            placeholder="Answer the question above…"
          />
          {response.trim() && err && <p className="mt-1 text-xs font-medium text-brand-red">{err}</p>}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={processing}>Cancel</Button>
          <Button onClick={submit} disabled={processing || !response.trim() || !!err}>
            <Send size={16} className="mr-1" /> {processing ? 'Sending…' : 'Send & Resubmit for Approval'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── QC: Review Modal — first-level approval for LAB/METROLOGY/NDT PRs ───
// QC only approves/rejects with notes here; quantity adjustment stays with ADMIN.
function QcReviewModal({ request, onClose, onUpdated }) {
  const [qcNotes, setQcNotes] = useState('');
  const [qcDelayRemark, setQcDelayRemark] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (request) setQcNotes(request.qcNotes || '');
  }, [request]);

  if (!request) return null;

  const isPending = request.status === 'PENDING_QC';

  // 48-hour QC SLA — measured from when the PR was raised.
  const sla = slaRemarkState(request.createdAt, qcDelayRemark);

  const approve = async () => {
    if (sla.isDelayed && !qcDelayRemark.trim()) {
      return alert('This QC review has exceeded the 48-hour SLA. Please provide a delay remark before approving.');
    }
    if (sla.error) return alert(sla.error);
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/qc-approve`, {
        qcNotes: qcNotes || undefined,
        qcDelayRemark: qcDelayRemark.trim() || undefined,
      });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve');
    }
    setProcessing(false);
  };

  const qcRejectErr = reasonError(qcNotes, { fieldLabel: 'reason for rejection' });

  const reject = async () => {
    if (!qcNotes.trim()) return alert('Please provide a reason for rejection');
    if (qcRejectErr) return alert(qcRejectErr);
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/qc-reject`, { qcNotes });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
    setProcessing(false);
  };

  return (
    <Modal isOpen={!!request} onClose={onClose} title={`${isPending ? 'QC Review' : 'View'} ${request.requestNumber}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
          <div><span className="text-gray-500">Request #:</span> <span className="font-medium">{request.requestNumber}</span></div>
          <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(request.status)}>{statusLabel(request.status)}</Badge></div>
          <div><span className="text-gray-500">Raised By:</span> <span className="font-medium">{request.manager?.name} ({request.manager?.role})</span></div>
          <div><span className="text-gray-500">Created:</span> <span>{formatDateTime(request.createdAt)}</span></div>
          {request.qcApprovedBy && (
            <div className="col-span-2"><span className="text-gray-500">QC Reviewed By:</span> <span className="font-medium">{request.qcApprovedBy.name}</span> • <span className="text-xs">{formatDateTime(request.qcApprovedAt)}</span></div>
          )}
        </div>

        {(request.notes || (request.noteAttachments || []).length > 0) && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm space-y-1">
            {request.notes && (<div><span className="text-yellow-700 font-medium">Requester's Note:</span> <span>{request.notes}</span></div>)}
            <AttachmentLinks label="Note attachments:" items={request.noteAttachments} />
          </div>
        )}

        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Requested Items</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {request.items?.map((item, idx) => (
                <tr key={item.id} className={`border-b border-gray-100 ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'}`}>
                  <td className="px-3 py-2 font-medium text-gray-700">{item.productName}</td>
                  <td className="px-3 py-2 text-gray-500">{item.product?.category || item.materialType || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{item.requestedQty} {item.productUnit}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{item.purpose || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <FileText size={14} className="inline mr-1" />
            QC Notes
          </label>
          <textarea
            value={qcNotes} onChange={(e) => setQcNotes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
            rows={3} placeholder="QC review notes — required when rejecting..."
            disabled={!isPending}
          />
          {isPending && qcNotes.trim() && qcRejectErr && (
            <p className="mt-1 text-xs font-medium text-brand-red">{qcRejectErr} <span className="text-gray-400">(required to reject)</span></p>
          )}
        </div>

        {/* Saved QC delay remark — shown after approval so everyone sees why it was late */}
        {!isPending && request.qcDelayRemark && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-0.5">⚠ QC approval delayed beyond 48h — remark</p>
            <p className="text-sm text-gray-700">{request.qcDelayRemark}</p>
          </div>
        )}

        {/* 48-hour rule stated up-front + required remark once overdue */}
        {isPending && <SlaNotice action="QC approval" />}
        {isPending && (
          <SlaDelayRemark
            isDelayed={sla.isDelayed}
            value={qcDelayRemark}
            onChange={(e) => setQcDelayRemark(e.target.value)}
            error={sla.error}
            action="QC approval"
          />
        )}

        <div className="flex justify-between items-center pt-2 gap-3">
          <DownloadPdfButton
            document={<PRPdf request={request} />}
            fileName={`PR-${request.requestNumber}.pdf`}
            label="View PR PDF"          />
          {isPending && (
            <div className="flex gap-3">
              <Button variant="danger" onClick={reject} disabled={processing || !qcNotes.trim() || !!qcRejectErr}>
                <XCircle size={16} className="mr-1" /> Reject
              </Button>
              <Button onClick={approve} disabled={processing || sla.blocked}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : 'Approve & Forward to Admin'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Purchase Officer: Record Purchase Modal ───
function RecordPurchaseModal({ request, onClose, onUpdated }) {
  const [items, setItems] = useState([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (request) {
      setItems(request.items.map(i => ({
        id: i.id,
        productName: i.productName,
        productUnit: i.productUnit,
        approvedQty: i.adminApprovedQty || i.requestedQty,
        currentPurchased: i.purchasedQty || 0,
        newPurchasedQty: i.purchasedQty || 0,
        // Specs visible to PO so they can match the right supplier/spec.
        materialType: i.materialType,
        materialSpecification: i.materialSpecification,
        drawingNo: i.drawingNo,
        qapNo: i.qapNo,
        itemRemarks: i.itemRemarks,
      })));
    }
  }, [request]);

  const submit = async () => {
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/record-purchase`, {
        items: items.map(i => ({ id: i.id, purchasedQty: i.newPurchasedQty })),
      });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record purchase');
    }
    setProcessing(false);
  };

  if (!request) return null;

  return (
    <Modal isOpen={!!request} onClose={onClose} title={`Record Purchase — ${request.requestNumber}`} size="lg">
      <div className="space-y-4">
        <div className="bg-blue-50 rounded-md p-3 text-sm">
          <span className="text-blue-700 font-medium">Manager:</span> {request.manager?.name} •
          <span className="text-blue-700 font-medium ml-2">Unit:</span> {request.unit?.name}
          {request.notes && (
            <div className="mt-1"><span className="text-blue-700 font-medium">Note:</span> {request.notes}</div>
          )}
          {(request.noteAttachments || []).length > 0 && (
            <div className="mt-1"><AttachmentLinks label="Attachments:" items={request.noteAttachments} /></div>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved Qty</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Already Purchased</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Total Purchased</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className={`border-b border-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 align-top`}>
                <td className="px-3 py-2 font-medium text-gray-700">
                  <div>{item.productName}</div>
                  {(item.materialType || item.materialSpecification || item.drawingNo || item.qapNo || itemAttachmentList(item).length > 0) && (
                    <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                      {item.materialType && (
                        <div><span className="font-medium text-gray-600">Type:</span> {item.materialType}</div>
                      )}
                      {item.materialSpecification && (
                        <div><span className="font-medium text-gray-600">Spec:</span> {item.materialSpecification}</div>
                      )}
                      {item.drawingNo && (
                        <div><span className="font-medium text-gray-600">Drawing #:</span> {item.drawingNo}</div>
                      )}
                      {item.qapNo && (
                        <div><span className="font-medium text-gray-600">QAP #:</span> {item.qapNo}</div>
                      )}
                      <AttachmentLinks label="Spec files:" items={itemAttachmentList(item)} />
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-700">{item.approvedQty} {item.productUnit}</td>
                <td className="px-3 py-2 text-gray-500">{item.currentPurchased} {item.productUnit}</td>
                <td className="px-3 py-2">
                  <Input
                    type="number" min={0} max={item.approvedQty} step="any"
                    value={item.newPurchasedQty}
                    onChange={(e) => {
                      const newItems = [...items];
                      newItems[idx] = { ...newItems[idx], newPurchasedQty: parseFloat(e.target.value) || 0 };
                      setItems(newItems);
                    }}
                    className="w-28"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Purchase buys against the required-by date — every change to it, and
            who made it, is shown here so nobody orders to a stale deadline. */}
        <RequiredByHistoryPanel entries={request.dateHistory} />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={processing}>
            <PackageCheck size={16} className="mr-1" /> {processing ? 'Saving...' : 'Update Purchase Record'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Procurement Journey Timeline ───
function ProcurementJourney({ request }) {
  const unionPOs = (request?.purchaseOrderSources || [])
    .map(s => s.purchaseOrder)
    .filter(po => po?.isUnion);
  const activeUnionPO = unionPOs[0];
  const activePO = activeUnionPO || request?.purchaseOrders?.[0];
  const poDetail = activePO
    ? (activePO.isUnion
      ? `Union PO ${poNumberLabel(activePO)} with ${(activePO.sourceRequests?.length || 0)} units`
      : `PO: ${activePO.customName}`)
    : null;

  // PRs raised by LAB / METROLOGY / NDT carry an extra QC-approval gate before
  // they reach ADMIN. Show that stage in the tracker only for those PRs so the
  // existing flow remains unchanged for everyone else.
  const isQcGated = ['LAB', 'METROLOGY', 'NDT', 'INWARD_QC'].includes(request?.manager?.role);
  const statusOrder = [
    isQcGated
      ? { key: 'PENDING_QC', label: 'Submitted (QC Review)', detail: request?.createdAt ? formatDateTime(request.createdAt) : null }
      : { key: 'PENDING_ADMIN', label: 'Submitted', detail: request?.createdAt ? formatDateTime(request.createdAt) : null },
    ...(isQcGated ? [{ key: 'PENDING_ADMIN', label: 'QC Approved', detail: request?.qcApprovedBy ? `${request.qcApprovedBy.name} • ${formatDateTime(request.qcApprovedAt)}` : null }] : []),
    { key: 'APPROVED', label: 'Admin Approved', detail: request?.adminApprovedBy ? `${request.adminApprovedBy.name} • ${formatDateTime(request.adminApprovedAt)}` : null },
    { key: 'QUOTATION_SUBMITTED', label: 'Quotations Collected', detail: null },
    { key: 'QUOTATION_APPROVED', label: 'Quotation Approved', detail: poDetail },
    { key: 'ORDER_PLACED', label: 'Order Placed', detail: null },
    { key: 'GOODS_ARRIVED', label: 'Goods Arrived', detail: null },
    { key: 'QC_PENDING', label: 'QC Pending', detail: null },
    { key: 'QC_PASSED', label: 'QC Passed', detail: null },
    { key: 'INWARD_DONE', label: 'Inward Complete', detail: null },
    { key: 'COMPLETED', label: 'Closed', detail: null },
  ];

  let currentIndex = statusOrder.findIndex((s) => s.key === request.status);
  // PRs don't have a QC_PENDING status — the linked PO does. Reflect it here so the stage lights up.
  if (request.status === 'GOODS_ARRIVED' && activePO?.status === 'QC_PENDING') {
    currentIndex = statusOrder.findIndex((s) => s.key === 'QC_PENDING');
  }
  const effectiveIndex = request.status === 'REJECTED' ? -1 : currentIndex;

  if (request.status === 'CASH_PURCHASE') {
    return (
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
          <TrendingUp size={14} /> Procurement Journey
        </h4>
        <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-sm text-orange-900">
          <span className="font-semibold">Cash Purchase</span> — This PR was converted to a cash purchase by the Purchase Officer.
          The normal quotation and PO process has been bypassed. Stores will receive the material directly.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
        <TrendingUp size={14} /> Procurement Journey
      </h4>
      <ol className="relative border-l-2 border-gray-200 ml-2 space-y-3">
        {statusOrder.map((stage, idx) => {
          const reached = idx <= effectiveIndex;
          const isCurrent = idx === effectiveIndex;
          return (
            <li key={stage.key} className="pl-4 relative">
              <span className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 ${
                reached ? (isCurrent ? 'bg-navy-600 border-navy-600' : 'bg-green-500 border-green-500') : 'bg-white border-gray-300'
              }`} />
              <div className={`text-sm font-medium ${reached ? 'text-gray-900' : 'text-gray-400'}`}>
                {stage.label}
              </div>
              {stage.detail && reached && (
                <div className="text-xs text-gray-500">{stage.detail}</div>
              )}
            </li>
          );
        })}
        {request.status === 'REJECTED' && (
          <li className="pl-4 relative">
            <span className="absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-red-500 border-red-500" />
            <div className="text-sm font-medium text-red-600">Rejected</div>
            {request.adminNotes && <div className="text-xs text-gray-500">{request.adminNotes}</div>}
          </li>
        )}
      </ol>
    </div>
  );
}

// ─── Detail View Modal (for Managers viewing progress) ───
// `isPO` + `onReload` are required for the Pool Material flow: the PO can pool
// a PR-item with same-material items from other PRs (or undo) directly from
// this modal. After the action, parent refetches so badges + states stay in sync.
function DetailModal({ request, onClose, isPO = false, onReload }) {
  const { user } = useAuth();
  const [poolPickerItem, setPoolPickerItem] = useState(null);
  const [unpoolingId, setUnpoolingId] = useState(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closing, setClosing] = useState(false);
  const [cashConvertOpen, setCashConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  // Inline required-by editing, allowed at ANY stage. `editingRbId` is the item
  // row being retimed; the saved date goes straight to the item column, so every
  // other screen that reads it picks the new value up on its next load.
  const [editingRbId, setEditingRbId] = useState(null);
  const [rbDraft, setRbDraft] = useState('');
  const [rbSaving, setRbSaving] = useState(false);
  // The PR returned by the last date save. The parent refetches the list, but the
  // `request` prop it handed this modal stays as it was — so the new date and the
  // freshly recorded change entry are read from here while the modal is open.
  const [rbSaved, setRbSaved] = useState(null);
  // Remark editing, allowed at ANY stage — the PR-level note and each line's
  // remark. `remarkTarget` is what is open: { scope: 'PR' } or
  // { scope: 'ITEM', id }. Saved text is kept in `remarkEdits` (keyed 'PR' or
  // item id) so the open modal shows the new value immediately — the parent
  // refetches the list but the `request` prop it handed us stays as it was.
  const [remarkTarget, setRemarkTarget] = useState(null);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [remarkEdits, setRemarkEdits] = useState({});

  // This modal stays mounted between opens (it only renders null while `request`
  // is null), so switching to another PR has to clear the previous PR's edit
  // state — otherwise its saved remark would bleed into the new one.
  useEffect(() => {
    setRemarkTarget(null);
    setRemarkDraft('');
    setRemarkEdits({});
    setEditingRbId(null);
    setRbDraft('');
    setRbSaved(null);
  }, [request?.id]);

  // Who may retime a PR: the raiser, plus Admin and the purchase officer chasing
  // the delivery. Mirrors the guard on PUT /purchase-requests/:id/required-by.
  const canEditRequiredBy =
    !!request &&
    (['ADMIN', 'PURCHASE_OFFICER'].includes(user?.role) || request.managerId === user?.id);

  // Date + change trail always read through the last save, so an edit made in
  // this modal is visible without reopening it.
  //
  // Both ids must actually exist before the saved PR is treated as this PR: the
  // modal stays mounted with request === null between opens, and a bare
  // `rbSaved?.id === request?.id` is `undefined === undefined` there — i.e. true —
  // which then reads straight off the null `rbSaved`. This runs before the
  // `if (!request) return null` guard below, so it has to stand on its own.
  const rbFresh = rbSaved && request && rbSaved.id === request.id ? rbSaved : null;

  const dateHistory = (rbFresh ? rbFresh.dateHistory : request?.dateHistory) || [];
  const requiredByOf = (item) => {
    const saved = rbFresh ? (rbFresh.items || []).find((i) => i.id === item.id) : null;
    return saved ? saved.requiredByDate : item.requiredByDate;
  };

  const openRbEdit = (item) => {
    const current = requiredByOf(item);
    setEditingRbId(item.id);
    setRbDraft(current ? new Date(current).toISOString().split('T')[0] : '');
  };

  const saveRequiredBy = async (itemId) => {
    if (requiredByTooSoon(rbDraft)) {
      alert(`The required-by date must be at least ${MIN_REQUIRED_BY_DAYS} days from today — pick ${requiredByMin()} or later.`);
      return;
    }
    setRbSaving(true);
    try {
      const { data } = await api.put(`/purchase-requests/${request.id}/required-by`, {
        items: [{ id: itemId, requiredByDate: rbDraft || null }],
      });
      setRbSaved(data);
      setEditingRbId(null);
      setRbDraft('');
      onReload?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update the required-by date');
    }
    setRbSaving(false);
  };

  // Who may reword a remark: the raiser, plus Admin. Purchase and Stores are the
  // audience for the change, not the authors. Mirrors the guard on
  // PUT /purchase-requests/:id/remarks.
  const canEditRemarks =
    !!request && (user?.role === 'ADMIN' || request.managerId === user?.id);

  const headerRemark = 'PR' in remarkEdits ? remarkEdits.PR : (request?.notes || '');
  const itemRemarkOf = (item) => (item.id in remarkEdits ? remarkEdits[item.id] : (item.itemRemarks || ''));

  const openRemarkEdit = (target, current) => {
    setRemarkTarget(target);
    setRemarkDraft(current || '');
  };

  const closeRemarkEdit = () => {
    setRemarkTarget(null);
    setRemarkDraft('');
  };

  const saveRemark = async () => {
    if (!remarkTarget) return;
    const text = remarkDraft.trim();
    setRemarkSaving(true);
    try {
      await api.put(
        `/purchase-requests/${request.id}/remarks`,
        remarkTarget.scope === 'PR'
          ? { notes: text }
          : { items: [{ id: remarkTarget.id, itemRemarks: text }] },
      );
      const key = remarkTarget.scope === 'PR' ? 'PR' : remarkTarget.id;
      setRemarkEdits((prev) => ({ ...prev, [key]: text }));
      closeRemarkEdit();
      onReload?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update the remark');
    }
    setRemarkSaving(false);
  };

  const submitCashConvert = async () => {
    setConverting(true);
    try {
      await api.put(`/purchase-requests/${request.id}/convert-to-cash-purchase`);
      setCashConvertOpen(false);
      onReload?.();
      onClose?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to convert');
    }
    setConverting(false);
  };

  const canCloseThisPR =
    request &&
    !['COMPLETED', 'REJECTED'].includes(request.status) &&
    (user?.role === 'ADMIN' ||
      (['MANAGER', 'DESIGNS', 'RND', 'QC', 'INWARD_QC', 'STORE_MANAGER', 'LAB', 'METROLOGY', 'NDT', 'SAFETY', 'PLANNING'].includes(user?.role) &&
        request.managerId === user.id));

  const submitClose = async () => {
    setClosing(true);
    try {
      await api.post(`/purchase-requests/${request.id}/close`, {
        reason: closeReason.trim() || undefined,
      });
      setCloseConfirmOpen(false);
      setCloseReason('');
      onReload?.();
      onClose?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to close PR');
    }
    setClosing(false);
  };

  const unpool = async (poolId, poolItemId) => {
    if (!confirm('Remove this item from the pool? Other partners stay pooled; the pool dissolves if fewer than 2 items remain.')) return;
    setUnpoolingId(poolItemId);
    try {
      await api.delete(`/material-pools/${poolId}/items/${poolItemId}`);
      onReload?.();
      onClose?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unpool');
    }
    setUnpoolingId(null);
  };

  if (!request) return null;

  const unionPOs = (request.purchaseOrderSources || [])
    .map(s => s.purchaseOrder)
    .filter(po => po?.isUnion);
  const primaryPO = unionPOs[0] || request.purchaseOrders?.[0];

  // Map: prItemId → first union PO that has an allocation for it.
  // We also walk the PO's full allocation list to compute the FIFO queue position
  // (source-PRs in creation order) so each PR sees "you are 1st in queue" /
  // "2nd in queue (waiting on earlier PR)" — matters because partial inwards
  // now allocate FIFO by PR createdAt instead of pro-rata.
  const unionPOByItem = new Map();
  for (const po of unionPOs) {
    for (const poItem of (po.items || [])) {
      const allocs = poItem.allocations || [];
      // Build FIFO order: source-PR createdAt asc, fall back to allocation order.
      const prCreatedAt = new Map();
      for (const sr of (po.sourceRequests || [])) {
        if (sr.purchaseRequest) prCreatedAt.set(sr.purchaseRequest.id, sr.purchaseRequest.createdAt || 0);
      }
      const fifoOrdered = [...allocs].sort((a, b) => {
        const aPr = a.purchaseRequestItem?.request?.id;
        const bPr = b.purchaseRequestItem?.request?.id;
        const aT = new Date(prCreatedAt.get(aPr) || 0).getTime();
        const bT = new Date(prCreatedAt.get(bPr) || 0).getTime();
        return aT - bT;
      });
      fifoOrdered.forEach((alloc, idx) => {
        if (alloc.purchaseRequestItemId && !unionPOByItem.has(alloc.purchaseRequestItemId)) {
          // Partner PRs = source PRs other than current (request.id)
          const partnerPRs = (po.sourceRequests || [])
            .map(s => s.purchaseRequest)
            .filter(pr => pr && pr.id !== request.id);
          unionPOByItem.set(alloc.purchaseRequestItemId, {
            po, allocation: alloc, poItem, partnerPRs,
            queuePosition: idx + 1, queueSize: fifoOrdered.length,
          });
        }
      });
    }
  }

  return (
    <Modal isOpen={!!request} onClose={onClose} title={`Purchase Request ${request.requestNumber}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
          <div><span className="text-gray-500">Request #:</span> <span className="font-medium">{request.requestNumber}</span></div>
          <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(request.status)}>{statusLabel(request.status)}</Badge></div>
          <div><span className="text-gray-500">Requester:</span> <span className="font-medium">{request.manager?.name}</span></div>
          <div><span className="text-gray-500">Unit:</span> <Badge color="blue">{request.unit?.name}</Badge></div>
          {request.isRnd ? (
            <div><span className="text-gray-500">Work Order:</span> <span className="font-medium">R &amp; D (Product research)</span></div>
          ) : request.workOrder && (
            <>
              <div><span className="text-gray-500">Work Order:</span> <span className="font-medium">{request.workOrder.workOrderNumber}</span></div>
              {request.workOrder.supplyOrderNo && (
                <div><span className="text-gray-500">Supply Order No:</span> <span className="font-medium">{request.workOrder.supplyOrderNo}</span></div>
              )}
            </>
          )}
          <div><span className="text-gray-500">Created:</span> <span>{formatDateTime(request.createdAt)}</span></div>
          {request.qcApprovedBy && (
            <>
              <div><span className="text-gray-500">QC Reviewed By:</span> <span className="font-medium">{request.qcApprovedBy.name}</span></div>
              <div><span className="text-gray-500">QC Reviewed At:</span> <span>{formatDateTime(request.qcApprovedAt)}</span></div>
            </>
          )}
          {request.adminApprovedBy && (
            <>
              <div><span className="text-gray-500">Reviewed By:</span> <span className="font-medium">{request.adminApprovedBy.name}</span></div>
              <div><span className="text-gray-500">Reviewed At:</span> <span>{formatDateTime(request.adminApprovedAt)}</span></div>
            </>
          )}
          {primaryPO && (
            <div className="col-span-2 flex items-center gap-2 flex-wrap">
              <span className="text-gray-500">PO:</span>
              {/* Purchase type the PO number in by hand, so a freshly approved
                  quotation shows an order still on the 000 placeholder. */}
              {primaryPO.orderNumber
                ? <span className="font-medium">{primaryPO.orderNumber}</span>
                : <span className="font-mono text-gray-500" title="PO number not issued yet">{PO_NUMBER_PENDING_LABEL}</span>}
              <Badge color="gray">₹{primaryPO.totalAmount?.toLocaleString('en-IN')}</Badge>
              {primaryPO.isUnion && (
                <Badge color="purple">
                  <Layers size={10} className="inline mr-0.5" /> Union with {(primaryPO.sourceRequests?.length || 0)} units
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* PR-level remark — editable at any stage by the raiser or Admin. Shown
            even when empty for those two so a remark can be added later. */}
        {(headerRemark || (request.noteAttachments || []).length > 0 || canEditRemarks) && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm space-y-1">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <span className="text-yellow-700 font-medium">Notes / Remarks:</span>{' '}
                {remarkTarget?.scope === 'PR' ? (
                  <RemarkEditor
                    value={remarkDraft}
                    onChange={setRemarkDraft}
                    onSave={saveRemark}
                    onCancel={closeRemarkEdit}
                    saving={remarkSaving}
                    rows={3}
                  />
                ) : headerRemark ? (
                  <span className="whitespace-pre-wrap">{headerRemark}</span>
                ) : (
                  <span className="text-gray-400">— no remark yet —</span>
                )}
              </div>
              {canEditRemarks && remarkTarget?.scope !== 'PR' && (
                <button
                  type="button"
                  onClick={() => openRemarkEdit({ scope: 'PR' }, headerRemark)}
                  title="Edit this remark — Purchase and Stores are notified"
                  className="shrink-0 text-navy-700 hover:text-navy-900"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            <AttachmentLinks label="Note attachments:" items={request.noteAttachments} />
          </div>
        )}
        {request.adminNotes && (
          <div className="bg-blue-50 rounded-md p-3 text-sm">
            <span className="text-blue-600 font-medium">Admin Notes:</span> <span>{request.adminNotes}</span>
          </div>
        )}
        <ProcurementJourney request={request} />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Items & Procurement Status</h4>
            {request.coverageSummary && request.coverageSummary.total > 0 && (() => {
              const c = request.coverageSummary;
              const covered = c.approved;
              return (
                <div className="text-xs text-gray-600">
                  <span className="font-semibold text-gray-800">{covered} of {c.total}</span> materials covered
                  {c.awaiting > 0 && <span className="text-gray-500"> · {c.awaiting} awaiting quotation</span>}
                  {c.submitted > 0 && <span className="text-yellow-700"> · {c.submitted} pending admin</span>}
                  {c.held > 0 && <span className="text-red-700"> · {c.held} on hold</span>}
                  {c.cancelled > 0 && <span className="text-gray-500"> · {c.cancelled} cancelled</span>}
                </div>
              );
            })()}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Required By</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quotation</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Item Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Purchased</th>
              </tr>
            </thead>
            <tbody>
              {request.items?.map((item, idx) => {
                const unionRef = unionPOByItem.get(item.id);
                const poolMembership = item.materialPoolMembership;
                const pool = poolMembership?.pool;
                const partnerItems = (pool?.items || []).filter(pi => pi.purchaseRequestItemId !== item.id);
                const canPool = isPO
                  && item.itemQuotationStatus === 'AWAITING_QUOTATION'
                  && !poolMembership
                  && ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED'].includes(request.status);
                return (
                  <tr key={item.id} className={`border-b border-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 align-top`}>
                    <td className="px-3 py-2 font-medium text-gray-700">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{item.productName}</span>
                        {item.product?.sku && (
                          <Badge color="gray" title="Product SKU">{item.product.sku}</Badge>
                        )}
                        {unionRef && (
                          <Badge color="purple" title={`Part of Union PO ${poNumberLabel(unionRef.po)}`}>
                            <Layers size={10} className="inline mr-0.5" /> Union {poNumberLabel(unionRef.po)}
                          </Badge>
                        )}
                        {pool && !unionRef && (
                          <Badge color="purple" title={`Pooled with ${partnerItems.length} other PR-item(s)`}>
                            <GitMerge size={10} className="inline mr-0.5" /> Pool · {pool.status}
                          </Badge>
                        )}
                        {canPool && (
                          <Button size="sm" variant="secondary" onClick={() => setPoolPickerItem(item)} title="Pool this material with another PR">
                            <GitMerge size={12} className="mr-0.5" /> Pool
                          </Button>
                        )}
                        {isPO && pool && pool.status === 'OPEN' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={unpoolingId === poolMembership.id}
                            onClick={() => unpool(pool.id, poolMembership.id)}
                            title="Remove from pool"
                          >
                            <Unlink size={12} className="mr-0.5" /> {unpoolingId === poolMembership.id ? 'Removing…' : 'Unpool'}
                          </Button>
                        )}
                      </div>
                      {pool && partnerItems.length > 0 && !unionRef && (
                        <div className="mt-1 text-xs text-purple-900 bg-purple-50 border border-purple-200 rounded px-2 py-1">
                          <span className="font-medium">Pooled with:</span>{' '}
                          {partnerItems.map((pi, i) => (
                            <span key={pi.id}>
                              {i > 0 && ', '}
                              <span className="font-mono">{pi.purchaseRequestItem?.request?.requestNumber}</span>
                              {pi.purchaseRequestItem?.request?.unit?.code && (
                                <span className="text-purple-700"> ({pi.purchaseRequestItem.request.unit.code})</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {unionRef && (
                        <div className="mt-1 text-xs text-purple-900 bg-purple-50 border border-purple-200 rounded px-2 py-1 space-y-0.5">
                          <div>
                            <span className="font-medium">Pooled with:</span>{' '}
                            {unionRef.partnerPRs.length === 0 ? (
                              <span className="text-gray-500">(no other PRs)</span>
                            ) : (
                              unionRef.partnerPRs.map((pr, i) => (
                                <span key={pr.id}>
                                  {i > 0 && ', '}
                                  <span className="font-mono">{pr.requestNumber}</span>
                                  {pr.unit?.code && <span className="text-purple-700"> ({pr.unit.code})</span>}
                                </span>
                              ))
                            )}
                          </div>
                          <div>
                            <span className="font-medium">Your allocation:</span>{' '}
                            {unionRef.allocation.receivedQty || 0} / {unionRef.allocation.allocatedQty} {item.productUnit} received
                            {' · '}
                            <span className="font-medium">FIFO queue:</span>{' '}
                            <span className={unionRef.queuePosition === 1 ? 'text-green-700' : 'text-amber-800'}>
                              #{unionRef.queuePosition} of {unionRef.queueSize}
                            </span>
                            {unionRef.queuePosition > 1 && (unionRef.allocation.receivedQty || 0) === 0 && (
                              <span className="ml-1 text-amber-700">(waiting on earlier PR)</span>
                            )}
                          </div>
                        </div>
                      )}
                      {(item.materialType || item.materialSpecification || item.drawingNo || item.qapNo
                        || itemAttachmentList(item).length > 0 || itemRemarkOf(item) || canEditRemarks) && (
                        <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                          {/* Material code of the linked catalogue material — blank
                              on a free-typed Tools & Fixtures line. */}
                          {(item.product?.materialCode || item.product?.sku) && (
                            <div>
                              <span className="font-medium text-gray-600">Material code:</span>{' '}
                              <span className="font-mono">{item.product.materialCode || item.product.sku}</span>
                            </div>
                          )}
                          {item.materialType && (
                            <div><span className="font-medium text-gray-600">Type:</span> {item.materialType}</div>
                          )}
                          {item.materialSpecification && (
                            <div><span className="font-medium text-gray-600">Spec:</span> {item.materialSpecification}</div>
                          )}
                          {item.drawingNo && (
                            <div><span className="font-medium text-gray-600">Drawing #:</span> {item.drawingNo}</div>
                          )}
                          {item.qapNo && (
                            <div><span className="font-medium text-gray-600">QAP #:</span> {item.qapNo}</div>
                          )}
                          {/* Per-material remark — editable at any stage, same rules as the
                              PR-level one. Hidden entirely for read-only viewers with no remark. */}
                          {(() => {
                            const editing = remarkTarget?.scope === 'ITEM' && remarkTarget.id === item.id;
                            const text = itemRemarkOf(item);
                            if (!editing && !text && !canEditRemarks) return null;
                            return (
                              <div>
                                <span className="font-medium text-gray-600">Remarks:</span>{' '}
                                {editing ? (
                                  <RemarkEditor
                                    value={remarkDraft}
                                    onChange={setRemarkDraft}
                                    onSave={saveRemark}
                                    onCancel={closeRemarkEdit}
                                    saving={remarkSaving}
                                  />
                                ) : (
                                  <>
                                    <span className="whitespace-pre-wrap">{text || <span className="text-gray-400">—</span>}</span>
                                    {canEditRemarks && (
                                      <button
                                        type="button"
                                        onClick={() => openRemarkEdit({ scope: 'ITEM', id: item.id }, text)}
                                        title="Edit this material's remark — Purchase and Stores are notified"
                                        className="ml-1 align-middle text-navy-700 hover:text-navy-900"
                                      >
                                        <Pencil size={11} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })()}
                          <AttachmentLinks label="Spec files:" items={itemAttachmentList(item)} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{item.requestedQty} {item.productUnit}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {item.adminApprovedQty != null ? `${item.adminApprovedQty} ${item.productUnit}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {editingRbId === item.id ? (
                        <div className="flex flex-col gap-1">
                          <input
                            type="date"
                            value={rbDraft}
                            min={requiredByMin()}
                            onChange={(e) => setRbDraft(e.target.value)}
                            className="px-1.5 py-1 text-xs border border-gray-300 rounded"
                          />
                          <div className="flex gap-1">
                            <Button size="sm" disabled={rbSaving} onClick={() => saveRequiredBy(item.id)}>
                              {rbSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={rbSaving} onClick={() => setEditingRbId(null)}>
                              Cancel
                            </Button>
                          </div>
                          <span className="text-[10px] text-gray-500">On or after {requiredByMin()}</span>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1">
                            <span>{requiredByOf(item) ? formatDate(requiredByOf(item)) : '—'}</span>
                            {canEditRequiredBy && (
                              <button
                                type="button"
                                onClick={() => openRbEdit(item)}
                                title="Change the required-by date"
                                className="text-navy-700 hover:text-navy-900"
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                          {/* Who last moved this date, when, and from what — a
                              changed deadline must never look like the original. */}
                          <RequiredByChangeNote entries={rbHistoryFor(dateHistory, item.id)} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {item.itemQuotationStatus ? (
                        <Badge color={quotationStatusColor(item.itemQuotationStatus)}>{quotationStatusLabel(item.itemQuotationStatus)}</Badge>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {item.itemStatus ? (
                        <Badge color={itemStatusColor(item.itemStatus)}>{itemStatusLabel(item.itemStatus)}</Badge>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{item.purchasedQty || 0} {item.productUnit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Admin's clarification thread — visible to everyone on the chain so
            the reason a PR paused is never a private exchange. */}
        <HoldThread request={request} />

        <RequiredByHistoryPanel entries={dateHistory} />

        <div className="flex justify-end gap-2 pt-2">
          {canCloseThisPR && (
            <Button variant="danger" onClick={() => setCloseConfirmOpen(true)}>
              <XCircle size={16} className="mr-1" /> Close PR
            </Button>
          )}
          {isPO && request.status === 'APPROVED' && (
            <Button variant="secondary" onClick={() => setCashConvertOpen(true)}>
              Convert to Cash Purchase
            </Button>
          )}
          <DownloadPdfButton
            document={<PRPdf request={request} />}
            fileName={`PR-${request.requestNumber}.pdf`}
            label="View PR PDF"          />
        </div>
      </div>

      {closeConfirmOpen && (
        <Modal
          isOpen
          onClose={() => { if (!closing) { setCloseConfirmOpen(false); setCloseReason(''); } }}
          title="Close this Purchase Request?"
          size="md"
        >
          <div className="space-y-4">
            <div className="bg-red-50 border-l-4 border-red-500 rounded-md p-3 text-sm text-red-900">
              Closing the PR is permanent. Any items still awaiting quotations or pending
              POs will be marked <span className="font-semibold">CANCELLED</span> and the
              request will move to <span className="font-semibold">Completed</span>.
              {request.status === 'ORDER_PLACED' && (
                <div className="mt-1 text-xs">
                  An order has already been placed against this PR — closing it here will
                  not cancel the active PO; it only stops the PR from tracking further work.
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
              <textarea
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Why are you closing this PR?"
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => { setCloseConfirmOpen(false); setCloseReason(''); }}
                disabled={closing}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={submitClose} disabled={closing}>
                <XCircle size={16} className="mr-1" /> {closing ? 'Closing…' : 'Close PR'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {cashConvertOpen && (
        <Modal
          isOpen
          onClose={() => { if (!converting) setCashConvertOpen(false); }}
          title="Convert to Cash Purchase?"
          size="md"
        >
          <div className="space-y-4">
            <div className="bg-orange-50 border-l-4 border-orange-400 rounded-md p-3 text-sm text-orange-900">
              Converting this PR to a cash purchase will bypass the normal quotation and PO process.
              Stores will receive the material directly and link it to this PR.
              Any pending quotation items will be cancelled.
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setCashConvertOpen(false)} disabled={converting}>
                Cancel
              </Button>
              <Button onClick={submitCashConvert} disabled={converting}>
                {converting ? 'Converting…' : 'Convert to Cash Purchase'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {poolPickerItem && (
        <PoolPickerModal
          anchorItem={poolPickerItem}
          onClose={() => setPoolPickerItem(null)}
          onPooled={() => {
            setPoolPickerItem(null);
            onReload?.();
            onClose?.();
          }}
        />
      )}
    </Modal>
  );
}

// ─── Pool Picker Modal ───
// Lists other PR-items matching the anchor item's productName + productUnit
// that are still poolable (un-pooled, awaiting quote). Picking ≥1 partner +
// confirming creates a MaterialPool with all selected items.
function PoolPickerModal({ anchorItem, onClose, onPooled }) {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/material-pools/candidates`, { params: { purchaseRequestItemId: anchorItem.id } })
      .then(r => { if (!cancelled) setCandidates(r.data.candidates || []); })
      .catch(err => alert(err.response?.data?.error || 'Failed to load candidates'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [anchorItem.id]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      await api.post('/material-pools', {
        purchaseRequestItemIds: [anchorItem.id, ...selected],
      });
      onPooled();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create pool');
    }
    setSubmitting(false);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Pool "${anchorItem.productName}" with other PRs`} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Pick one or more PR-items that share the same material. They'll be bundled into a single pool so you can collect competing supplier quotes covering all of them at once.
        </p>
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No other PRs currently have this material awaiting a quote.</p>
        ) : (
          <div className="border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-10"></th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PR</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requester</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => {
                  const qty = c.adminApprovedQty != null ? c.adminApprovedQty : c.requestedQty;
                  return (
                    <tr key={c.id} className={`border-t border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.request.requestNumber}</td>
                      <td className="px-3 py-2">{c.request.unit?.code || c.request.unit?.name || '—'}</td>
                      <td className="px-3 py-2">{qty} {c.productUnit}</td>
                      <td className="px-3 py-2 text-gray-600">{c.request.manager?.name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={selected.size === 0 || submitting}>
            <GitMerge size={14} className="mr-1" /> {submitting ? 'Pooling…' : `Create Pool (${selected.size + 1} items)`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ───
export default function PurchaseRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createPrefill, setCreatePrefill] = useState({ items: null, notes: '' });
  const [lowStock, setLowStock] = useState([]);
  const [selectedLowStock, setSelectedLowStock] = useState(() => new Set());
  const [selectedForReview, setSelectedForReview] = useState(null);
  const [selectedForQcReview, setSelectedForQcReview] = useState(null);
  const [selectedForPurchase, setSelectedForPurchase] = useState(null);
  const [selectedForDetail, setSelectedForDetail] = useState(null);
  const [selectedForEdit, setSelectedForEdit] = useState(null);
  const [selectedForHoldResponse, setSelectedForHoldResponse] = useState(null);
  const [tab, setTab] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Unit-wise filter + free-text search. Both are applied on the SERVER (like
  // the status tab and the date range) so they narrow every matching PR, not
  // just the page currently loaded.
  const [units, setUnits] = useState([]);
  const [unitFilter, setUnitFilter] = useState('');
  const [search, setSearch] = useState('');
  // What is actually sent to the server — the box is debounced so typing a
  // request number doesn't fire a query per keystroke.
  const [searchQuery, setSearchQuery] = useState('');
  // Server-side paging — the list holds one page at a time. Status tab, unit,
  // search and date range are applied on the server too, so `total` counts the
  // whole filtered set, not just what is on screen.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const isManager = ['MANAGER', 'STORE_MANAGER', 'QC', 'INWARD_QC', 'RND', 'DESIGNS', 'LAB', 'METROLOGY', 'NDT', 'SAFETY', 'PLANNING'].includes(user?.role);
  const isStoreManager = user?.role === 'STORE_MANAGER';
  const isAdmin = user?.role === 'ADMIN';
  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isAccounting = ['ACCOUNTING', 'FINANCE'].includes(user?.role);
  const isQC = user?.role === 'QC';
  // Sub-roles whose PRs must clear QC first before reaching ADMIN.
  const isQcManaged = ['LAB', 'METROLOGY', 'NDT', 'INWARD_QC'].includes(user?.role);

  const fetchRequests = () => {
    setLoading(true);
    const params = {
      page,
      limit: PR_PAGE_SIZE,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      unitId: unitFilter || undefined,
      search: searchQuery || undefined,
    };
    if (tab !== 'ALL') params.status = tab;
    api.get('/purchase-requests', { params })
      .then(({ data }) => {
        setRequests(data.requests);
        setTotal(data.total || 0);
        const pages = Math.max(1, data.totalPages || 1);
        setTotalPages(pages);
        // Cancelling / closing the last PR on the last page can leave the current
        // page past the end — fall back to the new last page (this refetches).
        if (page > pages) setPage(pages);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRequests(); }, [tab, fromDate, toDate, unitFilter, searchQuery, page]);

  // Units for the unit-wise dropdown. Every authenticated role may read them.
  useEffect(() => {
    api.get('/units')
      .then(({ data }) => setUnits(Array.isArray(data) ? data : (data?.units || [])))
      .catch(() => setUnits([]));
  }, []);

  // Debounce the search box; the settled term is what the server sees. The term
  // and the page reset are set together so the list is fetched once, not twice.
  useEffect(() => {
    const next = search.trim();
    if (next === searchQuery) return undefined;
    const t = setTimeout(() => { setSearchQuery(next); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search, searchQuery]);

  // Changing a filter always restarts at page 1 — staying on page 4 of a list
  // that just shrank to one page shows nothing.
  const changeTab = (t) => { setTab(t); setPage(1); };
  const changeFromDate = (v) => { setFromDate(v); setPage(1); };
  const changeToDate = (v) => { setToDate(v); setPage(1); };
  const changeUnit = (v) => { setUnitFilter(v); setPage(1); };

  const filtersActive = tab !== 'ALL' || !!fromDate || !!toDate || !!unitFilter || !!search.trim();
  const clearFilters = () => {
    setTab('ALL');
    setFromDate('');
    setToDate('');
    setUnitFilter('');
    setSearch('');
    setSearchQuery('');
    setPage(1);
  };

  // Low-stock products — only fetched for STORE_MANAGER to surface the "Raise PR for low stock" quick action.
  const fetchLowStock = () => {
    if (!isStoreManager) return;
    api.get('/alerts/low-stock')
      .then(({ data }) => setLowStock(Array.isArray(data) ? data : (data?.products || [])))
      .catch(() => setLowStock([]));
  };
  useEffect(() => { fetchLowStock(); }, [isStoreManager]);

  const toggleLowStock = (id) => {
    setSelectedLowStock(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const raisePrForLowStock = () => {
    const picked = lowStock.filter(p => selectedLowStock.has(p.id));
    const source = picked.length > 0 ? picked : lowStock;
    if (source.length === 0) return;
    const items = source.map(p => {
      const deficit = Math.max(1, Math.ceil((p.minStockLevel || 0) - (p.currentStock || 0)));
      return {
        // Low-stock rows come straight from the catalogue, so they arrive
        // already linked to their Master Data material.
        productId: p.id,
        productName: p.name,
        productUnit: p.unit || 'pcs',
        requestedQty: String(deficit),
        materialType: p.category || '',
        purpose: 'Stock replenishment — below minimum level',
        itemRemarks: `Current ${p.currentStock} ${p.unit || ''} / min ${p.minStockLevel} ${p.unit || ''}`,
      };
    });
    setCreatePrefill({ items, notes: 'Auto-generated from low-stock alert' });
    setShowCreate(true);
  };

  const handleRowClick = (r) => {
    if (isQC && r.status === 'PENDING_QC') {
      setSelectedForQcReview(r);
    } else if (isAdmin) {
      setSelectedForReview(r);
    } else if (isPO) {
      setSelectedForPurchase(r);
    } else {
      setSelectedForDetail(r);
    }
  };

  const cancelRequest = async (requestId) => {
    if (!confirm('Cancel this purchase request?')) return;
    try {
      await api.put(`/purchase-requests/${requestId}/cancel`);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel');
    }
  };

  // ON_HOLD sits right after PENDING_ADMIN everywhere the approval stages are
  // shown — it is a branch off admin approval, not a stage of its own. Purchase
  // and Accounting never see it: a held PR hasn't reached them yet.
  const tabs = isPO
    ? ['ALL', 'APPROVED', 'CASH_PURCHASE', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED']
    : isAccounting
    ? ['ALL', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'COMPLETED']
    : isQC
    ? ['ALL', 'PENDING_QC', 'PENDING_ADMIN', 'ON_HOLD', 'APPROVED', 'GOODS_ARRIVED', 'QC_PASSED']
    : isQcManaged
    ? ['ALL', 'PENDING_QC', 'PENDING_ADMIN', 'ON_HOLD', 'APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED', 'REJECTED']
    : ['ALL', 'PENDING_ADMIN', 'ON_HOLD', 'APPROVED', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED', 'REJECTED'];

  // The status tab is applied server-side; this is a belt-and-braces filter for
  // the moment between switching tabs and the new page arriving.
  const filteredRequests = tab === 'ALL' ? requests : requests.filter(r => r.status === tab);

  // Filters handed to the Excel export — everything the list is narrowed by
  // except paging, so the workbook covers the whole filtered set.
  const exportParams = {
    status: tab !== 'ALL' ? tab : undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    unitId: unitFilter || undefined,
    search: searchQuery || undefined,
  };

  // "Showing 51–100 of 237" — position within the whole filtered set, not the page.
  const rangeStart = total === 0 ? 0 : (page - 1) * PR_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PR_PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <PageHero
        title={isPO ? 'Purchase Assignments' : 'Purchase Requests'}
        subtitle={isPO
          ? 'Assignments forwarded to you — collect quotations and progress them through to PO placement.'
          : 'Raise and track material purchase requests across departments.'}
        eyebrow="Procurement"
        icon={ShoppingCart}
        actions={
          <>
            <Button variant="secondary" onClick={fetchRequests} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
            {/* Exports every PR matching the current status tab and date range —
                not just the page on screen. */}
            <ExportExcelButton
              endpoint="/purchase-requests/export"
              params={exportParams}
              fileName="RAPS_Purchase_Requests.xlsx"
              disabled={loading || total === 0}
            />
            {isManager && (
              <Button onClick={() => { setCreatePrefill({ items: null, notes: '' }); setShowCreate(true); }}>
                <Plus size={16} /> New Purchase Request
              </Button>
            )}
          </>
        }
      />

      {isStoreManager && lowStock.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Layers size={14} className="text-red-600" />
                Low Stock — Replenishment Needed
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {lowStock.length} product{lowStock.length !== 1 ? 's' : ''} at or below minimum level. Raise a PR to replenish.
              </p>
            </div>
            <Button size="sm" onClick={raisePrForLowStock}>
              <Plus size={14} className="mr-1" />
              {selectedLowStock.size > 0 ? `Raise PR (${selectedLowStock.size})` : 'Raise PR for All'}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="px-2 py-1.5 text-left w-8">
                    <input
                      type="checkbox"
                      checked={selectedLowStock.size === lowStock.length && lowStock.length > 0}
                      onChange={(e) => setSelectedLowStock(e.target.checked ? new Set(lowStock.map(p => p.id)) : new Set())}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-left">Product</th>
                  <th className="px-2 py-1.5 text-left">SKU</th>
                  <th className="px-2 py-1.5 text-right">Current</th>
                  <th className="px-2 py-1.5 text-right">Min</th>
                  <th className="px-2 py-1.5 text-right">Deficit</th>
                  <th className="px-2 py-1.5 text-left">Severity</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((p, i) => (
                  <tr key={p.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selectedLowStock.has(p.id)}
                        onChange={() => toggleLowStock(p.id)}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-medium text-gray-800">{p.name}</td>
                    <td className="px-2 py-1.5 text-gray-500">{p.sku}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700">{p.currentStock} {p.unit}</td>
                    <td className="px-2 py-1.5 text-right text-gray-500">{p.minStockLevel} {p.unit}</td>
                    <td className="px-2 py-1.5 text-right text-red-700 font-medium">
                      {Math.max(0, (p.minStockLevel || 0) - (p.currentStock || 0)).toFixed(2)} {p.unit}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge color={p.severity === 'Critical' ? 'red' : 'yellow'}>{p.severity || 'Low'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {/* Status tabs */}
        {tabs.length > 1 && (
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit flex-wrap">
            {tabs.map(t => (
              <button key={t} onClick={() => changeTab(t)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >{t === 'ALL' ? 'All' : statusLabel(t)}</button>
            ))}
          </div>
        )}

        {/* Search + unit + date range. All three are server-side, so they narrow
            the whole list (and the export), not just the loaded page. */}
        <Card className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder="PR number, material, raised by, work order…"
              />
            </div>
            <div className="w-full sm:w-56">
              <label className="block text-xs font-medium text-gray-500 mb-1">Unit</label>
              <Select value={unitFilter} onChange={(e) => changeUnit(e.target.value)}>
                <option value="">All units</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>{u.name || u.code}</option>
                ))}
                <option value="NONE">Central / no unit</option>
              </Select>
            </div>
            <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={changeFromDate} onToChange={changeToDate} />
            {filtersActive && (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                <X size={14} className="mr-1" /> Clear filters
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <div>{isPO ? 'No purchase assignments available.' : 'No purchase requests found.'}</div>
            {filtersActive && (
              <button onClick={clearFilters} className="mt-2 text-sm text-navy-600 hover:text-navy-800 underline">
                Clear the filters
              </button>
            )}
          </div>
        ) : (
          <>
          <div className="px-4 pt-3 text-[13px] text-gray-500">
            Showing <span className="font-semibold text-navy-700">{rangeStart}–{rangeEnd}</span> of{' '}
            <span className="font-semibold text-navy-700">{total}</span>{' '}
            {tab === 'ALL' ? 'purchase requests' : `${statusLabel(tab)} purchase requests`}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Required By</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((r, i) => {
                  // Earliest Required By date across items
                  const requiredDates = r.items.map(it => it.requiredByDate).filter(Boolean);
                  const earliestRequired = requiredDates.length > 0
                    ? requiredDates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
                    : null;
                  const pendSince = prPendingSince(r);
                  const tatTint = tatRowClass(tatStatus(pendSince).level);

                  return (
                    <tr key={r.id} className={`border-b border-gray-100 transition-colors ${tatTint || (i % 2 === 1 ? 'bg-brand-gray' : 'bg-white')} ${tatTint ? '' : 'hover:bg-navy-50'}`}>
                      <td className="px-3 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => handleRowClick(r)}>
                        {r.requestNumber}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.manager?.name}</td>
                      <td className="px-3 py-2">
                        {r.unit?.code ? (
                          <Badge color="blue">{r.unit.code}</Badge>
                        ) : (
                          <Badge color="gray">@{r.manager?.username || r.manager?.name || 'unassigned'}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge>
                          {pendSince && <TatBadge since={pendSince} />}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">
                        {earliestRequired ? (
                          <span className={new Date(earliestRequired) < new Date() ? 'text-red-600 font-medium' : ''}>
                            {new Date(earliestRequired).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="secondary" onClick={() => setSelectedForDetail(r)}>
                            <Eye size={14} className="mr-1" /> View Details
                          </Button>
                          {isQC && r.status === 'PENDING_QC' && r.managerId !== user.id && (
                            <Button size="sm" onClick={() => setSelectedForQcReview(r)}>QC Review</Button>
                          )}
                          {isAdmin && r.status === 'PENDING_ADMIN' && (
                            <Button size="sm" onClick={() => setSelectedForReview(r)}>Review</Button>
                          )}
                          {isPO && r.status === 'APPROVED' && (
                            <Button size="sm" onClick={() => window.location.href = '/quotations'}>
                              <ShoppingCart size={14} className="mr-1" /> Add Quotes
                            </Button>
                          )}
                          {isPO && ['IN_PROGRESS'].includes(r.status) && (
                            <Button size="sm" onClick={() => setSelectedForPurchase(r)}>
                              <ShoppingCart size={14} className="mr-1" /> Update
                            </Button>
                          )}
                          {r.status === 'ON_HOLD' && (isAdmin || r.managerId === user.id) && (
                            <Button size="sm" onClick={() => setSelectedForHoldResponse(r)}>
                              <PauseCircle size={14} className="mr-1" /> Respond
                            </Button>
                          )}
                          {isManager && ['PENDING_ADMIN', 'PENDING_QC', 'ON_HOLD'].includes(r.status) && r.managerId === user.id && (
                            <Button size="sm" variant="secondary" onClick={() => setSelectedForEdit(r)}>
                              <Pencil size={14} className="mr-1" /> Edit
                            </Button>
                          )}
                          {isManager && ['PENDING_ADMIN', 'PENDING_QC', 'ON_HOLD'].includes(r.status) && r.managerId === user.id && (
                            <Button size="sm" variant="danger" onClick={() => cancelRequest(r.id)}>Cancel</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      {/* Modals */}
      <RequestFormModal
        isOpen={showCreate}
        onClose={() => { setShowCreate(false); setCreatePrefill({ items: null, notes: '' }); }}
        onSaved={() => { fetchRequests(); fetchLowStock(); setSelectedLowStock(new Set()); }}
        prefillItems={createPrefill.items}
        prefillNotes={createPrefill.notes}
      />
      <RequestFormModal
        isOpen={!!selectedForEdit}
        onClose={() => setSelectedForEdit(null)}
        onSaved={() => { setSelectedForEdit(null); fetchRequests(); }}
        requestToEdit={selectedForEdit}
      />
      <AdminReviewModal request={selectedForReview} onClose={() => setSelectedForReview(null)} onUpdated={fetchRequests} />
      <HoldResponseModal request={selectedForHoldResponse} onClose={() => setSelectedForHoldResponse(null)} onUpdated={fetchRequests} />
      <QcReviewModal request={selectedForQcReview} onClose={() => setSelectedForQcReview(null)} onUpdated={fetchRequests} />
      <RecordPurchaseModal request={selectedForPurchase} onClose={() => setSelectedForPurchase(null)} onUpdated={fetchRequests} />
      <DetailModal
        request={selectedForDetail}
        onClose={() => setSelectedForDetail(null)}
        isPO={isPO}
        onReload={fetchRequests}
      />
    </div>
  );
}
