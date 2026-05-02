import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge, { statusColors } from '../components/ui/Badge';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function SaleOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchOrders = () => {
    setLoading(true);
    api.get('/sales', { params: { page, limit: 20, search: search || undefined } })
      .then(({ data }) => { setOrders(data.orders); setTotalPages(data.totalPages); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOrders(); }, [page, search]);

  const columns = [
    { key: 'orderNumber', label: 'SO Number', render: (v) => <span className="font-medium text-navy-700">{v}</span> },
    { key: 'customer', label: 'Customer', render: (v) => v?.name },
    { key: 'orderDate', label: 'Date', render: (v) => formatDate(v) },
    { key: 'status', label: 'Status', render: (v) => <Badge color={statusColors[v]}>{v}</Badge> },
    { key: 'totalAmount', label: 'Total', render: (v) => formatCurrency(v) },
    {
      key: 'invoice', label: 'Invoice',
      render: (v) => v ? <Badge color={statusColors[v.status]}>{v.invoiceNumber}</Badge> : <span className="text-gray-400">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sale Orders</h1>
        <Button onClick={() => navigate('/sale-orders/new')}><Plus size={16} /> New Sale Order</Button>
      </div>

      <Card>
        <div className="mb-4">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by SO number or customer..." />
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Table columns={columns} data={orders} onRowClick={(row) => navigate(`/sale-orders/${row.id}`)} />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
