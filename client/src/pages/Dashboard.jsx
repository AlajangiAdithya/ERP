import { useState, useEffect } from 'react';
import { Package, AlertTriangle, Users, ClipboardList, ArrowDown, ArrowUp, Activity, ShoppingCart, TrendingUp, CheckCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import StatsCard from '../components/shared/StatsCard';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDateTime } from '../utils/formatters';
import { useNavigate } from 'react-router-dom';

function ProgressBar({ purchased, total, showPending = true }) {
  const pct = total > 0 ? Math.min(100, (purchased / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{purchased} / {total}</span>
        <span className={pct >= 100 ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>{Math.round(pct)}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-300'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showPending && pct < 100 && total > 0 && (
        <p className="text-xs text-red-500 mt-0.5 font-medium">{total - purchased} pending</p>
      )}
    </div>
  );
}

function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unitSummary, setUnitSummary] = useState([]);
  const [prStats, setPrStats] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/reports/dashboard'),
      api.get('/reports/unit-summary'),
      api.get('/purchase-requests/dashboard-stats'),
    ])
      .then(([dashRes, unitRes, prRes]) => {
        setData(dashRes.data);
        setUnitSummary(unitRes.data);
        setPrStats(prRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;
  if (!data) return <p className="text-gray-500">Failed to load dashboard data.</p>;

  const { stats, recentMovements, recentRequests } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Products" value={stats.totalProducts} icon={Package} color="navy" />
        <StatsCard title="Low Stock Alerts" value={stats.lowStockAlerts} icon={AlertTriangle} color="red" />
        <StatsCard title="Active Users" value={stats.totalUsers} icon={Users} color="green" />
        <StatsCard title="Pending Requests" value={stats.pendingRequests} icon={ClipboardList} color="yellow" />
      </div>

      {/* Purchase Request Stats */}
      {prStats && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Purchase Requests Overview</h3>
            <Button variant="secondary" size="sm" onClick={() => navigate('/purchase-requests')}>View All</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <p className="text-2xl font-bold text-yellow-600">{prStats.pendingAdmin}</p>
              <p className="text-xs text-gray-500 mt-1">Pending Approval</p>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">{prStats.approved}</p>
              <p className="text-xs text-gray-500 mt-1">Approved</p>
            </div>
            <div className="text-center p-3 bg-indigo-50 rounded-lg">
              <p className="text-2xl font-bold text-indigo-600">{prStats.inProgress}</p>
              <p className="text-xs text-gray-500 mt-1">In Progress</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{prStats.completed}</p>
              <p className="text-xs text-gray-500 mt-1">Completed</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">{prStats.rejected}</p>
              <p className="text-xs text-gray-500 mt-1">Rejected</p>
            </div>
          </div>
        </Card>
      )}

      {/* Unit Summary */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Unit-wise Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Code</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Users</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requests</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items Consumed</th>
              </tr>
            </thead>
            <tbody>
              {unitSummary.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-700">{u.name}</td>
                  <td className="px-3 py-2"><Badge color="blue">{u.code}</Badge></td>
                  <td className="px-3 py-2 text-gray-600">{u.totalUsers}</td>
                  <td className="px-3 py-2 text-gray-600">{u.totalRequests}</td>
                  <td className="px-3 py-2 text-gray-600">{u.totalItemsConsumed}</td>
                </tr>
              ))}
              {unitSummary.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No units found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Recent Stock Movements</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No movements yet</td></tr>
                ) : (
                  recentMovements.map((m) => (
                    <tr key={m.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-700">{m.product?.name}</td>
                      <td className="px-3 py-2">
                        <Badge color={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'red' : 'yellow'}>
                          {m.type === 'IN' && <ArrowDown size={10} className="inline mr-1" />}
                          {m.type === 'OUT' && <ArrowUp size={10} className="inline mr-1" />}
                          {m.type}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{m.quantity} {m.product?.unit}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(m.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Recent Requests</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentRequests.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No requests yet</td></tr>
                ) : (
                  recentRequests.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-700">{r.requestNumber}</td>
                      <td className="px-3 py-2 text-gray-600">{r.manager?.name}</td>
                      <td className="px-3 py-2"><Badge color="blue">{r.unit?.code}</Badge></td>
                      <td className="px-3 py-2">
                        <Badge color={
                          r.status === 'PENDING' ? 'yellow' :
                          r.status === 'APPROVED' ? 'green' :
                          r.status === 'COLLECTED' ? 'blue' :
                          r.status === 'REJECTED' ? 'red' : 'gray'
                        }>{r.status}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ManagerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/products', { params: { limit: 50 } }),
      api.get('/requests', { params: { limit: 10 } }),
      api.get('/purchase-requests', { params: { limit: 10 } }),
    ])
      .then(([prodRes, reqRes, prRes]) => {
        setProducts(prodRes.data.products);
        setRequests(reqRes.data.requests);
        setPurchaseRequests(prRes.data.requests);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  const pendingCount = requests.filter(r => r.status === 'PENDING').length;
  const approvedCount = requests.filter(r => r.status === 'APPROVED').length;
  const prPendingCount = purchaseRequests.filter(r => r.status === 'PENDING_ADMIN').length;
  const prInProgressCount = purchaseRequests.filter(r => ['APPROVED', 'IN_PROGRESS'].includes(r.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{
          { MANAGER: 'Manager', LAB: 'Lab' }[user?.role] || 'Manager'
        } Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate('/my-requests')}>
            <ClipboardList size={16} className="mr-1" /> MIV Requests
          </Button>
          <Button onClick={() => navigate('/purchase-requests')}>
            <ShoppingCart size={16} className="mr-1" /> Purchase Requests
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Available Products" value={products.length} icon={Package} color="navy" />
        <StatsCard title="MIV Pending" value={pendingCount} icon={ClipboardList} color="yellow" />
        <StatsCard title="Ready to Collect" value={approvedCount} icon={Activity} color="green" />
        <StatsCard title="Purchase In Progress" value={prInProgressCount} icon={ShoppingCart} color="blue" />
      </div>

      {/* Purchase Request Progress */}
      {purchaseRequests.filter(r => ['APPROVED', 'IN_PROGRESS'].includes(r.status)).length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Active Purchase Requests</h3>
            <Button variant="secondary" size="sm" onClick={() => navigate('/purchase-requests')}>View All</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Progress</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {purchaseRequests.filter(r => ['APPROVED', 'IN_PROGRESS'].includes(r.status)).map(r => {
                  const totalApproved = r.items.reduce((sum, i) => sum + (i.adminApprovedQty || 0), 0);
                  const totalPurchased = r.items.reduce((sum, i) => sum + (i.purchasedQty || 0), 0);
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/purchase-requests')}>
                      <td className="px-3 py-2 font-medium text-navy-700">{r.requestNumber}</td>
                      <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                      <td className="px-3 py-2">
                        <Badge color={r.status === 'APPROVED' ? 'blue' : 'navy'}>{r.status === 'IN_PROGRESS' ? 'In Progress' : r.status}</Badge>
                      </td>
                      <td className="px-3 py-2 w-36">
                        <ProgressBar purchased={totalPurchased} total={totalApproved} />
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Products Overview */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Product Catalog</h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/products')}>View All</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Available Stock</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 10).map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-700">{p.name}</td>
                  <td className="px-3 py-2 text-gray-600">{p.category || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{p.currentStock} {p.unit}</td>
                  <td className="px-3 py-2">
                    {p.currentStock === 0 ? (
                      <Badge color="red">Out of Stock</Badge>
                    ) : p.minStockLevel > 0 && p.currentStock <= p.minStockLevel ? (
                      <Badge color="yellow">Low Stock</Badge>
                    ) : (
                      <Badge color="green">Available</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent MIV Requests */}
      {requests.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-4">My Recent MIV Requests</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/my-requests')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{r.requestNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{r.items?.length} item(s)</td>
                    <td className="px-3 py-2">
                      <Badge color={
                        r.status === 'PENDING' ? 'yellow' : r.status === 'APPROVED' ? 'green' :
                        r.status === 'COLLECTED' ? 'blue' : r.status === 'REJECTED' ? 'red' : 'gray'
                      }>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
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

function StoreManagerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState({});

  useEffect(() => {
    Promise.all([
      api.get('/reports/dashboard'),
      api.get('/alerts/low-stock'),
      api.get('/requests', { params: { status: 'PENDING', limit: 10 } }),
    ])
      .then(([dashRes, lowRes, reqRes]) => {
        setData(dashRes.data);
        setLowStock(lowRes.data);
        setPendingRequests(reqRes.data.requests);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const notifyAdmin = async (product) => {
    setNotifying(prev => ({ ...prev, [product.id]: true }));
    try {
      await api.post('/alerts/low-stock-notify', { productId: product.id });
      alert(`Admin has been notified about low stock for ${product.name}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send notification');
    }
    setNotifying(prev => ({ ...prev, [product.id]: false }));
  };

  if (loading) return <Loader />;
  if (!data) return <p className="text-gray-500">Failed to load dashboard data.</p>;

  const { stats } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Store Manager Dashboard</h1>
        <Button onClick={() => navigate('/request-clearance')}>
          <ClipboardList size={16} className="mr-1" /> Pending Clearances
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Products" value={stats.totalProducts} icon={Package} color="navy" />
        <StatsCard title="Low Stock Items" value={stats.lowStockAlerts} icon={AlertTriangle} color="red" />
        <StatsCard title="Pending Requests" value={stats.pendingRequests} icon={ClipboardList} color="yellow" />
        <StatsCard title="Active Users" value={stats.totalUsers} icon={Users} color="green" />
      </div>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Pending Requests to Approve</h3>
            <Button variant="secondary" size="sm" onClick={() => navigate('/request-clearance')}>View All</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/request-clearance')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{r.requestNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{r.manager?.name}</td>
                    <td className="px-3 py-2"><Badge color="blue">{r.unit?.code}</Badge></td>
                    <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Low Stock Products */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Low Stock Products</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">SKU</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Current Stock</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Min Level</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">All stock levels healthy ✓</td></tr>
              ) : (
                lowStock.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{p.name}</td>
                    <td className="px-3 py-2 text-gray-500">{p.sku}</td>
                    <td className="px-3 py-2 text-gray-700">{p.currentStock} {p.unit}</td>
                    <td className="px-3 py-2 text-gray-500">{p.minStockLevel} {p.unit}</td>
                    <td className="px-3 py-2">
                      <Badge color={p.stockStatus === 'Out of Stock' ? 'red' : p.stockStatus === 'Critical' ? 'red' : 'yellow'}>
                        {p.stockStatus}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => notifyAdmin(p)}
                        disabled={notifying[p.id]}
                      >
                        {notifying[p.id] ? 'Sending...' : 'Notify Admin'}
                      </Button>
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

function PurchaseOfficerDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/purchase-requests/dashboard-stats'),
      api.get('/purchase-requests', { params: { limit: 20 } }),
    ])
      .then(([statsRes, reqRes]) => {
        setStats(statsRes.data);
        setRequests(reqRes.data.requests);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Officer Dashboard</h1>
        <Button onClick={() => navigate('/purchase-requests')}>
          <ShoppingCart size={16} className="mr-1" /> All Assignments
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Approved (New)" value={stats?.approved || 0} icon={CheckCircle} color="blue" />
        <StatsCard title="In Progress" value={stats?.inProgress || 0} icon={TrendingUp} color="yellow" />
        <StatsCard title="Items Pending" value={stats?.pendingItems || 0} icon={ShoppingCart} color="red" />
        <StatsCard title="Completed" value={stats?.completed || 0} icon={PackageCheck} color="green" />
      </div>

      {/* Active Purchase Assignments */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Active Purchase Assignments</h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/purchase-requests')}>View All</Button>
        </div>

        {requests.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No active purchase assignments</div>
        ) : (
          <div className="space-y-4">
            {requests.map(r => {
              const totalApproved = r.items.reduce((sum, i) => sum + (i.adminApprovedQty || 0), 0);
              const totalPurchased = r.items.reduce((sum, i) => sum + (i.purchasedQty || 0), 0);

              return (
                <div key={r.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate('/purchase-requests')}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="font-semibold text-navy-700 text-sm">{r.requestNumber}</span>
                      <Badge color={r.status === 'APPROVED' ? 'blue' : 'navy'} className="ml-2">
                        {r.status === 'IN_PROGRESS' ? 'In Progress' : r.status}
                      </Badge>
                    </div>
                    <span className="text-xs text-gray-500">{formatDateTime(r.createdAt)}</span>
                  </div>

                  <div className="text-xs text-gray-500 mb-3">
                    <span className="font-medium text-gray-700">Manager:</span> {r.manager?.name} •
                    <span className="font-medium text-gray-700 ml-2">Unit:</span> {r.unit?.name}
                  </div>

                  {/* Overall progress */}
                  <div className="mb-3">
                    <ProgressBar purchased={totalPurchased} total={totalApproved} />
                  </div>

                  {/* Item-level breakdown */}
                  <div className="space-y-2">
                    {r.items.map(item => {
                      const approved = item.adminApprovedQty || 0;
                      const purchased = item.purchasedQty || 0;
                      const pending = approved - purchased;
                      return (
                        <div key={item.id} className="flex items-center gap-3 text-xs bg-gray-50 rounded p-2">
                          <span className="font-medium text-gray-700 flex-1">{item.productName}</span>
                          <span className="text-gray-500">{purchased}/{approved} {item.productUnit}</span>
                          {pending > 0 && (
                            <Badge color="red">{pending} {item.productUnit} pending</Badge>
                          )}
                          {pending <= 0 && (
                            <Badge color="green">✓ Done</Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function AccountingDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [paymentRequests, setPaymentRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/payment-requests?limit=10'),
      api.get('/quotations?limit=10'),
    ])
      .then(([payRes, quotRes]) => {
        setPaymentRequests(payRes.data.paymentRequests || []);
        const pendingQuotations = (quotRes.data.quotations || []).filter(q => !q.isSelected);
        const totalPending = payRes.data.paymentRequests?.filter(p => p.status === 'PENDING').length || 0;
        setStats({
          pendingPayments: totalPending,
          pendingQuotations: pendingQuotations.length,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounting Dashboard</h1>
        <Button onClick={() => navigate('/payment-requests')}>
          <ShoppingCart size={16} className="mr-1" /> All Payments
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard title="Pending Payments" value={stats?.pendingPayments || 0} icon={AlertTriangle} color="red" />
        <StatsCard title="Pending Quotations" value={stats?.pendingQuotations || 0} icon={ClipboardList} color="yellow" />
        <StatsCard title="Payment Processed" value={paymentRequests.filter(p => p.status === 'PAID').length} icon={CheckCircle} color="green" />
      </div>

      {/* Pending Payment Requests */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Pending Payment Requests</h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/payment-requests')}>View All</Button>
        </div>

        {paymentRequests.filter(p => p.status === 'PENDING').length === 0 ? (
          <div className="text-center py-6 text-gray-400">All payments processed ✓</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Payment #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {paymentRequests.filter(p => p.status === 'PENDING').map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700">{p.paymentNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{p.purchaseOrder?.orderNumber}</td>
                    <td className="px-3 py-2 font-medium">₹{Number(p.amount).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2"><Badge color="blue">{p.paymentType}</Badge></td>
                    <td className="px-3 py-2"><Badge color="yellow">{p.status}</Badge></td>
                    <td className="px-3 py-2">
                      <Button variant="secondary" size="sm" onClick={() => navigate('/payment-requests')}>Review</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PackageCheck(props) {
  return <CheckCircle {...props} />;
}

function Loader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  if (user?.role === 'ADMIN') return <AdminDashboard />;
  if (['MANAGER', 'LAB'].includes(user?.role)) return <ManagerDashboard />;
  if (user?.role === 'STORE_MANAGER') return <StoreManagerDashboard />;
  if (user?.role === 'PURCHASE_OFFICER') return <PurchaseOfficerDashboard />;
  if (user?.role === 'ACCOUNTING') return <AccountingDashboard />;

  return <AdminDashboard />;
}
