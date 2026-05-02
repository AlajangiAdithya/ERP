import { useState, useEffect } from 'react';
import { PackageX } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import { Select } from '../components/ui/Input';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function DeadStock() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('30');

  const fetchDeadStock = () => {
    setLoading(true);
    api.get('/alerts/dead-stock', { params: { days } })
      .then(({ data }) => setProducts(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDeadStock(); }, [days]);

  const totalValue = products.reduce((sum, p) => sum + (Number(p.stockValue) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dead Stock</h1>
          <p className="text-sm text-gray-500 mt-1">Products with no movement in the selected period</p>
        </div>
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-48">
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </Select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <p className="text-sm text-gray-500">Dead Stock Items</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{products.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Total Value Locked</p>
          <p className="text-2xl font-bold text-brand-red mt-1">{formatCurrency(totalValue)}</p>
        </Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-gray-400">
            <PackageX size={48} className="mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium">No dead stock</p>
            <p className="text-sm mt-1">All products have had recent movement</p>
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Product</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">SKU</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Stock</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Cost</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Value Locked</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Last Movement</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={p.id} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'}`}>
                    <td className="px-4 py-3 font-medium text-gray-700">{p.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.sku}</td>
                    <td className="px-4 py-3 text-gray-500">{p.category || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-gray-700">{Number(p.currentStock)} {p.unit}</td>
                    <td className="px-4 py-3 text-gray-500">{formatCurrency(Number(p.costPrice))}</td>
                    <td className="px-4 py-3 font-semibold text-brand-red">{formatCurrency(Number(p.stockValue))}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.lastMovement ? formatDate(p.lastMovement) : 'Never'}</td>
                    <td className="px-4 py-3"><Badge color="gray">Dead Stock</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
