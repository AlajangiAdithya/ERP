import { useState, useEffect } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import api from '../api/axios';
import { useAutoRefresh } from '../context/NotificationContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatDateTime } from '../utils/formatters';

export default function RequestClearance() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [tab, setTab] = useState('PENDING');
  const refreshKey = useAutoRefresh();

  const fetchRequests = () => {
    setLoading(true);
    api.get('/requests', { params: { status: tab === 'ALL' ? undefined : tab, limit: 50 } })
      .then(({ data }) => setRequests(data.requests))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRequests(); }, [tab, refreshKey]);

  const openRequest = (request) => {
    setSelectedRequest(request);
    setRejectMode(false);
    setRejectNote('');
  };

  const acceptRequest = async () => {
    if (!selectedRequest) return;
    setProcessing(true);
    try {
      await api.put(`/requests/${selectedRequest.id}/approve`, {});
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      const shortages = err.response?.data?.shortages;
      if (Array.isArray(shortages) && shortages.length > 0) {
        const lines = shortages.map(s => `• ${s.product}: need ${s.requested}, have ${s.available}`).join('\n');
        alert(`${err.response?.data?.error}\n\n${lines}`);
      } else {
        alert(err.response?.data?.error || 'Failed to accept');
      }
    }
    setProcessing(false);
  };

  const rejectRequest = async () => {
    if (!selectedRequest) return;
    if (!rejectNote.trim()) return alert('Please provide a reason for rejection');
    setProcessing(true);
    try {
      await api.put(`/requests/${selectedRequest.id}/reject`, { clearanceNotes: rejectNote.trim() });
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reject');
    }
    setProcessing(false);
  };

  const statusColor = (s) => ({
    PENDING: 'yellow', APPROVED: 'green', PARTIAL: 'orange', COLLECTED: 'blue', REJECTED: 'red', CANCELLED: 'gray'
  }[s] || 'gray');

  const tabs = ['PENDING', 'COLLECTED', 'REJECTED', 'ALL'];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">MIV Clearance</h1>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tab === t ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >{t}</button>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No {tab.toLowerCase()} requests</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">MIV #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Issue No</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => openRequest(r)}>{r.requestNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{r.manager?.name}</td>
                    <td className="px-3 py-2"><Badge color="blue">{r.unit?.code}</Badge></td>
                    <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                    <td className="px-3 py-2"><Badge color={statusColor(r.status)}>{r.status}</Badge></td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{r.issueNo || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="secondary" onClick={() => openRequest(r)}>
                        {r.status === 'PENDING' ? 'Review' : 'View'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Review Modal */}
      <Modal isOpen={!!selectedRequest} onClose={() => setSelectedRequest(null)} title={`Review ${selectedRequest?.requestNumber}`} size="lg">
        {selectedRequest && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
              <div><span className="text-gray-500">Manager:</span> <span className="font-medium">{selectedRequest.manager?.name}</span></div>
              <div><span className="text-gray-500">Unit:</span> <Badge color="blue">{selectedRequest.unit?.name}</Badge></div>
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(selectedRequest.status)}>{selectedRequest.status}</Badge></div>
              <div><span className="text-gray-500">Date:</span> <span>{formatDateTime(selectedRequest.createdAt)}</span></div>
              <div><span className="text-gray-500">Reference No:</span> <span className="font-mono text-xs">{selectedRequest.referenceNo || selectedRequest.requestNumber}</span></div>
              {selectedRequest.remarks && <div><span className="text-gray-500">Remarks:</span> <span>{selectedRequest.remarks}</span></div>}
              {selectedRequest.issueNo && <div><span className="text-gray-500">Issue No:</span> <span className="font-mono text-xs">{selectedRequest.issueNo}</span></div>}
              {selectedRequest.issueDate && <div><span className="text-gray-500">Issue Date:</span> <span>{formatDateTime(selectedRequest.issueDate)}</span></div>}
            </div>

            {selectedRequest.status === 'PENDING' && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
                Accept to auto-issue: an Issue No, issue date, and FIFO batch numbers are filled in automatically and stock is reduced immediately. No further input needed unless rejecting.
              </div>
            )}

            {selectedRequest.notes && (
              <div className="bg-yellow-50 rounded-md p-3 text-sm">
                <span className="text-yellow-700 font-medium">Manager's Note:</span> <span>{selectedRequest.notes}</span>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Requested Items</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Purpose</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Available</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                      {selectedRequest.status !== 'PENDING' && (
                        <>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty Issued</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">FIFO Batch No.</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRequest.items?.map((item) => (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-700">{item.product?.name}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{item.purpose || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={item.product?.currentStock < item.quantity ? 'text-red-600 font-medium' : 'text-gray-600'}>
                            {item.product?.currentStock} {item.product?.unit}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{item.quantity} {item.product?.unit}</td>
                        {selectedRequest.status !== 'PENDING' && (
                          <>
                            <td className="px-3 py-2 text-gray-600">{item.qtyIssued != null ? `${item.qtyIssued} ${item.product?.unit}` : '—'}</td>
                            <td className="px-3 py-2 text-xs font-mono text-amber-800">{item.materialBatchNo || '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedRequest.status === 'PENDING' && !rejectMode && (
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="danger" onClick={() => setRejectMode(true)} disabled={processing}>
                  <XCircle size={16} className="mr-1" /> Reject
                </Button>
                <Button onClick={acceptRequest} disabled={processing}>
                  <CheckCircle size={16} className="mr-1" /> {processing ? 'Accepting…' : 'Accept'}
                </Button>
              </div>
            )}

            {selectedRequest.status === 'PENDING' && rejectMode && (
              <div className="space-y-3 border-t pt-3">
                <label className="block text-sm font-medium text-gray-700">Reason for rejection <span className="text-red-600">*</span></label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="e.g. Insufficient stock and no transfer raised, or duplicate request…"
                />
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => { setRejectMode(false); setRejectNote(''); }} disabled={processing}>Cancel</Button>
                  <Button variant="danger" onClick={rejectRequest} disabled={processing || !rejectNote.trim()}>
                    {processing ? 'Rejecting…' : 'Confirm reject & notify manager'}
                  </Button>
                </div>
              </div>
            )}

            {selectedRequest.clearanceNotes && selectedRequest.status !== 'PENDING' && (
              <div className={`rounded-md p-3 text-sm ${selectedRequest.status === 'REJECTED' ? 'bg-red-50 text-red-800' : 'bg-blue-50'}`}>
                <span className={`font-medium ${selectedRequest.status === 'REJECTED' ? 'text-red-700' : 'text-blue-600'}`}>
                  {selectedRequest.status === 'REJECTED' ? 'Rejection reason:' : 'Notes:'}
                </span>{' '}
                <span>{selectedRequest.clearanceNotes}</span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
