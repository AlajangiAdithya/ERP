import { useState, useEffect } from 'react';
import { Package, AlertTriangle, Users, ClipboardList, ArrowDown, ArrowUp, Activity, ShoppingCart, TrendingUp, CheckCircle, ClipboardCheck, FileText } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import StatsCard from '../components/shared/StatsCard';
import DashboardHero from '../components/shared/DashboardHero';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDateTime } from '../utils/formatters';
import { useNavigate } from 'react-router-dom';

const greet = (user, roleLabel) => {
  const unit = user?.unit?.name;
  return unit ? `Hello, ${unit} ${roleLabel}` : `Hello, ${roleLabel}`;
};

function InProgressButton() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const { data } = await api.get('/purchase-requests/in-progress-summary');
      setSummary(data);
    } catch {
      setSummary(null);
    }
    setLoading(false);
  };

  return (
    <>
      <Button variant="secondary" onClick={openModal}>
        <Activity size={16} className="mr-1 animate-pulse text-amber-500" /> In Progress
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="In Progress — PRs & POs" size="lg">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !summary ? (
          <p className="text-center text-gray-400 py-6">Could not load in-progress items.</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div className="flex items-center gap-2 text-blue-700">
                  <FileText size={16} /> <span className="text-xs uppercase font-semibold">Purchase Requests</span>
                </div>
                <div className="text-2xl font-bold text-blue-700 mt-1">{summary.prCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center gap-2 text-green-700">
                  <ShoppingCart size={16} /> <span className="text-xs uppercase font-semibold">Purchase Orders</span>
                </div>
                <div className="text-2xl font-bold text-green-700 mt-1">{summary.poCount || 0}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700">Active Purchase Requests</h4>
                <Button size="sm" variant="secondary" onClick={() => { setOpen(false); navigate('/purchase-requests'); }}>
                  Open page
                </Button>
              </div>
              {(summary.prSamples || []).length === 0 ? (
                <p className="text-xs text-gray-400 px-1">No active PRs.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500">
                      <th className="px-3 py-1.5 text-left font-medium">PR #</th>
                      <th className="px-3 py-1.5 text-left font-medium">Manager</th>
                      <th className="px-3 py-1.5 text-left font-medium">Unit</th>
                      <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.prSamples.map(pr => (
                      <tr key={pr.id} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 font-medium text-navy-700">{pr.requestNumber}</td>
                        <td className="px-3 py-1.5 text-gray-600">{pr.manager?.name || '—'}</td>
                        <td className="px-3 py-1.5"><Badge color="blue">{pr.unit?.code || pr.unit?.name || '—'}</Badge></td>
                        <td className="px-3 py-1.5"><Badge color="yellow">{pr.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {summary.prCount > (summary.prSamples?.length || 0) && (
                <p className="text-xs text-gray-400 px-3 pt-1">+ {summary.prCount - summary.prSamples.length} more on the Purchase Requests page</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700">Active Purchase Orders</h4>
                <Button size="sm" variant="secondary" onClick={() => { setOpen(false); navigate('/purchase-orders'); }}>
                  Open page
                </Button>
              </div>
              {(summary.poSamples || []).length === 0 ? (
                <p className="text-xs text-gray-400 px-1">No active POs.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500">
                      <th className="px-3 py-1.5 text-left font-medium">PO #</th>
                      <th className="px-3 py-1.5 text-left font-medium">Supplier</th>
                      <th className="px-3 py-1.5 text-left font-medium">Amount</th>
                      <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.poSamples.map(po => (
                      <tr key={po.id} className="border-b border-gray-50">
                        <td className="px-3 py-1.5 font-medium text-navy-700">{po.orderNumber}</td>
                        <td className="px-3 py-1.5 text-gray-600">{po.supplierName || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-700">{po.totalAmount != null ? `₹${Number(po.totalAmount).toLocaleString('en-IN')}` : '—'}</td>
                        <td className="px-3 py-1.5"><Badge color="navy">{po.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {summary.poCount > (summary.poSamples?.length || 0) && (
                <p className="text-xs text-gray-400 px-3 pt-1">+ {summary.poCount - summary.poSamples.length} more on the Purchase Orders page</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

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
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unitSummary, setUnitSummary] = useState([]);
  const [prStats, setPrStats] = useState(null);
  const [lowStockModal, setLowStockModal] = useState(false);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [lowStockLoading, setLowStockLoading] = useState(false);
  const navigate = useNavigate();

  const openLowStockModal = async () => {
    setLowStockModal(true);
    setLowStockLoading(true);
    try {
      const { data } = await api.get('/alerts/low-stock');
      setLowStockProducts(data);
    } catch (err) {
      console.error('Failed to fetch low stock:', err);
    } finally {
      setLowStockLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 1) => {
      const results = await Promise.allSettled([
        api.get('/reports/dashboard'),
        api.get('/reports/unit-summary'),
        api.get('/purchase-requests/dashboard-stats'),
      ]);

      if (cancelled) return;

      const [dashRes, unitRes, prRes] = results;

      if (dashRes.status === 'fulfilled') {
        setData(dashRes.value.data);
      } else if (attempt < 3) {
        setTimeout(() => !cancelled && load(attempt + 1), attempt * 1500);
        return;
      }

      if (unitRes.status === 'fulfilled') setUnitSummary(unitRes.value.data);
      if (prRes.status === 'fulfilled') setPrStats(prRes.value.data);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;
  if (!data) return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
      <AlertTriangle size={40} className="mb-3 opacity-50" />
      <p className="text-lg font-medium text-gray-500">Failed to load dashboard data</p>
      <p className="text-sm mt-1">Check your connection and try again</p>
      <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-navy-700 text-white text-sm rounded-lg hover:bg-navy-800 transition-colors">Retry</button>
    </div>
  );

  const { stats, recentMovements, recentRequests } = data;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Administrator')}
        subtitle="System overview, units, and recent activity"
        actions={<InProgressButton />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Products" value={stats.totalProducts} icon={Package} color="navy" onClick={() => navigate('/products')} />
        <StatsCard title="Low Stock Alerts" value={stats.lowStockAlerts} icon={AlertTriangle} color="red" onClick={openLowStockModal} />
        <StatsCard title="Active Users" value={stats.totalUsers} icon={Users} color="green" onClick={() => navigate('/management')} />
        <StatsCard title="Pending Requests" value={stats.pendingRequests} icon={ClipboardList} color="yellow" onClick={() => navigate('/all-requests')} />
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
      {/* Low Stock Modal */}
      <LowStockModal
        isOpen={lowStockModal}
        onClose={() => setLowStockModal(false)}
        products={lowStockProducts}
        loading={lowStockLoading}
      />
    </div>
  );
}

function ManagerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [requests, setRequests] = useState([]);
  const [requestCounts, setRequestCounts] = useState({ pending: 0, approved: 0 });
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [prInProgressCount, setPrInProgressCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.get('/products', { params: { limit: 50 } }),
        api.get('/requests', { params: { limit: 10 } }),
        api.get('/requests', { params: { status: 'PENDING', limit: 1 } }),
        api.get('/requests', { params: { status: 'APPROVED', limit: 1 } }),
        api.get('/purchase-requests', { params: { limit: 20 } }),
      ]);

      if (cancelled) return;

      const [prodRes, reqRes, pendingRes, approvedRes, prRes] = results;
      if (prodRes.status === 'fulfilled') {
        setProducts(prodRes.value.data.products || []);
        setTotalProducts(prodRes.value.data.total || 0);
      }
      if (reqRes.status === 'fulfilled') setRequests(reqRes.value.data.requests || []);
      if (pendingRes.status === 'fulfilled' && approvedRes.status === 'fulfilled') {
        setRequestCounts({
          pending: pendingRes.value.data.total || 0,
          approved: approvedRes.value.data.total || 0,
        });
      }
      if (prRes.status === 'fulfilled') {
        const reqs = prRes.value.data.requests || [];
        setPurchaseRequests(reqs);
        setPrInProgressCount(reqs.filter(r => ['APPROVED', 'IN_PROGRESS'].includes(r.status)).length);
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, { MANAGER: 'Manager', LAB: 'Lab' }[user?.role] || 'Manager')}
        subtitle="MIV and purchase activity for your unit"
        actions={
          <>
            <InProgressButton />
            <Button variant="secondary" onClick={() => navigate('/my-requests')}>
              <ClipboardList size={16} className="mr-1" /> MIV Requests
            </Button>
            <Button onClick={() => navigate('/purchase-requests')}>
              <ShoppingCart size={16} className="mr-1" /> Purchase Requests
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Available Products" value={totalProducts} icon={Package} color="navy" onClick={() => navigate('/products')} />
        <StatsCard title="MIV Pending" value={requestCounts.pending} icon={ClipboardList} color="yellow" onClick={() => navigate('/my-requests')} />
        <StatsCard title="Ready to Collect" value={requestCounts.approved} icon={Activity} color="green" onClick={() => navigate('/my-requests')} />
        <StatsCard title="Purchase In Progress" value={prInProgressCount} icon={ShoppingCart} color="blue" onClick={() => navigate('/purchase-requests')} />
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {purchaseRequests.filter(r => ['APPROVED', 'IN_PROGRESS'].includes(r.status)).map(r => {
                  return (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/purchase-requests')}>
                      <td className="px-3 py-2 font-medium text-navy-700">{r.requestNumber}</td>
                      <td className="px-3 py-2 text-gray-600">{r.items?.length}</td>
                      <td className="px-3 py-2">
                        <Badge color={r.status === 'APPROVED' ? 'blue' : 'navy'}>{r.status === 'IN_PROGRESS' ? 'In Progress' : r.status}</Badge>
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifying, setNotifying] = useState({});
  const [lowStockModal, setLowStockModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 1) => {
      const results = await Promise.allSettled([
        api.get('/reports/dashboard'),
        api.get('/alerts/low-stock'),
        api.get('/requests', { params: { status: 'PENDING', limit: 10 } }),
      ]);

      if (cancelled) return;

      const [dashRes, lowRes, reqRes] = results;

      if (dashRes.status === 'fulfilled') {
        setData(dashRes.value.data);
      } else if (attempt < 3) {
        setTimeout(() => !cancelled && load(attempt + 1), attempt * 1500);
        return;
      }

      if (lowRes.status === 'fulfilled') setLowStock(lowRes.value.data);
      if (reqRes.status === 'fulfilled') setPendingRequests(reqRes.value.data.requests);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
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
  if (!data) return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
      <AlertTriangle size={40} className="mb-3 opacity-50" />
      <p className="text-lg font-medium text-gray-500">Failed to load dashboard data</p>
      <p className="text-sm mt-1">Check your connection and try again</p>
      <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-navy-700 text-white text-sm rounded-lg hover:bg-navy-800 transition-colors">Retry</button>
    </div>
  );

  const { stats } = data;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Store Manager')}
        subtitle="Stock health and request clearances"
        actions={
          <>
            <InProgressButton />
            <Button onClick={() => navigate('/request-clearance')}>
              <ClipboardList size={16} className="mr-1" /> Pending Clearances
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Products" value={stats.totalProducts} icon={Package} color="navy" onClick={() => navigate('/products')} />
        <StatsCard title="Low Stock Items" value={stats.lowStockAlerts} icon={AlertTriangle} color="red" onClick={() => setLowStockModal(true)} />
        <StatsCard title="Pending Requests" value={stats.pendingRequests} icon={ClipboardList} color="yellow" onClick={() => navigate('/request-clearance')} />
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
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Deficit</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">All stock levels healthy</td></tr>
              ) : (
                lowStock.map((p) => {
                  const fmt = (v) => { const n = Number(v); return Number.isInteger(n) ? n.toString() : n.toFixed(2); };
                  return (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-700">{p.name}</td>
                      <td className="px-3 py-2 text-gray-500">{p.sku}</td>
                      <td className="px-3 py-2">
                        <span className={`font-semibold ${p.currentStock === 0 ? 'text-red-600' : 'text-amber-600'}`}>{fmt(p.currentStock)}</span>
                        <span className="text-gray-400 ml-1">{p.unit}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{fmt(p.minStockLevel)} {p.unit}</td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-red-600">{p.deficit > 0 ? fmt(p.deficit) : '—'}</span>
                        {p.deficit > 0 && <span className="text-gray-400 ml-1">{p.unit}</span>}
                      </td>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Low Stock Modal */}
      <LowStockModal
        isOpen={lowStockModal}
        onClose={() => setLowStockModal(false)}
        products={lowStock}
        loading={false}
      />
    </div>
  );
}

function PurchaseOfficerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [feed, setFeed] = useState({ partiallyReceived: [], awaitingQc: [], pendingQuotations: [], overdue: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.get('/purchase-requests/dashboard-stats'),
        api.get('/purchase-orders/po-dashboard-feed'),
      ]);

      if (cancelled) return;

      const [statsRes, feedRes] = results;
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (feedRes.status === 'fulfilled') setFeed(feedRes.value.data || feed);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Purchase Officer')}
        subtitle="Active assignments and procurement progress"
        actions={
          <>
            <InProgressButton />
            <Button onClick={() => navigate('/purchase-requests')}>
              <ShoppingCart size={16} className="mr-1" /> All Assignments
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Approved (New)" value={stats?.approved || 0} icon={CheckCircle} color="blue" onClick={() => navigate('/purchase-requests')} />
        <StatsCard title="In Progress" value={stats?.inProgress || 0} icon={TrendingUp} color="yellow" onClick={() => navigate('/purchase-requests')} />
        <StatsCard title="Items Pending" value={stats?.pendingItems || 0} icon={ShoppingCart} color="red" onClick={() => navigate('/purchase-requests')} />
        <StatsCard title="Completed" value={stats?.completed || 0} icon={PackageCheck} color="green" onClick={() => navigate('/purchase-requests')} />
      </div>

      {/* Partially received POs — exact received/ordered counts per item */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            Partially Received POs
            <span className="ml-2 text-xs font-normal text-gray-500">({feed.partiallyReceived.length})</span>
          </h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/purchase-orders')}>View All POs</Button>
        </div>
        {feed.partiallyReceived.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No POs currently in partial-delivery state</div>
        ) : (
          <div className="space-y-3">
            {feed.partiallyReceived.map(po => (
              <div key={po.id} className="border rounded-lg p-3 hover:shadow-sm cursor-pointer" onClick={() => navigate('/purchase-orders')}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold text-navy-700 text-sm">{po.orderNumber}</span>
                    {po.customName && <span className="ml-2 text-xs text-gray-500">{po.customName}</span>}
                    <Badge color="yellow" className="ml-2">Partial</Badge>
                  </div>
                  <span className="text-xs font-semibold text-amber-700">
                    {po.totalReceived} / {po.totalOrdered} received
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  <span className="font-medium text-gray-700">Supplier:</span> {po.supplierName || '—'}
                </div>
                <div className="space-y-1">
                  {po.items.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-xs bg-amber-50 rounded p-1.5">
                      <span className="font-medium text-gray-700 flex-1">{it.productName}</span>
                      <span className="text-gray-600">{it.receivedQty} / {it.quantity} {it.productUnit}</span>
                      <Badge color="red">{it.pending} {it.productUnit} pending</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Awaiting QC inspection */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            Awaiting QC Inspection
            <span className="ml-2 text-xs font-normal text-gray-500">({feed.awaitingQc.length})</span>
          </h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/qc-inspections')}>Open QC</Button>
        </div>
        {feed.awaitingQc.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No lots awaiting inspection</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PO #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Goods Arrived</th>
                </tr>
              </thead>
              <tbody>
                {feed.awaitingQc.map(po => (
                  <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/qc-inspections')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{po.orderNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{po.customName || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{po.supplierName || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{po.goodsArrivedAt ? formatDateTime(po.goodsArrivedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pending quotations — approved PRs waiting for the PO to collect quotes */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            PRs Awaiting Quotations
            <span className="ml-2 text-xs font-normal text-gray-500">({feed.pendingQuotations.length})</span>
          </h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/quotations')}>Open Quotations</Button>
        </div>
        {feed.pendingQuotations.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No PRs waiting for quotations</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PR #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved</th>
                </tr>
              </thead>
              <tbody>
                {feed.pendingQuotations.map(pr => (
                  <tr key={pr.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/quotations')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{pr.requestNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{pr.managerName || '—'}</td>
                    <td className="px-3 py-2"><Badge color="blue">{pr.unit?.code || pr.unit?.name || '—'}</Badge></td>
                    <td className="px-3 py-2 text-gray-600">{pr.itemCount}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(pr.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Overdue POs — past the earliest PR required-by date */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            Overdue POs
            <span className="ml-2 text-xs font-normal text-red-600">({feed.overdue.length})</span>
          </h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/purchase-orders')}>View All POs</Button>
        </div>
        {feed.overdue.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No overdue POs ✓</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PO #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Required By</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Days Late</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {feed.overdue.map(po => (
                  <tr key={po.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/purchase-orders')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{po.orderNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{po.customName || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{po.supplierName || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{new Date(po.requiredByDate).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><Badge color="red">{po.daysOverdue} day{po.daysOverdue === 1 ? '' : 's'}</Badge></td>
                    <td className="px-3 py-2"><Badge color="yellow">{po.status}</Badge></td>
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

function AccountingDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [actionablePayments, setActionablePayments] = useState([]);
  const [recentPaid, setRecentPaid] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        // APPROVED = waiting on Accounting to actually pay
        api.get('/payment-requests', { params: { status: 'APPROVED', limit: 50 } }),
        // PENDING = waiting on Admin approval (visibility only)
        api.get('/payment-requests', { params: { status: 'PENDING', limit: 1 } }),
        // PAID = already processed
        api.get('/payment-requests', { params: { status: 'PAID', limit: 10 } }),
      ]);

      if (cancelled) return;

      const [approvedRes, pendingRes, paidRes] = results;
      const approved = approvedRes.status === 'fulfilled' ? (approvedRes.value.data.requests || []) : [];
      const paid = paidRes.status === 'fulfilled' ? (paidRes.value.data.requests || []) : [];

      const approvedTotal = approvedRes.status === 'fulfilled' ? (approvedRes.value.data.total ?? approved.length) : approved.length;
      const pendingTotal = pendingRes.status === 'fulfilled' ? (pendingRes.value.data.total ?? 0) : 0;
      const paidTotal = paidRes.status === 'fulfilled' ? (paidRes.value.data.total ?? paid.length) : paid.length;

      const totalAwaitingValue = approved.reduce((sum, p) => sum + (p.amount || 0), 0);

      setActionablePayments(approved);
      setRecentPaid(paid);
      setStats({
        awaitingPayment: approvedTotal,
        awaitingAdminApproval: pendingTotal,
        paidCount: paidTotal,
        awaitingValue: totalAwaitingValue,
      });
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Accounting')}
        subtitle="Payments awaiting your action, plus reconciliation history"
        actions={
          <>
            <InProgressButton />
            <Button onClick={() => navigate('/payment-requests')}>
              <ShoppingCart size={16} className="mr-1" /> All Payments
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Awaiting Payment" value={stats?.awaitingPayment || 0} icon={AlertTriangle} color="red" onClick={() => navigate('/payment-requests?status=APPROVED')} />
        <StatsCard title="Total to Pay" value={fmtINR(stats?.awaitingValue)} icon={ShoppingCart} color="yellow" onClick={() => navigate('/payment-requests?status=APPROVED')} />
        <StatsCard title="Pending Admin Approval" value={stats?.awaitingAdminApproval || 0} icon={ClipboardList} color="blue" onClick={() => navigate('/payment-requests?status=PENDING')} />
        <StatsCard title="Paid" value={stats?.paidCount || 0} icon={CheckCircle} color="green" onClick={() => navigate('/payment-requests?status=PAID')} />
      </div>

      {/* Approved Payments — accounting acts here */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            Approved Payments — Ready to Process
            <span className="ml-2 text-xs font-normal text-gray-500">({actionablePayments.length})</span>
          </h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/payment-requests')}>View All</Button>
        </div>

        {actionablePayments.length === 0 ? (
          <div className="text-center py-6 text-gray-400">All approved payments processed ✓</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Payment #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {actionablePayments.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700">{p.paymentNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{p.purchaseOrder?.customName || p.purchaseOrder?.orderNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{p.purchaseOrder?.supplierName || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtINR(p.amount)}</td>
                    <td className="px-3 py-2"><Badge color="blue">{p.paymentType}</Badge></td>
                    <td className="px-3 py-2"><Badge color="green">{p.status}</Badge></td>
                    <td className="px-3 py-2">
                      <Button size="sm" onClick={() => navigate('/payment-requests')}>Pay</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {recentPaid.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Recently Paid</h3>
            <Button variant="secondary" size="sm" onClick={() => navigate('/payment-requests')}>View All</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Payment #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Paid By</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">When</th>
                </tr>
              </thead>
              <tbody>
                {recentPaid.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700">{p.paymentNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{p.purchaseOrder?.customName || p.purchaseOrder?.orderNumber}</td>
                    <td className="px-3 py-2 text-right">{fmtINR(p.amount)}</td>
                    <td className="px-3 py-2 text-gray-600">{p.processedBy?.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{p.processedAt ? formatDateTime(p.processedAt) : '—'}</td>
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

function QCDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/qc-inspections?limit=50')
      .then(({ data }) => {
        if (cancelled) return;
        setInspections(data.inspections || []);
        setPendingOrders(data.pendingOrders || []);
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const pendingCount = inspections.filter(i => i.result === 'PENDING').length;
  const passedCount = inspections.filter(i => i.result === 'PASSED').length;
  const failedCount = inspections.filter(i => i.result === 'FAILED').length;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'QC')}
        subtitle="Incoming inspections and quality outcomes"
        actions={
          <>
            <InProgressButton />
            <Button onClick={() => navigate('/qc-inspections')}>
              <ClipboardCheck size={16} className="mr-1" /> All Inspections
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Awaiting Inspection" value={pendingOrders.length} icon={AlertTriangle} color="red" onClick={() => navigate('/qc-inspections')} />
        <StatsCard title="Pending Results" value={pendingCount} icon={ClipboardList} color="yellow" onClick={() => navigate('/qc-inspections')} />
        <StatsCard title="Passed" value={passedCount} icon={CheckCircle} color="green" onClick={() => navigate('/qc-inspections')} />
        <StatsCard title="Failed" value={failedCount} icon={AlertTriangle} color="red" />
      </div>

      {/* Pending Orders Awaiting Inspection */}
      {pendingOrders.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Orders Awaiting Inspection</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Arrived</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingOrders.map((o) => (
                  <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/qc-inspections')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{o.orderNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{o.supplierName || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{o.items?.length || 0} items</td>
                    <td className="px-3 py-2 text-gray-500">{o.goodsArrivedAt ? formatDateTime(o.goodsArrivedAt) : '—'}</td>
                    <td className="px-3 py-2"><Badge color="yellow">{o.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Recent Inspections */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Recent Inspections</h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/qc-inspections')}>View All</Button>
        </div>
        {inspections.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <ClipboardCheck size={40} className="mx-auto mb-3 opacity-50" />
            <p className="text-gray-500">No inspections yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Inspection #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Result</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {inspections.slice(0, 10).map((i) => (
                  <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700">{i.inspectionNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{i.purchaseOrder?.orderNumber || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{i.purchaseOrder?.supplierName || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge color={
                        i.result === 'PASSED' ? 'green' :
                        i.result === 'FAILED' ? 'red' :
                        i.result === 'PARTIAL' ? 'yellow' : 'gray'
                      }>{i.result}</Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{formatDateTime(i.createdAt)}</td>
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

function LowStockModal({ isOpen, onClose, products, loading }) {
  const formatStock = (val) => {
    if (val == null) return '0';
    const n = Number(val);
    return Number.isInteger(n) ? n.toString() : n.toFixed(2);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Low Stock Products (${products.length})`} size="xl">
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Package size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium text-gray-500">All stock levels are healthy</p>
          <p className="text-sm mt-1">No products are below their minimum stock level</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">#</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Stock</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Min Level</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Deficit</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => (
                <tr key={p.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                  <td className="px-3 py-2 font-medium text-gray-700">{p.name}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2 text-gray-500">{p.category || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`font-semibold ${p.currentStock === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {formatStock(p.currentStock)}
                    </span>
                    <span className="text-gray-400 ml-1">{p.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{formatStock(p.minStockLevel)} {p.unit}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-red-600">
                      {p.deficit > 0 ? `${formatStock(p.deficit)}` : '—'}
                    </span>
                    {p.deficit > 0 && <span className="text-gray-400 ml-1">{p.unit}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge color={
                      p.stockStatus === 'Out of Stock' ? 'red' :
                      p.stockStatus === 'Critical' ? 'red' : 'yellow'
                    }>
                      {p.stockStatus}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
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
  if (user?.role === 'QC') return <QCDashboard />;

  return <AdminDashboard />;
}
