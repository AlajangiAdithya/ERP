import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Warehouse, MapPin, User, Phone, Mail, Package, Pencil, Save, X } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import SearchBar from '../components/shared/SearchBar';

export default function WarehouseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [warehouse, setWarehouse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingBin, setEditingBin] = useState(null);
  const [binValue, setBinValue] = useState('');
  const [savingBin, setSavingBin] = useState(false);

  const fetchWarehouse = () => {
    setLoading(true);
    api.get(`/warehouses/${id}`)
      .then(({ data }) => setWarehouse(data))
      .catch(() => navigate('/warehouses'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchWarehouse(); }, [id]);

  const handleBinSave = async (productId) => {
    setSavingBin(true);
    try {
      await api.put(`/warehouses/${id}/stock`, { productId, binLocation: binValue });
      setEditingBin(null);
      fetchWarehouse();
    } catch (err) {
      alert('Failed to update bin location');
    } finally {
      setSavingBin(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!warehouse) return null;

  const stocks = warehouse.warehouseStocks.filter(s =>
    !search || s.product.name.toLowerCase().includes(search.toLowerCase()) ||
    s.product.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/warehouses')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-700 transition-colors">
        <ArrowLeft size={16} /> Back to Warehouses
      </button>

      {/* Warehouse Info */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="p-3 bg-navy-50 rounded-lg text-navy-700">
            <Warehouse size={28} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{warehouse.name}</h1>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
              {warehouse.address && <span className="flex items-center gap-1"><MapPin size={14} /> {warehouse.address}</span>}
              {warehouse.contactPerson && <span className="flex items-center gap-1"><User size={14} /> {warehouse.contactPerson}</span>}
              {warehouse.phone && <span className="flex items-center gap-1"><Phone size={14} /> {warehouse.phone}</span>}
              {warehouse.email && <span className="flex items-center gap-1"><Mail size={14} /> {warehouse.email}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400">Total Products</p>
            <p className="text-2xl font-bold text-navy-700">{stocks.length}</p>
          </div>
        </div>
      </Card>

      {/* Stock Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Inventory in this Warehouse</h3>
          <div className="w-64">
            <SearchBar value={search} onChange={setSearch} placeholder="Search products..." />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">SKU</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Product</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Quantity</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Bin / Rack</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider text-xs">Actions</th>
              </tr>
            </thead>
            <tbody>
              {stocks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    <Package size={32} className="mx-auto mb-2 opacity-50" />
                    No products in this warehouse
                  </td>
                </tr>
              ) : (
                stocks.map((stock, i) => (
                  <tr key={stock.id} className={`border-b border-gray-100 ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'}`}>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{stock.product.sku}</td>
                    <td className="px-4 py-3 text-gray-700 font-medium">{stock.product.name}</td>
                    <td className="px-4 py-3 text-gray-500">{stock.product.category || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{stock.quantity}</span>
                      <span className="text-gray-400 ml-1">{stock.product.unit}</span>
                    </td>
                    <td className="px-4 py-3">
                      {editingBin === stock.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={binValue}
                            onChange={(e) => setBinValue(e.target.value)}
                            className="w-40 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-500"
                            placeholder="e.g., Rack A3, Shelf 2"
                            autoFocus
                          />
                          <button onClick={() => handleBinSave(stock.productId)} disabled={savingBin} className="p-1 text-green-600 hover:bg-green-50 rounded">
                            <Save size={14} />
                          </button>
                          <button onClick={() => setEditingBin(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-500">{stock.binLocation || '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingBin !== stock.id && (
                        <button
                          onClick={() => { setEditingBin(stock.id); setBinValue(stock.binLocation || ''); }}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-navy-700"
                          title="Edit bin location"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
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
