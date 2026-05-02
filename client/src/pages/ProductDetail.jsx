import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, ArrowDown, ArrowUp, Layers } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { formatDate, formatDateTime, formatNotes } from '../utils/formatters';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/products/${id}`),
      api.get(`/inventory/batches?productId=${id}`),
    ])
      .then(([productRes, batchesRes]) => {
        setProduct(productRes.data);
        setBatches(batchesRes.data?.batches || []);
      })
      .catch(() => navigate('/products'))
      .finally(() => setLoading(false));
  }, [id]);

  const activeBatches = batches.filter(b => b.remaining > 0);
  const daysOld = (d) => Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) return null;

  const stockPercentage = product.minStockLevel > 0
    ? Math.min(100, (product.currentStock / product.minStockLevel) * 100)
    : 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => navigate('/products')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
      </div>

      {/* Product Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">SKU:</span> <span className="font-medium">{product.sku}</span></div>
            <div><span className="text-gray-500">Category:</span> <span className="font-medium">{product.category || '—'}</span></div>
            <div><span className="text-gray-500">Unit:</span> <span className="font-medium">{product.unit}</span></div>
            {product.description && (
              <div className="col-span-2"><span className="text-gray-500">Description:</span> <span>{product.description}</span></div>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Stock Status</h3>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{product.currentStock}</p>
            <p className="text-sm text-gray-500">{product.unit}</p>
            {product.minStockLevel > 0 && (
              <>
                <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      stockPercentage < 50 ? 'bg-red-500' : stockPercentage < 100 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, stockPercentage)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Min level: {product.minStockLevel} {product.unit}</p>
              </>
            )}
            {product.maxStockLevel && (
              <p className="text-xs text-gray-400">Max level: {product.maxStockLevel} {product.unit}</p>
            )}
          </div>
        </Card>
      </div>

      {/* FIFO Batches */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Layers size={16} className="text-navy-700" />
          <h3 className="text-sm font-semibold text-gray-700">FIFO Batches <span className="text-xs font-normal text-gray-400">(oldest first — consumed first on issue)</span></h3>
        </div>
        {batches.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No batch records yet. Newly inwarded stock will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Received</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Age</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Batch No</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Received Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Remaining</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => {
                  const age = daysOld(b.receivedDate);
                  const depleted = b.remaining === 0;
                  const partial = b.remaining > 0 && b.remaining < b.quantity;
                  return (
                    <tr key={b.id} className={`border-b border-gray-50 ${depleted ? 'bg-gray-50 text-gray-400' : ''}`}>
                      <td className="px-3 py-2 text-xs">{formatDate(b.receivedDate)}</td>
                      <td className="px-3 py-2 text-xs">{age}d</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.batchNo || <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-2 text-right">{b.quantity} {product.unit}</td>
                      <td className="px-3 py-2 text-right font-semibold">{b.remaining} {product.unit}</td>
                      <td className="px-3 py-2">
                        {depleted ? <Badge color="gray">Depleted</Badge>
                          : partial ? <Badge color="yellow">Partial</Badge>
                          : <Badge color="green">Full</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {activeBatches.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 font-semibold text-sm">
                    <td colSpan={4} className="px-3 py-2 text-right">Active total:</td>
                    <td className="px-3 py-2 text-right">{activeBatches.reduce((s, b) => s + b.remaining, 0)} {product.unit}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>

      {/* Stock History */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Stock Movements</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quantity</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Reference</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody>
              {product.stockMovements?.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No stock movements</td></tr>
              ) : (
                product.stockMovements?.map(m => (
                  <tr key={m.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(m.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Badge color={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'red' : 'yellow'}>
                        {m.type === 'IN' && <ArrowDown size={10} className="inline mr-1" />}
                        {m.type === 'OUT' && <ArrowUp size={10} className="inline mr-1" />}
                        {m.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-medium">{m.quantity} {product.unit}</td>
                    <td className="px-3 py-2 text-gray-600">{m.referenceType || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate" title={formatNotes(m.notes)}>{formatNotes(m.notes)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
