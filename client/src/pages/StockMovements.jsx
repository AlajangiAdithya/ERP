import { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, RefreshCw, BarChart3 } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import { Select } from '../components/ui/Input';
import Pagination from '../components/shared/Pagination';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import { formatDateTime, formatNotes } from '../utils/formatters';
import StockStatementPdf from '../components/pdf/StockStatementPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

export default function StockMovements() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exportList, setExportList] = useState([]);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/inventory/movements', { params: { page, limit: 25, type: typeFilter || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined } })
      .then(({ data }) => { setMovements(data.movements); setTotalPages(data.totalPages); })
      .finally(() => setLoading(false));
  }, [page, typeFilter, fromDate, toDate]);

  const prepareExport = async () => {
    setExportLoading(true);
    try {
      const { data } = await api.get('/inventory/movements', {
        params: { page: 1, limit: 1000, type: typeFilter || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined },
      });
      setExportList(data.movements || []);
    } catch (err) {
      console.error(err);
      setExportList([]);
    }
    setExportLoading(false);
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="Stock Movements"
        subtitle="Inward, outward, and adjustment movements across all stores."
        eyebrow="Inventory"
        icon={BarChart3}
      />

      <div className="flex flex-wrap gap-3 items-end">
        <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="w-40">
          <option value="">All Types</option>
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
          <option value="ADJUSTMENT">ADJUSTMENT</option>
        </Select>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={(v) => { setFromDate(v); setPage(1); }} onToChange={(v) => { setToDate(v); setPage(1); }} />
        <div className="flex gap-2 items-center">
          {exportList.length === 0 ? (
            <button
              onClick={prepareExport}
              disabled={exportLoading}
              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
            >
              {exportLoading ? 'Preparing…' : 'Prepare PDF'}
            </button>
          ) : (
            <DownloadPdfButton
              document={<StockStatementPdf movements={exportList} filters={{ fromDate, toDate, typeFilter }} />}
              fileName={`stock-statement-${new Date().toISOString().slice(0, 10)}.pdf`}
              label={`View (${exportList.length})`}
            />
          )}
          {exportList.length > 0 && (
            <button
              onClick={() => setExportList([])}
              className="text-xs text-gray-500 hover:text-gray-700"
              title="Clear prepared export"
            >
              Reset
            </button>
          )}
        </div>
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">SKU</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quantity</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Batch</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Reference</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">No movements found</td></tr>
                  ) : movements.map(m => (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2 font-medium text-gray-700">{m.product?.name}</td>
                      <td className="px-3 py-2 text-gray-500">{m.product?.sku}</td>
                      <td className="px-3 py-2">
                        <Badge color={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'red' : 'yellow'}>
                          {m.type === 'IN' && <ArrowDown size={10} className="inline mr-1" />}
                          {m.type === 'OUT' && <ArrowUp size={10} className="inline mr-1" />}
                          {m.type === 'ADJUSTMENT' && <RefreshCw size={10} className="inline mr-1" />}
                          {m.type}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-gray-700 font-medium">{m.quantity} {m.product?.unit}</td>
                      <td className="px-3 py-2 font-mono text-xs text-amber-800">
                        {m.batchNumber || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{m.referenceType || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate" title={formatNotes(m.notes)}>{formatNotes(m.notes)}</td>
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
