import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, DollarSign } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge, { statusColors } from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchInvoice = () => {
    api.get(`/invoices/${id}`)
      .then(({ data }) => setInvoice(data))
      .catch(() => navigate('/invoices'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInvoice(); }, [id]);

  const handlePayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return; }
    setSaving(true);
    try {
      await api.put(`/invoices/${id}/payment`, { amount });
      setShowPayment(false);
      setPaymentAmount('');
      fetchInvoice();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!invoice) return null;

  const remaining = invoice.totalAmount - invoice.paidAmount;
  const order = invoice.saleOrder;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/invoices')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-700">
        <ArrowLeft size={16} /> Back to Invoices
      </button>

      <Card>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
            <p className="text-sm text-gray-500">Sale Order: {order?.orderNumber}</p>
            <p className="text-sm text-gray-500">Customer: {order?.customer?.name}</p>
            <p className="text-sm text-gray-500">Issue Date: {formatDate(invoice.issueDate)}</p>
            <p className="text-sm text-gray-500">Due Date: {formatDate(invoice.dueDate)}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge color={statusColors[invoice.status]}>{invoice.status.replace('_', ' ')}</Badge>
            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && (
              <Button size="sm" onClick={() => { setShowPayment(true); setPaymentAmount(remaining.toString()); }}>
                <DollarSign size={16} /> Record Payment
              </Button>
            )}
          </div>
        </div>

        {/* Customer info */}
        {order?.customer && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><span className="text-gray-400">Customer:</span> {order.customer.name}</div>
            <div><span className="text-gray-400">Email:</span> {order.customer.email || '—'}</div>
            <div><span className="text-gray-400">Phone:</span> {order.customer.phone || '—'}</div>
            <div><span className="text-gray-400">Address:</span> {order.customer.address || '—'}</div>
            <div><span className="text-gray-400">GST:</span> {order.customer.gstNumber || '—'}</div>
          </div>
        )}

        {/* Line items */}
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b">
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">HSN</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Rate</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Tax</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
            </tr>
          </thead>
          <tbody>
            {order?.items?.map((item) => (
              <tr key={item.id} className="border-b border-gray-50">
                <td className="px-3 py-2">{item.product?.name}</td>
                <td className="px-3 py-2 text-gray-500">{item.product?.hsnCode || '—'}</td>
                <td className="px-3 py-2 text-right">{item.quantity} {item.product?.unit}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="px-3 py-2 text-right">{item.taxPercent}%</td>
                <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="border-t pt-4 space-y-2 text-right">
          <p className="text-sm text-gray-500">Subtotal: {formatCurrency(invoice.subtotal)}</p>
          <p className="text-sm text-gray-500">Tax: {formatCurrency(invoice.taxAmount)}</p>
          <p className="text-lg font-bold text-gray-900">Total: {formatCurrency(invoice.totalAmount)}</p>
          <p className="text-sm text-green-600">Paid: {formatCurrency(invoice.paidAmount)}</p>
          {remaining > 0 && <p className="text-sm font-semibold text-brand-red">Balance Due: {formatCurrency(remaining)}</p>}
        </div>
      </Card>

      {/* Payment Modal */}
      <Modal isOpen={showPayment} onClose={() => setShowPayment(false)} title="Record Payment" size="sm">
        <div className="space-y-4">
          {error && <p className="text-sm text-brand-red">{error}</p>}
          <p className="text-sm text-gray-500">Outstanding: {formatCurrency(remaining)}</p>
          <Input
            label="Payment Amount"
            type="number"
            step="0.01"
            min="0.01"
            max={remaining}
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowPayment(false)}>Cancel</Button>
            <Button onClick={handlePayment} disabled={saving}>
              {saving ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
