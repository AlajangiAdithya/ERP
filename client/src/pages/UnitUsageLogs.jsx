import { useState, useEffect } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Pagination from '../components/shared/Pagination';
import { Select } from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';

export default function UnitUsageLogs() {
  const [movements, setMovements] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [unitFilter, setUnitFilter] = useState('');

  useEffect(() => {
    api.get('/units').then(({ data }) => setUnits(data));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = {
      page, limit: 25,
      unitId: unitFilter || undefined,
    };
    api.get('/reports/unit-usage', { params })
      .then(({ data }) => {
        setMovements(data.movements);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page, unitFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Unit Usage Logs</h1>
        <span className="text-sm text-gray-500">{total} total entries</span>
      </div>

      <div className="flex gap-3">
        <Select value={unitFilter} onChange={(e) => { setUnitFilter(e.target.value); setPage(1); }} className="w-56">
          <option value="">All Units</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No usage data found</td></tr>
                  ) : movements.map(m => (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2 font-medium text-gray-700">{m.managerName}</td>
                      <td className="px-3 py-2"><Badge color="blue">{m.unitCode}</Badge></td>
                      <td className="px-3 py-2 text-navy-700 font-medium">{m.requestNumber}</td>
                      <td className="px-3 py-2 text-gray-700">{m.product?.name}</td>
                      <td className="px-3 py-2 text-gray-500">{m.product?.category || '—'}</td>
                      <td className="px-3 py-2 text-gray-700 font-medium">{m.quantity} {m.product?.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
