import { useState, useEffect } from 'react';
import api from '../api/axios';
import { useAutoRefresh } from '../context/NotificationContext';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Pagination from '../components/shared/Pagination';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import MaterialIssuePdf from '../components/pdf/MaterialIssuePdf';
import { formatDateTime } from '../utils/formatters';
import { ScrollText } from 'lucide-react';
import PageHero from '../components/shared/PageHero';

export default function AllRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [showDetail, setShowDetail] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const refreshKey = useAutoRefresh();

  useEffect(() => {
    setLoading(true);
    api.get('/requests', { params: { status: statusFilter || undefined, page, limit: 20, fromDate: fromDate || undefined, toDate: toDate || undefined } })
      .then(({ data }) => { setRequests(data.requests); setTotalPages(data.totalPages); })
      .finally(() => setLoading(false));
  }, [page, statusFilter, fromDate, toDate, refreshKey]);

  const statusColor = (s) => ({
    PENDING: 'yellow', APPROVED: 'green', PARTIAL: 'orange', COLLECTED: 'blue', REJECTED: 'red', CANCELLED: 'gray'
  }[s] || 'gray');

  const statuses = ['', 'PENDING', 'COLLECTED', 'REJECTED', 'CANCELLED'];

  return (
    <div className="space-y-6">
      <PageHero
        title="All MIV Requests"
        subtitle="Every MIV request across the plant — filter by status and date range."
        eyebrow="Stores Oversight"
        icon={ScrollText}
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
          {statuses.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                statusFilter === s ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >{s || 'ALL'}</button>
          ))}
        </div>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={(v) => { setFromDate(v); setPage(1); }} onToChange={(v) => { setToDate(v); setPage(1); }} />
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Created</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Cleared</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Collected</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">MIV</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-4 text-center text-gray-400">No requests found</td></tr>
                  ) : requests.map((r, i) => (
                    <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => setShowDetail(r)} PrimordialIndex={i}>
                      <td className="px-3 py-2 font-medium text-navy-700">{r.requestNumber}</td>
                      <td className="px-3 py-2 text-gray-600">{r.manager?.name}</td>
                      <td className="px-3 py-2"><Badge color="blue">{r.unit?.code}</Badge></td>
                      <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                      <td className="px-3 py-2"><Badge color={statusColor(r.status)}>{r.status}</Badge></td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{r.clearedAt ? formatDateTime(r.clearedAt) : '—'}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{r.collectedAt ? formatDateTime(r.collectedAt) : '—'}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <DownloadPdfButton
                          document={<MaterialIssuePdf data={r} />}
                          fileName={`MIV-${r.issueNo || r.requestNumber}.pdf`}
                          label="MIV PDF"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Modal isOpen={!!showDetail} onClose={() => setShowDetail(null)} title={`Request ${showDetail?.requestNumber}`} size="lg">
        {showDetail && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <DownloadPdfButton
                document={<MaterialIssuePdf data={showDetail} />}
                fileName={`MIV-${showDetail.issueNo || showDetail.requestNumber}.pdf`}
                label="Download MIV PDF"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Manager:</span> <span className="font-medium">{showDetail.manager?.name}</span></div>
              <div><span className="text-gray-500">Unit:</span> <Badge color="blue">{showDetail.unit?.name}</Badge></div>
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(showDetail.status)}>{showDetail.status}</Badge></div>
              <div><span className="text-gray-500">Created:</span> <span>{formatDateTime(showDetail.createdAt)}</span></div>
              {showDetail.clearedAt && <div><span className="text-gray-500">Cleared:</span> <span>{formatDateTime(showDetail.clearedAt)}</span></div>}
              {showDetail.collectedAt && <div><span className="text-gray-500">Collected:</span> <span>{formatDateTime(showDetail.collectedAt)}</span></div>}
            </div>
            {showDetail.notes && <div className="bg-gray-50 rounded-md p-3 text-sm"><span className="text-gray-500">Notes:</span> {showDetail.notes}</div>}
            {showDetail.clearanceNotes && <div className="bg-blue-50 rounded-md p-3 text-sm"><span className="text-blue-600">Clearance:</span> {showDetail.clearanceNotes}</div>}
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved</th>
              </tr></thead>
              <tbody>
                {showDetail.items?.map((item, i) => (
                  <tr key={item.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-3 py-2 text-gray-700">{item.product?.name}</td>
                    <td className="px-3 py-2">{item.quantity} {item.product?.unit}</td>
                    <td className="px-3 py-2">{item.approvedQty != null ? `${item.approvedQty} ${item.product?.unit}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
