import { useState, useEffect } from 'react';
import { CreditCard, CheckCircle, XCircle, Eye, Handshake } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useAutoRefresh } from '../context/NotificationContext';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';

const formatCurrency = (amt) => `₹${Number(amt).toLocaleString('en-IN')}`;

const statusColor = (s) => ({
  PENDING: 'yellow',
  APPROVED: 'blue',
  PAID: 'green',
  REJECTED: 'red',
}[s] || 'gray');

const typeColor = (t) => ({
  ADVANCE: 'blue',
  PARTIAL: 'navy',
  FINAL: 'green',
}[t] || 'gray');

// ─── Detail Modal ───
function PaymentDetailModal({ payment, onClose, onUpdated, currentUser }) {
  const [rejectNotes, setRejectNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const isAdmin = currentUser?.role === 'ADMIN';
  const isAccounting = currentUser?.role === 'ACCOUNTING';

  if (!payment) return null;

  const adminApprove = async () => {
    if (!confirm('Approve this payment and send to Accounting?')) return;
    setProcessing(true);
    try {
      await api.put(`/payment-requests/${payment.id}/approve`);
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
    setProcessing(false);
  };

  const markPaid = async () => {
    if (!confirm('Confirm this payment has been processed?')) return;
    setProcessing(true);
    try {
      await api.put(`/payment-requests/${payment.id}/pay`);
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
    setProcessing(false);
  };

  const reject = async () => {
    if (!confirm('Reject this payment request?')) return;
    setProcessing(true);
    try {
      await api.put(`/payment-requests/${payment.id}/reject`, { notes: rejectNotes || undefined });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
    setProcessing(false);
  };

  return (
    <Modal isOpen={!!payment} onClose={onClose} title={`Payment: ${payment.paymentNumber}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
          <div><span className="text-gray-500">Order:</span> <span className="font-medium">{payment.purchaseOrder?.customName}</span></div>
          <div><span className="text-gray-500">Order #:</span> <span>{payment.purchaseOrder?.orderNumber}</span></div>
          <div><span className="text-gray-500">Supplier:</span> <span>{payment.purchaseOrder?.supplierName}</span></div>
          <div><span className="text-gray-500">Type:</span> <Badge color={typeColor(payment.paymentType)}>{payment.paymentType}</Badge></div>
          <div><span className="text-gray-500">Amount:</span> <span className="font-bold text-navy-700 text-lg">{formatCurrency(payment.amount)}</span></div>
          <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(payment.status)}>{payment.status}</Badge></div>
          <div><span className="text-gray-500">Requested by:</span> <span>{payment.createdBy?.name}</span></div>
          <div><span className="text-gray-500">Date:</span> <span>{formatDateTime(payment.createdAt)}</span></div>
          {payment.processedBy && (
            <div><span className="text-gray-500">Paid by:</span> <span>{payment.processedBy?.name}</span></div>
          )}
          {payment.processedAt && (
            <div><span className="text-gray-500">Paid at:</span> <span>{formatDateTime(payment.processedAt)}</span></div>
          )}
        </div>

        {payment.notes && (
          <div className="bg-yellow-50 rounded-md p-3 text-sm">
            <span className="text-yellow-700 font-medium">Notes:</span> <span>{payment.notes}</span>
          </div>
        )}

        {/* Order payment context */}
        {payment.purchaseOrder && (
          <div className="bg-blue-50 rounded-md p-3 text-sm">
            <p className="font-medium text-blue-700 mb-1">Order Payment Summary</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>Total: {formatCurrency(payment.purchaseOrder.totalAmount)}</div>
              <div>Paid: {formatCurrency(payment.purchaseOrder.totalPaid)}</div>
              <div>Remaining: {formatCurrency(payment.purchaseOrder.totalAmount - payment.purchaseOrder.totalPaid)}</div>
            </div>
          </div>
        )}

        {/* Credit-order flag for Accounting awareness */}
        {payment.purchaseOrder?.isCreditOrder && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-md p-3 flex items-start gap-2">
            <Handshake size={18} className="text-orange-700 mt-0.5 shrink-0" />
            <div className="text-xs text-orange-900">
              <div className="text-sm font-bold mb-0.5">This order was placed on credit</div>
              <div>
                The order is already with the supplier
                {payment.purchaseOrder.creditPlacedBy?.name && <> — placed by <span className="font-semibold">{payment.purchaseOrder.creditPlacedBy.name}</span></>}
                {payment.purchaseOrder.creditPlacedAt && <> on {formatDateTime(payment.purchaseOrder.creditPlacedAt)}</>}.
                Processing this payment clears the outstanding credit balance.
              </div>
              {payment.purchaseOrder.creditNote && (
                <div className="mt-1 italic">Note: {payment.purchaseOrder.creditNote}</div>
              )}
            </div>
          </div>
        )}

        {/* Step 1: Admin approves PENDING payments */}
        {isAdmin && payment.status === 'PENDING' && (
          <div className="flex flex-col gap-3 pt-2 border-t">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-md px-3 py-2">
              Approve this payment to send it to Accounting for processing.
            </div>
            <div className="flex gap-3">
              <Button onClick={adminApprove} disabled={processing}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Approving...' : 'Approve & Send to Accounting'}
              </Button>
              <Button variant="danger" onClick={reject} disabled={processing}>
                <XCircle size={16} className="mr-1" /> Reject
              </Button>
            </div>
            <Input label="Rejection reason (if rejecting)" value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)} placeholder="Reason for rejection" />
          </div>
        )}

        {/* Accounting sees PENDING — waiting for admin */}
        {isAccounting && payment.status === 'PENDING' && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-md px-3 py-2">
            Waiting for Admin approval before this payment can be processed.
          </div>
        )}

        {/* Step 2: Accounting processes APPROVED payments */}
        {(isAccounting || isAdmin) && payment.status === 'APPROVED' && (
          <div className="flex flex-col gap-3 pt-2 border-t">
            <div className="bg-green-50 border border-green-200 text-green-800 text-xs rounded-md px-3 py-2">
              Admin has approved this payment. Please process and mark as paid.
            </div>
            <div className="flex gap-3">
              <Button onClick={markPaid} disabled={processing}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : 'Mark as Paid'}
              </Button>
              <Button variant="danger" onClick={reject} disabled={processing}>
                <XCircle size={16} className="mr-1" /> Reject
              </Button>
            </div>
            <Input label="Rejection reason (if rejecting)" value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)} placeholder="Reason for rejection" />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Page ───
export default function PaymentRequests() {
  const { user } = useAuth();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [tab, setTab] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const isAccounting = ['ACCOUNTING', 'ADMIN'].includes(user?.role);
  const refreshKey = useAutoRefresh();

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = { limit: 50, fromDate: fromDate || undefined, toDate: toDate || undefined };
      if (tab !== 'ALL') params.status = tab;
      const { data } = await api.get('/payment-requests', { params });
      setPayments(data.requests);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tab, fromDate, toDate, refreshKey]);

  const tabs = ['ALL', 'PENDING', 'APPROVED', 'PAID', 'REJECTED'];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">
        {isAccounting ? 'Payment Requests' : 'My Payment Requests'}
      </h1>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                tab === t ? 'bg-white text-navy-700 font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >{t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}</button>
          ))}
        </div>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No payment requests found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Payment #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => setSelectedPayment(p)}>
                      {p.paymentNumber}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <span>{p.purchaseOrder?.customName}</span>
                        {p.purchaseOrder?.isCreditOrder && (
                          <span
                            title="Order placed on credit — payment owed"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-300 text-[10px] font-medium"
                          >
                            <Handshake size={10} /> Credit
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.purchaseOrder?.supplierName}</td>
                    <td className="px-3 py-2"><Badge color={typeColor(p.paymentType)}>{p.paymentType}</Badge></td>
                    <td className="px-3 py-2 font-medium">{formatCurrency(p.amount)}</td>
                    <td className="px-3 py-2"><Badge color={statusColor(p.status)}>{p.status}</Badge></td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(p.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="secondary" onClick={() => setSelectedPayment(p)}>
                        <Eye size={14} className="mr-1" /> {
                          user?.role === 'ADMIN' && p.status === 'PENDING' ? 'Review' :
                          isAccounting && p.status === 'APPROVED' ? 'Process' : 'View'
                        }
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PaymentDetailModal
        payment={selectedPayment}
        onClose={() => setSelectedPayment(null)}
        onUpdated={fetchData}
        currentUser={user}
      />
    </div>
  );
}
