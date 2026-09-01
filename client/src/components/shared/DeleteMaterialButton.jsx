import { useState } from 'react';
import { Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../../api/axios';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

// ─── Delete a material from Master Data ───
// Deleting is a master-owner action (Unit 1–5 managers + Admin — the same guard
// the server applies). What it does depends on whether the material has any
// history: an entry nothing points at (a mistype, a duplicate) is removed for
// real and gives its material code back; one that is named on a PR, PO, batch or
// inward entry is deactivated instead, so those documents keep reading correctly.
// The confirmation says which of the two will happen before anything is done.
//
// `onDeleted(result)` fires after a successful delete so the caller can refresh
// or navigate away.

const USAGE_LABELS = {
  purchaseRequestItems: 'purchase-requisition lines',
  mivItems: 'MIV / issue lines',
  quotationItems: 'quotation lines',
  purchaseOrderItems: 'purchase-order lines',
  transfers: 'inventory transfers',
  stockMovements: 'stock movements',
  batches: 'stock batches',
  materialPools: 'material pools',
  inwardRows: 'inward register entries',
  unitStocks: 'units holding stock',
  deptStocks: 'departments holding stock',
};

export default function DeleteMaterialButton({ product, onDeleted, iconOnly = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const start = (e) => {
    e?.stopPropagation?.();
    setOpen(true); setUsage(null); setError(''); setDone(null); setLoading(true);
    api.get(`/products/${product.id}/usage`)
      .then(({ data }) => setUsage(data))
      .catch((err) => setError(err.response?.data?.error || 'Could not check where this material is used'))
      .finally(() => setLoading(false));
  };

  const close = () => { if (!busy) setOpen(false); };

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.delete(`/products/${product.id}`);
      setDone(data);
      onDeleted?.(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete the material');
    } finally {
      setBusy(false);
    }
  };

  const used = usage
    ? Object.entries(usage.counts || {}).filter(([, n]) => n > 0)
    : [];
  const hard = usage?.canHardDelete;

  // Modal isn't portalled, so it renders where this component sits — inside a
  // clickable master-data row. `display: contents` keeps the layout untouched
  // while giving us a node to stop clicks bubbling into the row's navigation.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      {iconOnly ? (
        <button
          type="button"
          onClick={start}
          title="Delete from master data"
          className={`text-gray-400 transition-colors hover:text-brand-red ${className}`}
        >
          <Trash2 size={15} />
        </button>
      ) : (
        <Button variant="secondary" onClick={start} className={className}>
          <Trash2 size={15} /> Delete
        </Button>
      )}

      <Modal isOpen={open} onClose={close} title="Delete material from Master Data" size="md">
        {done ? (
          <div className="space-y-4">
            <div className={`flex items-start gap-2 rounded-md border-l-4 p-3 text-sm ${
              done.deleted ? 'border-green-500 bg-green-50 text-green-900' : 'border-amber-500 bg-amber-50 text-amber-900'
            }`}>
              {done.deleted ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
              <span>{done.message}</span>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              <span className="font-semibold text-navy-900">{product.name}</span>
              {(product.materialCode || product.sku) && (
                <span className="ml-1 font-mono text-xs text-gray-500">({product.materialCode || product.sku})</span>
              )}
            </p>

            {loading && <p className="text-sm text-gray-500">Checking where this material is used…</p>}
            {error && <p className="text-sm text-brand-red">{error}</p>}

            {usage && (
              hard ? (
                <div className="flex items-start gap-2 rounded-md border-l-4 border-green-500 bg-green-50 p-3 text-sm text-green-900">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Nothing references this material.</div>
                    <div className="mt-0.5 text-xs">
                      It will be removed from master data permanently and its material code
                      {' '}<span className="font-mono">{product.materialCode || product.sku}</span> becomes free again.
                      This cannot be undone.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">This material has history, so it will be deactivated instead.</div>
                    <div className="mt-0.5 text-xs">
                      It disappears from master data, the products list and every requisition picker,
                      but the documents below keep reading correctly. Its material code stays taken.
                    </div>
                    <ul className="mt-1.5 list-inside list-disc text-xs">
                      {usage.hasStock && (
                        <li><strong>{usage.product.currentStock}</strong> in stock</li>
                      )}
                      {used.map(([key, n]) => (
                        <li key={key}><strong>{n}</strong> {USAGE_LABELS[key] || key}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            )}

            <div className="flex justify-end gap-3 border-t border-gray-200 pt-3">
              <Button variant="secondary" type="button" onClick={close} disabled={busy}>Cancel</Button>
              <Button variant="danger" type="button" onClick={confirm} disabled={busy || loading || !usage}>
                {busy ? 'Working…' : hard ? 'Delete permanently' : 'Deactivate'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </span>
  );
}
