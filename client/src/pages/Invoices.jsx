import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Badge, { statusColors } from '../components/ui/Badge';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function Invoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchInvoices = () => {
    setLoading(true);
    api.get('/invoices', { params: { page, limit: 20, search: search || undefined } })
      .then(({ data }) => { setInvoices(data.invoices); setTotalPages(data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInvoices(); }, [page, search]);

  const columns = [
    { key: 'invoiceNumber', label: 'Invoice #', render: (v) => <span className="font-medium text-navy-700">{v}</span> },
    { key: 'saleOrder', label: 'Customer', render: (v) => v?.customer?.name },
    { key: 'issueDate', label: 'Issue Date', render: (v) => formatDate(v) },
    { key: 'dueDate', label: 'Due Date', render: (v) => formatDate(v) },
    { key: 'totalAmount', label: 'Total', render: (v) => formatCurrency(v) },
    {
      key: 'paidAmount', label: 'Paid',
      render: (v, row) => (
        <span className={v >= row.totalAmount ? 'text-green-600' : 'text-gray-700'}>
          {formatCurrency(v)}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: (v) => <Badge color={statusColors[v]}>{v.replace('_', ' ')}</Badge> },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>

      <Card>
        <div className="mb-4">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by invoice number or customer..." />
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Table columns={columns} data={invoices} onRowClick={(row) => navigate(`/invoices/${row.id}`)} />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
