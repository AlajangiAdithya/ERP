import { useState, useEffect, useMemo } from 'react';
import { Plus, CheckCircle, XCircle, ShoppingCart, PackageCheck, X, FileText, TrendingUp, Layers, Eye, RefreshCw, GitMerge, Unlink, Upload, Lock, Paperclip, Pencil } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';
import PRPdf from '../components/pdf/PRPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

const statusColor = (s) => ({
  PENDING_QC: 'yellow',
  PENDING_ADMIN: 'yellow',
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
}[s] || 'gray');

const statusLabel = (s) => ({
  PENDING_QC: 'Pending QC',
  PENDING_ADMIN: 'Pending Admin',
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

// ─── Manager: Create or Edit Request (paper-table format) ───
// Dual-mode form: when `requestToEdit` is provided, the modal pre-loads its
// items + notes and submits a PUT instead of POST. Edit is gated server-side
// to PENDING_ADMIN PRs owned by the current user (or admin).
function RequestFormModal({ isOpen, onClose, onSaved, prefillItems = null, prefillNotes = '', requestToEdit = null }) {
  const { user } = useAuth();
  const isEdit = !!requestToEdit;
  const emptyItem = {
    productName: '', productUnit: 'kg', requestedQty: '',
    materialType: '', materialSpecification: '', qapNo: '', drawingNo: '',
    materialRequiredFor: '', internalWorkOrder: '',
    purpose: '', sourceOfSupply: '', scopeOfWork: '',
    inspectionType: '', requiredByDate: '', itemRemarks: '',
    // Optional confidential spec PDF — uploaded ahead of submit; URL/name carried here.
    specAttachmentUrl: '', specAttachmentName: '',
  };
  const itemFromExisting = (i) => ({
    productName: i.productName || '',
    productUnit: i.productUnit || 'pcs',
    requestedQty: i.requestedQty != null ? String(i.requestedQty) : '',
    materialType: i.materialType || '',
    materialSpecification: i.materialSpecification || '',
    qapNo: i.qapNo || '',
    drawingNo: i.drawingNo || '',
    materialRequiredFor: i.materialRequiredFor || '',
    internalWorkOrder: i.internalWorkOrder || '',
    purpose: i.purpose || '',
    sourceOfSupply: i.sourceOfSupply || '',
    scopeOfWork: i.scopeOfWork || '',
    inspectionType: i.inspectionType || '',
    requiredByDate: i.requiredByDate ? new Date(i.requiredByDate).toISOString().split('T')[0] : '',
    itemRemarks: i.itemRemarks || '',
    specAttachmentUrl: i.specAttachmentUrl || '',
    specAttachmentName: i.specAttachmentName || '',
  });
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // Per-item upload state — keyed by row index; tracks {uploading, error} so the
  // UI can show a spinner / error inline without blocking other rows.
  const [specUpload, setSpecUpload] = useState({});
  // Global-role requesters (STORE_MANAGER, DESIGNS, PLANNING, QC) raise PRs in
  // their own name with no unit attached. Unit-bound roles (MANAGER, RND) get
  // their unit auto-filled server-side. Either way the form never shows a
  // unit picker. In edit mode the unit is locked to the original PR's unit.
  const GLOBAL_ROLES = ['STORE_MANAGER', 'DESIGNS', 'PLANNING', 'QC'];
  const isGlobalRole = GLOBAL_ROLES.includes(user?.role);

  useEffect(() => {
    if (isOpen) {
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
      setSpecUpload({});
    }
  }, [isOpen, prefillItems, prefillNotes, requestToEdit]);

  // "Fabric" materials get a 2-month default required-by date (overridable).
  const fabricDefaultDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().split('T')[0];
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

  // Upload a confidential spec PDF for a single material row. The server stores
  // it under /uploads/pr-specs/ and returns the public URL — we stash both URL
  // and original filename on that item so it travels with the PR payload.
  const uploadSpec = async (idx, file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: 'PDF only' } }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: 'Max 10 MB' } }));
      return;
    }
    setSpecUpload((s) => ({ ...s, [idx]: { uploading: true, error: '' } }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/purchase-requests/upload-spec', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const updated = [...items];
      updated[idx] = { ...updated[idx], specAttachmentUrl: data.url, specAttachmentName: data.name };
      setItems(updated);
      setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: '' } }));
    } catch (err) {
      setSpecUpload((s) => ({
        ...s,
        [idx]: { uploading: false, error: err.response?.data?.error || 'Upload failed' },
      }));
    }
  };
  const clearSpec = (idx) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], specAttachmentUrl: '', specAttachmentName: '' };
    setItems(updated);
    setSpecUpload((s) => ({ ...s, [idx]: { uploading: false, error: '' } }));
  };
  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    // Auto-fill required-by date to today+60 days when the row turns into a fabric
    // and the user hasn't already chosen a date.
    if (!updated[idx].requiredByDate && looksLikeFabric(updated[idx])) {
      updated[idx].requiredByDate = fabricDefaultDate();
    }
    setItems(updated);
  };

  const submit = async () => {
    const validItems = items.filter(i => i.productName.trim());
    if (validItems.length === 0) return alert('Enter at least one material description');
    setSaving(true);
    try {
      const payload = {
        notes: notes || undefined,
        unitId: undefined,
        items: validItems.map(i => ({
          productName: i.productName.trim(),
          productUnit: i.productUnit || 'pcs',
          requestedQty: parseFloat(i.requestedQty) || 1,
          materialType: i.materialType || undefined,
          materialSpecification: i.materialSpecification || undefined,
          qapNo: i.qapNo || undefined,
          drawingNo: i.drawingNo || undefined,
          materialRequiredFor: i.materialRequiredFor || undefined,
          internalWorkOrder: i.internalWorkOrder || undefined,
          purpose: i.purpose || undefined,
          sourceOfSupply: i.sourceOfSupply || undefined,
          scopeOfWork: i.scopeOfWork || undefined,
          inspectionType: i.inspectionType || undefined,
          requiredByDate: i.requiredByDate || undefined,
          itemRemarks: i.itemRemarks || undefined,
          specAttachmentUrl: i.specAttachmentUrl || undefined,
          specAttachmentName: i.specAttachmentName || undefined,
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

  const unitOptions = ['kg', 'litre', 'pcs', 'meter', 'Sq. mtr', 'ton', 'box', 'drum', 'bag', 'roll', 'set'];
  const today = new Date().toISOString().split('T')[0];

  // Paper-form cell styles
  const cellInput = "w-full px-1.5 py-1 text-xs border-0 focus:outline-none focus:bg-yellow-50";
  const cellSelect = "w-full px-1.5 py-1 text-xs border-0 bg-white focus:outline-none focus:bg-yellow-50";
  const labelCell = "border border-gray-400 bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700 align-middle";
  const dataCell = "border border-gray-400 p-0 align-middle";
  const headerCell = "border border-gray-400 bg-gray-200 px-2 py-1 text-xs font-bold text-center";

  return (
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
          </tbody>
        </table>

        {/* Materials table — rows=fields, cols=materials */}
        <div className="flex items-center justify-between mt-2">
          <h4 className="text-sm font-semibold text-gray-700">Material Details</h4>
          <Button size="sm" variant="secondary" onClick={addItem}>
            <Plus size={14} className="mr-1" /> Add Material
          </Button>
        </div>

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
                    <input type="text" value={item.productName}
                      onChange={(e) => updateItem(idx, 'productName', e.target.value)}
                      className={cellInput} placeholder="Description..." />
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
                      <option value="Raw Material">Raw Material</option>
                      <option value="Consumable">Consumable</option>
                      <option value="Hand Tools & Fastners">Hand Tools & Fastners</option>
                      <option value="Tools & Fixtures">Tools & Fixtures</option>
                      <option value="Others">Others</option>
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
                    <span>Spec Attachment (PDF)</span>
                    <span className="text-[10px] font-normal text-gray-500 italic mt-0.5 flex items-center gap-1">
                      <Lock size={9} /> Confidential — share via mail
                    </span>
                  </div>
                </td>
                {items.map((item, idx) => {
                  const st = specUpload[idx] || {};
                  const hasFile = !!item.specAttachmentUrl;
                  return (
                    <td key={idx} className={dataCell}>
                      <div className="px-1.5 py-1 flex items-center gap-1.5">
                        {hasFile ? (
                          <>
                            <a
                              href={item.specAttachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-navy-700 hover:underline truncate max-w-[140px]"
                              title={item.specAttachmentName}
                            >
                              <Paperclip size={10} /> {item.specAttachmentName || 'spec.pdf'}
                            </a>
                            <button
                              type="button"
                              onClick={() => clearSpec(idx)}
                              className="text-gray-400 hover:text-red-600"
                              title="Remove"
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <label className="inline-flex items-center gap-1 cursor-pointer text-[11px] text-gray-600 hover:text-navy-700">
                            <Upload size={11} />
                            {st.uploading ? 'Uploading…' : 'Upload PDF'}
                            <input
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              disabled={st.uploading}
                              onChange={(e) => uploadSpec(idx, e.target.files?.[0])}
                            />
                          </label>
                        )}
                        {st.error && <span className="text-[10px] text-red-600">{st.error}</span>}
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
                <td className={labelCell}>Required For (SO/R&D)</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.materialRequiredFor}
                      onChange={(e) => updateItem(idx, 'materialRequiredFor', e.target.value)}
                      className={cellInput} />
                  </td>
                ))}
              </tr>
              <tr>
                <td className={labelCell}>Internal Work Order</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="text" value={item.internalWorkOrder}
                      onChange={(e) => updateItem(idx, 'internalWorkOrder', e.target.value)}
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
                <td className={labelCell}>Required By Date</td>
                {items.map((item, idx) => (
                  <td key={idx} className={dataCell}>
                    <input type="date" value={item.requiredByDate}
                      onChange={(e) => updateItem(idx, 'requiredByDate', e.target.value)}
                      className={cellInput} />
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
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || items.every(i => !i.productName.trim())}>
            {saving
              ? (isEdit ? 'Saving...' : 'Submitting...')
              : isEdit
                ? `Save Changes (${items.filter(i => i.productName.trim()).length} material${items.filter(i => i.productName.trim()).length === 1 ? '' : 's'})`
                : `Submit Request (${items.filter(i => i.productName.trim()).length} material${items.filter(i => i.productName.trim()).length === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Admin: Review Modal ───
function AdminReviewModal({ request, onClose, onUpdated }) {
  const [adminNotes, setAdminNotes] = useState(request?.adminNotes || '');
  const [adjustedItems, setAdjustedItems] = useState([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (request) {
      setAdminNotes(request.adminNotes || '');
      setAdjustedItems(request.items.map(i => ({
        id: i.id,
        adminApprovedQty: i.adminApprovedQty != null ? i.adminApprovedQty : i.requestedQty,
      })));
    }
  }, [request]);

  const approve = async () => {
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/admin-approve`, {
        adminNotes: adminNotes || undefined,
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

        {request.notes && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm">
            <span className="text-yellow-700 font-medium">Manager's Note:</span> <span>{request.notes}</span>
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

        {/* Admin Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            <FileText size={14} className="inline mr-1" />
            Admin Notes {!isPending && '(editable)'}
          </label>
          <textarea
            value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
            rows={3} placeholder="Internal admin notes..."
          />
          {!isPending && (
            <Button size="sm" variant="secondary" className="mt-1" onClick={saveNotes}>Save Notes</Button>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-between items-center pt-2 gap-3">
          <DownloadPdfButton
            document={<PRPdf request={request} />}
            fileName={`PR-${request.requestNumber}.pdf`}
            label="View PR PDF"
            appendPdfs={(request.items || []).map(i => i.specAttachmentUrl).filter(Boolean)}
          />
          {isPending && (
            <div className="flex gap-3">
              <Button variant="danger" onClick={reject} disabled={processing}>
                <XCircle size={16} className="mr-1" /> Reject
              </Button>
              <Button onClick={approve} disabled={processing}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : 'Approve'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── QC: Review Modal — first-level approval for LAB/METROLOGY/NDT PRs ───
// QC only approves/rejects with notes here; quantity adjustment stays with ADMIN.
function QcReviewModal({ request, onClose, onUpdated }) {
  const [qcNotes, setQcNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (request) setQcNotes(request.qcNotes || '');
  }, [request]);

  if (!request) return null;

  const isPending = request.status === 'PENDING_QC';

  const approve = async () => {
    setProcessing(true);
    try {
      await api.put(`/purchase-requests/${request.id}/qc-approve`, {
        qcNotes: qcNotes || undefined,
      });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve');
    }
    setProcessing(false);
  };

  const reject = async () => {
    if (!qcNotes.trim()) return alert('Please provide a reason for rejection');
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

        {request.notes && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm">
            <span className="text-yellow-700 font-medium">Requester's Note:</span> <span>{request.notes}</span>
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
                  <td className="px-3 py-2 text-gray-500 text-xs">{item.purpose || item.materialRequiredFor || '—'}</td>
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
        </div>

        <div className="flex justify-between items-center pt-2 gap-3">
          <DownloadPdfButton
            document={<PRPdf request={request} />}
            fileName={`PR-${request.requestNumber}.pdf`}
            label="View PR PDF"
            appendPdfs={(request.items || []).map(i => i.specAttachmentUrl).filter(Boolean)}
          />
          {isPending && (
            <div className="flex gap-3">
              <Button variant="danger" onClick={reject} disabled={processing}>
                <XCircle size={16} className="mr-1" /> Reject
              </Button>
              <Button onClick={approve} disabled={processing}>
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
                  {(item.materialType || item.materialSpecification || item.drawingNo || item.qapNo || item.specAttachmentUrl) && (
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
                      {item.specAttachmentUrl && (
                        <div>
                          <span className="font-medium text-gray-600">Spec PDF:</span>{' '}
                          <a
                            href={item.specAttachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-navy-700 hover:underline"
                          >
                            <Paperclip size={10} /> {item.specAttachmentName || 'View'}
                          </a>
                        </div>
                      )}
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
      ? `Union PO ${activePO.orderNumber} with ${(activePO.sourceRequests?.length || 0)} units`
      : `PO: ${activePO.customName}`)
    : null;

  // PRs raised by LAB / METROLOGY / NDT carry an extra QC-approval gate before
  // they reach ADMIN. Show that stage in the tracker only for those PRs so the
  // existing flow remains unchanged for everyone else.
  const isQcGated = ['LAB', 'METROLOGY', 'NDT'].includes(request?.manager?.role);
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

  const canCloseThisPR =
    request &&
    !['COMPLETED', 'REJECTED'].includes(request.status) &&
    (user?.role === 'ADMIN' ||
      (['MANAGER', 'DESIGNS', 'RND', 'QC', 'STORE_MANAGER', 'PLANNING'].includes(user?.role) &&
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
              <span className="font-medium">{primaryPO.orderNumber}</span>
              <Badge color="gray">₹{primaryPO.totalAmount?.toLocaleString('en-IN')}</Badge>
              {primaryPO.isUnion && (
                <Badge color="purple">
                  <Layers size={10} className="inline mr-0.5" /> Union with {(primaryPO.sourceRequests?.length || 0)} units
                </Badge>
              )}
            </div>
          )}
        </div>

        {request.notes && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm">
            <span className="text-yellow-700 font-medium">Your Note:</span> <span>{request.notes}</span>
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
                          <Badge color="purple" title={`Part of Union PO ${unionRef.po.orderNumber}`}>
                            <Layers size={10} className="inline mr-0.5" /> Union {unionRef.po.orderNumber}
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
                      {(item.materialType || item.materialSpecification || item.drawingNo || item.qapNo || item.specAttachmentUrl) && (
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
                          {item.specAttachmentUrl && (
                            <div>
                              <span className="font-medium text-gray-600">Spec PDF:</span>{' '}
                              <a
                                href={item.specAttachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-navy-700 hover:underline"
                              >
                                <Paperclip size={10} /> {item.specAttachmentName || 'View'}
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{item.requestedQty} {item.productUnit}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {item.adminApprovedQty != null ? `${item.adminApprovedQty} ${item.productUnit}` : '—'}
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

        <div className="flex justify-end gap-2 pt-2">
          {canCloseThisPR && (
            <Button variant="danger" onClick={() => setCloseConfirmOpen(true)}>
              <XCircle size={16} className="mr-1" /> Close PR
            </Button>
          )}
          <DownloadPdfButton
            document={<PRPdf request={request} />}
            fileName={`PR-${request.requestNumber}.pdf`}
            label="View PR PDF"
            appendPdfs={(request.items || []).map(i => i.specAttachmentUrl).filter(Boolean)}
          />
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
  const [tab, setTab] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const isManager = ['MANAGER', 'PLANNING', 'STORE_MANAGER', 'QC', 'RND', 'DESIGNS', 'LAB', 'METROLOGY', 'NDT'].includes(user?.role);
  const isStoreManager = user?.role === 'STORE_MANAGER';
  const isAdmin = user?.role === 'ADMIN';
  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isAccounting = ['ACCOUNTING', 'FINANCE'].includes(user?.role);
  const isQC = user?.role === 'QC';
  // Sub-roles whose PRs must clear QC first before reaching ADMIN.
  const isQcManaged = ['LAB', 'METROLOGY', 'NDT'].includes(user?.role);

  const fetchRequests = () => {
    setLoading(true);
    const params = { limit: 50, fromDate: fromDate || undefined, toDate: toDate || undefined };
    if (tab !== 'ALL' && !isPO) params.status = tab;
    api.get('/purchase-requests', { params })
      .then(({ data }) => setRequests(data.requests))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRequests(); }, [tab, fromDate, toDate]);

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

  const tabs = isPO
    ? ['ALL', 'APPROVED', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED']
    : isAccounting
    ? ['ALL', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'COMPLETED']
    : isQC
    ? ['ALL', 'PENDING_QC', 'PENDING_ADMIN', 'APPROVED', 'GOODS_ARRIVED', 'QC_PASSED']
    : isQcManaged
    ? ['ALL', 'PENDING_QC', 'PENDING_ADMIN', 'APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED', 'REJECTED']
    : ['ALL', 'PENDING_ADMIN', 'APPROVED', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED', 'REJECTED'];

  const filteredRequests = tab === 'ALL' ? requests : requests.filter(r => r.status === tab);

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

      <div className="flex flex-wrap items-end gap-4">
        {/* Tabs */}
        {tabs.length > 1 && (
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit flex-wrap">
            {tabs.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >{t === 'ALL' ? 'All' : statusLabel(t)}</button>
            ))}
          </div>
        )}
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            {isPO ? 'No purchase assignments available.' : 'No purchase requests found.'}
          </div>
        ) : (
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

                  return (
                    <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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
                      <td className="px-3 py-2"><Badge color={statusColor(r.status)}>{statusLabel(r.status)}</Badge></td>
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
                          {isManager && (r.status === 'PENDING_ADMIN' || r.status === 'PENDING_QC') && r.managerId === user.id && (
                            <Button size="sm" variant="secondary" onClick={() => setSelectedForEdit(r)}>
                              <Pencil size={14} className="mr-1" /> Edit
                            </Button>
                          )}
                          {isManager && (r.status === 'PENDING_ADMIN' || r.status === 'PENDING_QC') && r.managerId === user.id && (
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
