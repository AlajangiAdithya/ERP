import { useState, useEffect } from 'react';
import { Package, AlertTriangle, ClipboardList, ArrowDown, ArrowUp, Activity, ShoppingCart, TrendingUp, CheckCircle, ClipboardCheck, FileText, IndianRupee, Building2, Ruler, Clock, Truck, DoorOpen, MapPin, Send, ShieldCheck, ScrollText, Inbox, ArrowRight, Calendar, Eye, FileSearch, CreditCard, BarChart3, ArrowLeftRight, FlaskConical, History } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import StatsCard from '../components/shared/StatsCard';
import DashboardHero from '../components/shared/DashboardHero';
import SlaTicker from '../components/shared/SlaTicker';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDate, formatDateTime } from '../utils/formatters';
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                <div className="flex items-center gap-2 text-blue-700">
                  <FileText size={16} /> <span className="text-xs uppercase font-semibold">PR Pending</span>
                </div>
                <div className="text-2xl font-bold text-blue-700 mt-1">
                  {summary.prCount || 0}<span className="text-sm text-blue-400 font-medium">/{summary.prTotal || 0}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center gap-2 text-green-700">
                  <ShoppingCart size={16} /> <span className="text-xs uppercase font-semibold">PO Pending</span>
                </div>
                <div className="text-2xl font-bold text-green-700 mt-1">
                  {summary.poCount || 0}<span className="text-sm text-green-400 font-medium">/{summary.poTotal || 0}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2 text-amber-700">
                  <ClipboardCheck size={16} /> <span className="text-xs uppercase font-semibold">QC Pending</span>
                </div>
                <div className="text-2xl font-bold text-amber-700 mt-1">
                  {summary.qcPendingCount || 0}<span className="text-sm text-amber-400 font-medium">/{summary.poTotal || 0}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-purple-50 border border-purple-200">
                <div className="flex items-center gap-2 text-purple-700">
                  <IndianRupee size={16} /> <span className="text-xs uppercase font-semibold">Total Value</span>
                </div>
                <div className="text-xl font-bold text-purple-700 mt-1">
                  ₹{Number(summary.totalAmountInProgress || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-purple-500 mt-0.5">across all units</div>
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
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-[10px] text-gray-500 uppercase tracking-wide">
                      <th className="px-2 py-1.5 text-left font-medium">PR #</th>
                      <th className="px-2 py-1.5 text-left font-medium">From (Unit)</th>
                      <th className="px-2 py-1.5 text-left font-medium">Raised By</th>
                      <th className="px-2 py-1.5 text-left font-medium">Required By</th>
                      <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.prSamples.map((pr, i) => {
                      const reqBy = pr.earliestRequiredBy ? new Date(pr.earliestRequiredBy) : null;
                      const overdue = reqBy && reqBy < new Date();
                      return (
                        <tr key={pr.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                          <td className="px-2 py-1.5 font-medium text-navy-700">{pr.requestNumber}</td>
                          <td className="px-2 py-1.5">
                            <Badge color="blue">{pr.unit?.code || pr.unit?.name || '—'}</Badge>
                          </td>
                          <td className="px-2 py-1.5 text-gray-600">
                            {pr.manager?.name || '—'}
                            {pr.manager?.role && (
                              <span className="text-[10px] text-gray-400 ml-1">({pr.manager.role})</span>
                            )}
                          </td>
                          <td className={`px-2 py-1.5 ${overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {reqBy ? reqBy.toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="px-2 py-1.5"><Badge color="yellow">{pr.status}</Badge></td>
                        </tr>
                      );
                    })}
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
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-[10px] text-gray-500 uppercase tracking-wide">
                      <th className="px-2 py-1.5 text-left font-medium">PO #</th>
                      <th className="px-2 py-1.5 text-left font-medium">Unit(s)</th>
                      <th className="px-2 py-1.5 text-left font-medium">Supplier</th>
                      <th className="px-2 py-1.5 text-left font-medium">Amount</th>
                      <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.poSamples.map((po, i) => {
                      const directUnit = po.purchaseRequest?.unit;
                      const unionUnits = (po.sourceRequests || [])
                        .map(s => s.purchaseRequest?.unit?.code || s.purchaseRequest?.unit?.name)
                        .filter(Boolean);
                      const unitLabel = directUnit?.code || directUnit?.name
                        || (unionUnits.length ? unionUnits.join(', ') : '—');
                      return (
                        <tr key={po.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                          <td className="px-2 py-1.5 font-medium text-navy-700">{po.orderNumber}</td>
                          <td className="px-2 py-1.5"><Badge color="blue">{unitLabel}</Badge></td>
                          <td className="px-2 py-1.5 text-gray-600">{po.supplierName || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-700">{po.totalAmount != null ? `₹${Number(po.totalAmount).toLocaleString('en-IN')}` : '—'}</td>
                          <td className="px-2 py-1.5"><Badge color={po.status === 'QC_PENDING' ? 'amber' : 'navy'}>{po.status}</Badge></td>
                        </tr>
                      );
                    })}
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
        <StatsCard
          title="Purchase Requests"
          value={prStats ? `${(prStats.pendingAdmin || 0) + (prStats.inProgress || 0)} / ${prStats.total || 0}` : '— / —'}
          subtitle="Active / Total"
          icon={ShoppingCart}
          color="blue"
          onClick={() => navigate('/purchase-requests')}
        />
        <StatsCard title="Pending MIV Requests" value={stats.pendingRequests} icon={ClipboardList} color="yellow" onClick={() => navigate('/all-requests')} />
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
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requests</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items Consumed</th>
              </tr>
            </thead>
            <tbody>
              {unitSummary.map((u, i) => (
                <tr key={u.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                  <td className="px-3 py-2 font-medium text-gray-700">{u.name}</td>
                  <td className="px-3 py-2"><Badge color="blue">{u.code}</Badge></td>
                  <td className="px-3 py-2 text-gray-600">{u.totalRequests}</td>
                  <td className="px-3 py-2 text-gray-600">{u.totalItemsConsumed}</td>
                </tr>
              ))}
              {unitSummary.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">No units found</td></tr>
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
                  recentMovements.map((m, i) => (
                    <tr key={m.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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
                  recentRequests.map((r, i) => (
                    <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [unitStats, setUnitStats] = useState({
    miv: { total: 0, pending: 0, approved: 0, active: 0 },
    pr: { total: 0, pending: 0, active: 0, completed: 0 },
    po: { total: 0, active: 0, completed: 0 },
  });
  const [ions, setIons] = useState([]);
  const [loading, setLoading] = useState(true);

  const isLab = user?.role === 'LAB';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const tasks = [
        api.get('/products', { params: { limit: 50 } }),
        api.get('/requests', { params: { limit: 10 } }),
        api.get('/purchase-requests', { params: { limit: 20 } }),
        api.get('/purchase-requests/unit-dashboard'),
      ];
      if (isLab) tasks.push(api.get('/ion', { params: { limit: 20 } }));

      const results = await Promise.allSettled(tasks);

      if (cancelled) return;

      const [prodRes, reqRes, prRes, unitRes, ionRes] = results;
      if (prodRes.status === 'fulfilled') {
        setProducts(prodRes.value.data.products || []);
        setTotalProducts(prodRes.value.data.total || 0);
      }
      if (reqRes.status === 'fulfilled') setRequests(reqRes.value.data.requests || []);
      if (prRes.status === 'fulfilled') {
        setPurchaseRequests(prRes.value.data.requests || []);
      }
      if (unitRes.status === 'fulfilled') setUnitStats(unitRes.value.data);
      if (ionRes && ionRes.status === 'fulfilled') setIons(ionRes.value.data.ions || []);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [isLab]);

  if (loading) return <Loader />;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, { MANAGER: 'Manager', LAB: 'Lab', PLANNING: 'Planning' }[user?.role] || 'Manager')}
        subtitle={isLab ? 'ION inbox, MIV and purchase activity for your unit' : 'MIV and purchase activity for your unit'}
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
        <StatsCard
          title="Available Products"
          value={totalProducts}
          subtitle="In catalog"
          icon={Package}
          color="navy"
          onClick={() => navigate('/products')}
        />
        <StatsCard
          title="MIV Requests"
          value={`${unitStats.miv.pending} / ${unitStats.miv.total}`}
          subtitle="Pending / Total (unit)"
          icon={ClipboardList}
          color="yellow"
          onClick={() => navigate('/my-requests')}
        />
        <StatsCard
          title="PR Pending (My Unit)"
          value={`${unitStats.pr.active} / ${unitStats.pr.total}`}
          subtitle="Pending / Total"
          icon={ShoppingCart}
          color="blue"
          onClick={() => navigate('/purchase-requests')}
        />
        <StatsCard
          title="PO Pending (My Unit)"
          value={`${unitStats.po.active} / ${unitStats.po.total}`}
          subtitle="Pending / Total"
          icon={TrendingUp}
          color="green"
          onClick={() => navigate('/purchase-orders')}
        />
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
                {purchaseRequests.filter(r => ['APPROVED', 'IN_PROGRESS'].includes(r.status)).map((r, i) => {
                  return (
                    <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/purchase-requests')}>
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
              {products.slice(0, 10).map((p, i) => (
                <tr key={p.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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

      {/* ION pending — LAB only */}
      {isLab && (
        <Card>
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-50 text-purple-700 ring-1 ring-purple-100">
                <FlaskConical size={15} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">
                  Inter-Office Notes
                  <span className="ml-2 text-xs font-normal text-gray-500">({ions.filter(i => i.status !== 'COLLECTED').length} open)</span>
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Lab samples and tests requested across units</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/ion')}>Open ION</Button>
          </div>
          {ions.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto rounded-full bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center mb-2">
                <FlaskConical size={22} className="text-gray-400" />
              </div>
              <p className="text-sm text-gray-600">No ION requests right now.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/60">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">ION #</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">From</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {ions.slice(0, 10).map((i, idx) => (
                    <tr key={i.id} className={`border-b border-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/ion')}>
                      <td className="px-3 py-2.5 font-medium text-navy-700">{i.ionNumber || i.id?.slice(0, 6)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{i.createdBy?.name || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600">{i.items?.length || 0}</td>
                      <td className="px-3 py-2.5">
                        <Badge color={i.status === 'COLLECTED' ? 'green' : i.status === 'WAITING' ? 'yellow' : 'blue'}>
                          {i.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{formatDateTime(i.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

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
                {requests.map((r, i) => (
                  <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/my-requests')}>
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
        <StatsCard
          title="Out of Stock"
          value={lowStock.filter(p => Number(p.currentStock) === 0).length}
          subtitle="Items at zero stock"
          icon={AlertTriangle}
          color="red"
          onClick={() => setLowStockModal(true)}
        />
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
                {pendingRequests.map((r, i) => (
                  <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/request-clearance')}>
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
                lowStock.map((p, i) => {
                  const fmt = (v) => { const n = Number(v); return Number.isInteger(n) ? n.toString() : n.toFixed(2); };
                  return (
                    <tr key={p.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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

const GP_KIND_LABEL = { LOCAL_JOB: 'Local Job', OUTSIDE: 'Outside' };
const GP_KIND_COLOR = { LOCAL_JOB: 'purple', OUTSIDE: 'blue' };

function LogisticsDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pendingLogistics, setPendingLogistics] = useState([]);
  const [inTransit, setInTransit] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'PENDING_LOGISTICS', limit: 50 } }),
        api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'IN_TRANSIT', limit: 50 } }),
        api.get('/vehicles'),
      ]);
      if (cancelled) return;
      const [pendRes, transitRes, vehRes] = results;
      if (pendRes.status === 'fulfilled') setPendingLogistics(pendRes.value.data.gatePasses || []);
      if (transitRes.status === 'fulfilled') setInTransit(transitRes.value.data.gatePasses || []);
      if (vehRes.status === 'fulfilled') setVehicles(vehRes.value.data.vehicles || []);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const activeVehicles = vehicles.filter(v => v.status === 'ACTIVE').length;
  const maintenanceVehicles = vehicles.filter(v => v.status === 'MAINTENANCE').length;
  const today = new Date();
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringDocs = vehicles.filter(v => {
    const dates = [v.insuranceExpiry, v.pucExpiry, v.fitnessExpiry].filter(Boolean).map(d => new Date(d));
    return dates.some(d => d <= in30Days);
  }).length;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Logistics')}
        subtitle="Vehicle assignments, gate-pass dispatch, and fleet status"
        eyebrow="Logistics Control"
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/vehicles')}>
              <Truck size={16} className="mr-1" /> Vehicles
            </Button>
            <Button onClick={() => navigate('/gate-pass')}>
              <DoorOpen size={16} className="mr-1" /> Gate Pass
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Pending Logistics"
          value={pendingLogistics.length}
          subtitle="Awaiting vehicle / dispatch"
          icon={ClipboardList}
          color="yellow"
          onClick={() => navigate('/gate-pass')}
        />
        <StatsCard
          title="In Transit"
          value={inTransit.length}
          subtitle="Dispatched, awaiting ack"
          icon={Send}
          color="blue"
          onClick={() => navigate('/gate-pass')}
        />
        <StatsCard
          title="Active Vehicles"
          value={activeVehicles}
          subtitle={`${vehicles.length} total in register`}
          icon={Truck}
          color="green"
          onClick={() => navigate('/vehicles')}
        />
        <StatsCard
          title="Docs Expiring"
          value={expiringDocs}
          subtitle="Insurance / PUC / fitness ≤ 30d"
          icon={AlertTriangle}
          color={expiringDocs > 0 ? 'red' : 'navy'}
          onClick={() => navigate('/vehicles')}
        />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-yellow-50 text-yellow-700 ring-1 ring-yellow-100">
              <ClipboardList size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Pending Logistics Action
                <span className="ml-2 text-xs font-normal text-gray-500">({pendingLogistics.length})</span>
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Gate passes ready for vehicle assignment and dispatch</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/gate-pass')}>Open Gate Pass</Button>
        </div>
        {pendingLogistics.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto rounded-full bg-green-50 ring-1 ring-green-100 flex items-center justify-center mb-2">
              <CheckCircle size={22} className="text-green-600" />
            </div>
            <p className="text-sm text-gray-600">Nothing waiting for logistics right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pass #</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Kind</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Raised</th>
                </tr>
              </thead>
              <tbody>
                {pendingLogistics.map((g, i) => (
                  <tr
                    key={g.id}
                    className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                    onClick={() => navigate('/gate-pass')}
                  >
                    <td className="px-3 py-2.5 font-medium text-navy-700">{g.passNumber}</td>
                    <td className="px-3 py-2.5">
                      {g.kind ? <Badge color={GP_KIND_COLOR[g.kind]}>{GP_KIND_LABEL[g.kind]}</Badge> : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{g.destinationOffice || g.partyName || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-gray-500">{g.items?.length || 0}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {g.assignedVehicle ? (
                        <span className="text-xs font-mono">{g.assignedVehicle.regNumber}</span>
                      ) : (
                        <Badge color="yellow">Not assigned</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{formatDateTime(g.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <Send size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                In Transit
                <span className="ml-2 text-xs font-normal text-gray-500">({inTransit.length})</span>
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Dispatched and awaiting site acknowledgement</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/gate-pass')}>View All</Button>
        </div>
        {inTransit.length === 0 ? (
          <div className="text-center py-8">
            <Send size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No gate passes in transit.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pass #</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Kind</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Dispatched</th>
                </tr>
              </thead>
              <tbody>
                {inTransit.map((g, i) => (
                  <tr
                    key={g.id}
                    className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                    onClick={() => navigate('/gate-pass')}
                  >
                    <td className="px-3 py-2.5 font-medium text-navy-700">{g.passNumber}</td>
                    <td className="px-3 py-2.5">
                      {g.kind ? <Badge color={GP_KIND_COLOR[g.kind]}>{GP_KIND_LABEL[g.kind]}</Badge> : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                      {g.assignedVehicle?.regNumber || g.vehicleNo || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={11} className="text-gray-400" />
                        {g.destinationOffice || g.partyName || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">
                      {g.dispatchedAt ? formatDateTime(g.dispatchedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-green-50 text-green-700 ring-1 ring-green-100">
              <Truck size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Vehicle Fleet
                <span className="ml-2 text-xs font-normal text-gray-500">({vehicles.length})</span>
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Active vehicles and document expiry status</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/vehicles')}>Manage Fleet</Button>
        </div>
        {vehicles.length === 0 ? (
          <div className="text-center py-8">
            <Truck size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-600 font-medium">No vehicles registered yet</p>
            <p className="text-xs text-gray-400 mt-1">Add your first vehicle from the Vehicles page.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Reg #</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Driver</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Insurance</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.slice(0, 10).map((v, i) => {
                  const insExp = v.insuranceExpiry ? new Date(v.insuranceExpiry) : null;
                  const insSoon = insExp && insExp <= in30Days;
                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                      onClick={() => navigate('/vehicles')}
                    >
                      <td className="px-3 py-2.5 font-mono font-medium text-navy-700">{v.regNumber}</td>
                      <td className="px-3 py-2.5 text-gray-600">{v.vehicleType || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{v.driverName || '—'}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {insExp ? (
                          <span className={insSoon ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                            {formatDate(insExp)}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge color={v.status === 'ACTIVE' ? 'green' : v.status === 'MAINTENANCE' ? 'yellow' : 'gray'}>
                          {v.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {maintenanceVehicles > 0 && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  {maintenanceVehicles} vehicle{maintenanceVehicles === 1 ? '' : 's'} currently in maintenance.
                </p>
              </div>
            )}
          </div>
        )}
      </Card>
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
                {feed.awaitingQc.map((po, i) => (
                  <tr key={po.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/qc-inspections')}>
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
                {feed.pendingQuotations.map((pr, i) => (
                  <tr key={pr.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/quotations')}>
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
                {feed.overdue.map((po, i) => (
                  <tr key={po.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/purchase-orders')}>
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
                {actionablePayments.map((p, i) => (
                  <tr key={p.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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
                {recentPaid.map((p, i) => (
                  <tr key={p.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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
                {pendingOrders.map((o, i) => (
                  <tr key={o.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/qc-inspections')}>
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
                {inspections.slice(0, 10).map((i, idx) => (
                  <tr key={i.id} className={`border-b border-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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

function MetrologyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/calibration')
      .then(({ data }) => { if (!cancelled) setItems(data.items || []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / 86400000);

  const overdue = [];
  const dueSoon = [];
  let healthy = 0;
  items.forEach((it) => {
    if (!it.calibrationDueDate) { healthy++; return; }
    const d = daysUntil(it.calibrationDueDate);
    if (d < 0) overdue.push({ ...it, daysOver: -d });
    else if (d <= 30) dueSoon.push({ ...it, daysLeft: d });
    else healthy++;
  });
  overdue.sort((a, b) => b.daysOver - a.daysOver);
  dueSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  const CATEGORY_LABEL = {
    PRESSURE_GAUGE: 'Pressure Gauges',
    VACUUM_GAUGE: 'Vacuum Gauges',
    WEIGHING_BALANCE: 'Weighing Balances',
    TESTING_EQUIPMENT: 'Testing Equipment',
    METROLOGY_INSTRUMENT: 'Metrology Instruments',
    MMR: 'Monitoring & Measuring Resources',
  };
  const CATEGORY_ROUTE = {
    PRESSURE_GAUGE: '/metrology/pressure-gauges',
    VACUUM_GAUGE: '/metrology/vacuum-gauges',
    WEIGHING_BALANCE: '/metrology/weighing-balances',
    TESTING_EQUIPMENT: '/metrology/testing-equipment',
    METROLOGY_INSTRUMENT: '/metrology/metrology-instruments',
    MMR: '/metrology/mmr',
  };

  const perCategory = Object.keys(CATEGORY_LABEL).map((key) => {
    const cat = items.filter((i) => i.category === key);
    let cOverdue = 0;
    let cDue = 0;
    cat.forEach((i) => {
      if (!i.calibrationDueDate) return;
      const d = daysUntil(i.calibrationDueDate);
      if (d < 0) cOverdue++;
      else if (d <= 30) cDue++;
    });
    return { key, total: cat.length, overdue: cOverdue, dueSoon: cDue };
  });

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Metrology')}
        subtitle="Calibration registers across all units — overdue and upcoming due dates"
        eyebrow="Metrology Workspace"
        actions={
          <Button onClick={() => navigate('/metrology')}>
            <Ruler size={16} className="mr-1" /> Open Registers
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Instruments" value={items.length} icon={Ruler} color="navy" onClick={() => navigate('/metrology')} />
        <StatsCard title="Healthy" value={healthy} icon={CheckCircle} color="green" />
        <StatsCard title="Due in 30 days" value={dueSoon.length} icon={Clock} color="yellow" />
        <StatsCard title="Overdue" value={overdue.length} icon={AlertTriangle} color="red" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-600" /> Overdue Calibrations
          </h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/metrology')}>All Registers</Button>
        </div>
        {overdue.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No overdue instruments — everything is current.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Instrument</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Serial</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Due</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Days Over</th>
                </tr>
              </thead>
              <tbody>
                {overdue.slice(0, 10).map((it, i) => (
                  <tr key={it.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate(CATEGORY_ROUTE[it.category] || '/metrology')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{it.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{CATEGORY_LABEL[it.category] || it.category}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{it.serialNo || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{it.unitLocation || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{new Date(it.calibrationDueDate).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><Badge color="red">{it.daysOver}d</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overdue.length > 10 && (
              <p className="text-xs text-gray-400 mt-2 text-center">+ {overdue.length - 10} more overdue</p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Clock size={14} className="text-amber-600" /> Due in Next 30 Days
          </h3>
        </div>
        {dueSoon.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No upcoming calibrations in the next 30 days.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Instrument</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Serial</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Due</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">In</th>
                </tr>
              </thead>
              <tbody>
                {dueSoon.slice(0, 10).map((it, i) => (
                  <tr key={it.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate(CATEGORY_ROUTE[it.category] || '/metrology')}>
                    <td className="px-3 py-2 font-medium text-navy-700">{it.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{CATEGORY_LABEL[it.category] || it.category}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{it.serialNo || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{it.unitLocation || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{new Date(it.calibrationDueDate).toLocaleDateString()}</td>
                    <td className="px-3 py-2"><Badge color="yellow">{it.daysLeft}d</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dueSoon.length > 10 && (
              <p className="text-xs text-gray-400 mt-2 text-center">+ {dueSoon.length - 10} more upcoming</p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Registers by Category</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {perCategory.map((c) => (
            <button
              key={c.key}
              onClick={() => navigate(CATEGORY_ROUTE[c.key])}
              className="text-left p-3 rounded-lg border border-gray-100 hover:border-navy-200 hover:bg-navy-50/40 transition-colors"
            >
              <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{CATEGORY_LABEL[c.key]}</p>
              <p className="text-2xl font-bold text-navy-800 mt-1 tabular-nums">{c.total}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {c.overdue > 0 && <Badge color="red">{c.overdue} overdue</Badge>}
                {c.dueSoon > 0 && <Badge color="yellow">{c.dueSoon} due</Badge>}
                {c.overdue === 0 && c.dueSoon === 0 && <Badge color="green">healthy</Badge>}
              </div>
            </button>
          ))}
        </div>
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
                <tr key={p.id} className={`border-b border-gray-100 transition-colors ${idx % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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

// ──────────────────────────────────────────────────────────────────
// Supply Chain Dashboard — Work Order tracker + on-time delivery %
// ──────────────────────────────────────────────────────────────────
function SupplyChainDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workOrders, setWorkOrders] = useState([]);
  const [stats, setStats] = useState({ completedCount: 0, onTimeCount: 0, onTimePercent: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/work-orders', { params: { limit: 200 } })
      .then(({ data }) => {
        if (cancelled) return;
        setWorkOrders(data.workOrders || []);
        setStats(data.stats || { completedCount: 0, onTimeCount: 0, onTimePercent: null });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const pending = workOrders.filter((w) => w.status === 'PENDING_ADMIN').length;
  const inProgress = workOrders.filter((w) => ['UNIT_ACCEPTED', 'IN_PROGRESS', 'ADMIN_ACCEPTED'].includes(w.status)).length;
  const overdue = workOrders.filter((w) => w.overdue).length;
  const completed = workOrders.filter((w) => ['COMPLETED', 'CLOSED'].includes(w.status)).length;
  const onTimePct = stats.onTimePercent;

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Supply Chain')}
        subtitle="Work orders, PDC tracking and on-time delivery"
        actions={
          <Button onClick={() => navigate('/work-orders')}>
            <ClipboardList size={16} className="mr-1" /> Work Orders
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="On-Time Delivery"
          value={onTimePct != null ? `${onTimePct}%` : '—'}
          subtitle={`${stats.onTimeCount}/${stats.completedCount} on time`}
          icon={TrendingUp}
          color={onTimePct == null ? 'navy' : onTimePct >= 90 ? 'green' : onTimePct >= 70 ? 'yellow' : 'red'}
          onClick={() => navigate('/work-orders')}
        />
        <StatsCard title="Awaiting Admin" value={pending} icon={Clock} color="yellow" onClick={() => navigate('/work-orders')} />
        <StatsCard title="In Progress" value={inProgress} icon={Activity} color="blue" onClick={() => navigate('/work-orders')} />
        <StatsCard title="Overdue" value={overdue} icon={AlertTriangle} color={overdue > 0 ? 'red' : 'green'} onClick={() => navigate('/work-orders')} />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Recent Work Orders <span className="ml-2 text-xs font-normal text-gray-500">({workOrders.length})</span></h3>
          <Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')}>View All</Button>
        </div>
        {workOrders.length === 0 ? (
          <div className="text-center py-6 text-gray-400">No work orders yet</div>
        ) : (
          <div className="space-y-2">
            {workOrders.slice(0, 8).map((w) => {
              const deliveredPct = w.orderQuantity > 0 ? Math.round((w.deliveredQty / w.orderQuantity) * 100) : 0;
              return (
                <div
                  key={w.id}
                  onClick={() => navigate('/work-orders')}
                  className="border rounded-lg p-3 hover:shadow-sm cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-navy-600">{w.workOrderNumber}</span>
                      <Badge color={
                        w.status === 'COMPLETED' ? 'green' :
                        w.status === 'PENDING_ADMIN' ? 'yellow' :
                        w.status === 'REJECTED' ? 'red' : 'blue'
                      }>{w.status.replace('_', ' ')}</Badge>
                      {w.overdue && <Badge color="red">Overdue</Badge>}
                    </div>
                    <p className="text-sm text-navy-800 truncate mt-0.5">{w.customerName} • SO {w.supplyOrderNo}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="text-gray-500">PDC {formatDateTime(w.effectivePdcDate).split(' ')[0]}</p>
                    <p className="font-semibold text-navy-700">{deliveredPct}% — {w.deliveredQty}/{w.orderQuantity}</p>
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

// ──────────────────────────────────────────────────────────────────
// Site Office Dashboard — incoming gate-pass acknowledgements
// SITE_OFFICE acks IN_TRANSIT outward gate passes that have reached
// the destination site (Customer / Sub-contractor / Outside party).
// ──────────────────────────────────────────────────────────────────
function SiteOfficeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [inTransit, setInTransit] = useState([]);
  const [recentlyClosed, setRecentlyClosed] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'IN_TRANSIT', limit: 50 } }),
        api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'CLOSED', limit: 10 } }),
      ]);
      if (cancelled) return;
      const [transitRes, closedRes] = results;
      if (transitRes.status === 'fulfilled') setInTransit(transitRes.value.data.gatePasses || []);
      if (closedRes.status === 'fulfilled') setRecentlyClosed(closedRes.value.data.gatePasses || []);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const now = new Date();
  const startOfWeek = new Date(now.getTime() - 7 * 86400000);
  const closedThisWeek = recentlyClosed.filter(g => g.acknowledgedAt && new Date(g.acknowledgedAt) >= startOfWeek).length;

  const hoursSince = (d) => d ? Math.floor((now - new Date(d)) / 3600000) : 0;
  const urgentCount = inTransit.filter(g => hoursSince(g.dispatchedAt) >= 24).length;
  const urgencyBadge = (hours) => {
    if (hours >= 48) return <Badge color="red">{hours}h waiting</Badge>;
    if (hours >= 24) return <Badge color="yellow">{hours}h waiting</Badge>;
    return <Badge color="blue">{hours}h ago</Badge>;
  };

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Site Office')}
        subtitle="Acknowledge incoming gate passes and confirm receipt of materials"
        eyebrow="Site Office Inbox"
        actions={
          <Button onClick={() => navigate('/gate-pass')}>
            <DoorOpen size={16} className="mr-1" /> Open Gate Pass
          </Button>
        }
      />

      {urgentCount > 0 && (
        <div className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-orange-50 px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 text-red-700 ring-1 ring-red-200">
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-900">{urgentCount} gate pass{urgentCount === 1 ? '' : 'es'} need urgent attention</p>
              <p className="text-xs text-red-700/80 mt-0.5">In transit for over 24 hours — please verify receipt or escalate.</p>
            </div>
          </div>
          <Button size="sm" onClick={() => navigate('/gate-pass')}>Review now <ArrowRight size={14} className="ml-1" /></Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Awaiting Acknowledgement"
          value={inTransit.length}
          subtitle={inTransit.length === 0 ? 'Inbox clear ✓' : 'In transit — need ack'}
          icon={Inbox}
          color={inTransit.length > 0 ? 'red' : 'green'}
          onClick={() => navigate('/gate-pass')}
        />
        <StatsCard
          title="Urgent (>24h)"
          value={urgentCount}
          subtitle="Overdue acknowledgements"
          icon={Clock}
          color={urgentCount > 0 ? 'red' : 'navy'}
          onClick={() => navigate('/gate-pass')}
        />
        <StatsCard
          title="Acked This Week"
          value={closedThisWeek}
          subtitle="Confirmed in last 7 days"
          icon={CheckCircle}
          color="green"
          onClick={() => navigate('/gate-pass')}
        />
        <StatsCard
          title="Recently Closed"
          value={recentlyClosed.length}
          subtitle="Last 10 acknowledgements"
          icon={ClipboardCheck}
          color="navy"
          onClick={() => navigate('/gate-pass')}
        />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-100">
              <Inbox size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Awaiting My Acknowledgement</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Dispatched gate passes that need your sign-off</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/gate-pass')}>Open Gate Pass</Button>
        </div>
        {inTransit.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 mx-auto rounded-full bg-green-50 ring-1 ring-green-100 flex items-center justify-center mb-3">
              <CheckCircle size={26} className="text-green-600" />
            </div>
            <p className="text-sm font-medium text-gray-700">All caught up!</p>
            <p className="text-xs text-gray-500 mt-1">No incoming gate passes need acknowledgement right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pass #</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Kind</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">From</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {inTransit.map((g, i) => {
                  const hrs = hoursSince(g.dispatchedAt);
                  return (
                    <tr
                      key={g.id}
                      className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                      onClick={() => navigate('/gate-pass')}
                    >
                      <td className="px-3 py-2.5 font-medium text-navy-700">{g.passNumber}</td>
                      <td className="px-3 py-2.5">
                        {g.kind ? <Badge color={GP_KIND_COLOR[g.kind]}>{GP_KIND_LABEL[g.kind]}</Badge> : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{g.unit?.name || g.unit?.code || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={11} className="text-gray-400" />
                          {g.destinationOffice || g.partyName || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                        {g.assignedVehicle?.regNumber || g.vehicleNo || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-500">{g.items?.length || 0}</td>
                      <td className="px-3 py-2.5">
                        {g.dispatchedAt ? urgencyBadge(hrs) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-green-50 text-green-700 ring-1 ring-green-100">
              <History size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Recently Acknowledged</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Your last 10 confirmations</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/gate-pass')}>View All</Button>
        </div>
        {recentlyClosed.length === 0 ? (
          <div className="text-center py-8">
            <Clock size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No closed gate passes yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pass #</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Kind</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Acked</th>
                </tr>
              </thead>
              <tbody>
                {recentlyClosed.map((g, i) => (
                  <tr
                    key={g.id}
                    className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                    onClick={() => navigate('/gate-pass')}
                  >
                    <td className="px-3 py-2.5 font-medium text-navy-700">{g.passNumber}</td>
                    <td className="px-3 py-2.5">
                      {g.kind ? <Badge color={GP_KIND_COLOR[g.kind]}>{GP_KIND_LABEL[g.kind]}</Badge> : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{g.destinationOffice || g.partyName || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">
                      {g.acknowledgedAt ? formatDateTime(g.acknowledgedAt) : '—'}
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

// ──────────────────────────────────────────────────────────────────
// Safety Dashboard — read-only oversight across workflows
// SAFETY monitors MIVs, work orders, low stock, and procurement
// activity. Links to the Safety Monitor for deeper drill-down.
// ──────────────────────────────────────────────────────────────────
function SafetyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mivPending, setMivPending] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [prStats, setPrStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        api.get('/requests', { params: { status: 'PENDING', limit: 10 } }),
        api.get('/work-orders', { params: { limit: 50 } }),
        api.get('/alerts/low-stock'),
        api.get('/purchase-requests/dashboard-stats'),
      ]);
      if (cancelled) return;
      const [mivRes, woRes, lowRes, prRes] = results;
      if (mivRes.status === 'fulfilled') setMivPending(mivRes.value.data.requests || []);
      if (woRes.status === 'fulfilled') setWorkOrders(woRes.value.data.workOrders || []);
      if (lowRes.status === 'fulfilled') setLowStock(lowRes.value.data || []);
      if (prRes.status === 'fulfilled') setPrStats(prRes.value.data);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Loader />;

  const openWorkOrders = workOrders.filter(w => !['COMPLETED', 'CLOSED', 'REJECTED'].includes(w.status));
  const overdueWO = workOrders.filter(w => w.overdue).length;
  const criticalLowStock = lowStock.filter(p => p.stockStatus === 'Out of Stock' || p.stockStatus === 'Critical').length;

  const oversightTiles = [
    { to: '/purchase-requests', label: 'Purchase Requests', icon: ShoppingCart, color: 'from-blue-500 to-blue-600' },
    { to: '/quotations',        label: 'Quotations',        icon: FileSearch,   color: 'from-purple-500 to-purple-600' },
    { to: '/purchase-orders',   label: 'Purchase Orders',   icon: Truck,        color: 'from-indigo-500 to-indigo-600' },
    { to: '/payment-requests',  label: 'Payments',          icon: CreditCard,   color: 'from-emerald-500 to-emerald-600' },
    { to: '/qc-inspections',    label: 'QC Inspections',    icon: ClipboardCheck, color: 'from-amber-500 to-amber-600' },
    { to: '/gate-pass',         label: 'Gate Passes',       icon: DoorOpen,     color: 'from-cyan-500 to-cyan-600' },
    { to: '/inventory-transfers', label: 'Transfers',       icon: ArrowLeftRight, color: 'from-pink-500 to-pink-600' },
    { to: '/work-orders',       label: 'Work Orders',       icon: ClipboardList, color: 'from-orange-500 to-orange-600' },
  ];

  return (
    <div className="space-y-6">
      <DashboardHero
        title={greet(user, 'Safety')}
        subtitle="Cross-workflow oversight — MIVs, work orders, procurement, and stock"
        eyebrow="Safety Oversight"
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/safety')}>
              <ShieldCheck size={16} className="mr-1" /> Safety Monitor
            </Button>
            <Button onClick={() => navigate('/all-requests')}>
              <ScrollText size={16} className="mr-1" /> All MIV Requests
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Pending MIVs"
          value={mivPending.length}
          subtitle="Awaiting clearance"
          icon={ClipboardList}
          color="yellow"
          onClick={() => navigate('/all-requests')}
        />
        <StatsCard
          title="Open Work Orders"
          value={openWorkOrders.length}
          subtitle={overdueWO > 0 ? `${overdueWO} overdue` : 'All on schedule'}
          icon={Activity}
          color={overdueWO > 0 ? 'red' : 'blue'}
          onClick={() => navigate('/work-orders')}
        />
        <StatsCard
          title="Critical Low Stock"
          value={criticalLowStock}
          subtitle={`${lowStock.length} total below min`}
          icon={AlertTriangle}
          color={criticalLowStock > 0 ? 'red' : 'green'}
          onClick={() => navigate('/monitoring')}
        />
        <StatsCard
          title="Active POs"
          value={prStats ? (prStats.inProgress || 0) : '—'}
          subtitle="Procurement in motion"
          icon={ShoppingCart}
          color="navy"
          onClick={() => navigate('/purchase-orders')}
        />
      </div>

      {/* Quick-access oversight tiles */}
      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
              <Eye size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Workflow Oversight</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Jump into any workflow for read-only inspection</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/safety')}>Full Monitor</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {oversightTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.to}
                onClick={() => navigate(tile.to)}
                className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-3 hover:shadow-md hover:border-navy-200 transition-all duration-150 text-left"
              >
                <div className={`absolute -right-6 -top-6 w-16 h-16 rounded-full bg-gradient-to-br ${tile.color} opacity-10 group-hover:opacity-20 blur-xl transition-opacity`} />
                <div className={`relative inline-flex p-2 rounded-lg bg-gradient-to-br ${tile.color} text-white shadow-sm`}>
                  <Icon size={16} strokeWidth={2.2} />
                </div>
                <p className="relative text-xs font-semibold text-gray-700 mt-2">{tile.label}</p>
                <p className="relative text-[10px] text-gray-400 mt-0.5 group-hover:text-navy-600 transition-colors">View →</p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-yellow-50 text-yellow-700 ring-1 ring-yellow-100">
              <ClipboardList size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Pending MIV Requests
                <span className="ml-2 text-xs font-normal text-gray-500">({mivPending.length})</span>
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Material issue requests awaiting store clearance</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/all-requests')}>View All</Button>
        </div>
        {mivPending.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto rounded-full bg-green-50 ring-1 ring-green-100 flex items-center justify-center mb-2">
              <CheckCircle size={22} className="text-green-600" />
            </div>
            <p className="text-sm text-gray-600">No pending MIV requests.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Request #</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Manager</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                  <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Items</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Raised</th>
                </tr>
              </thead>
              <tbody>
                {mivPending.map((r, i) => (
                  <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`} onClick={() => navigate('/all-requests')}>
                    <td className="px-3 py-2.5 font-medium text-navy-700">{r.requestNumber}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.manager?.name || '—'}</td>
                    <td className="px-3 py-2.5"><Badge color="blue">{r.unit?.code || '—'}</Badge></td>
                    <td className="px-3 py-2.5 text-center text-gray-600">{r.items?.length || 0}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <Activity size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                Open Work Orders
                <span className="ml-2 text-xs font-normal text-gray-500">({openWorkOrders.length})</span>
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Active supply-chain orders with PDC tracking</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')}>View All</Button>
        </div>
        {openWorkOrders.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto rounded-full bg-gray-50 ring-1 ring-gray-100 flex items-center justify-center mb-2">
              <Activity size={22} className="text-gray-400" />
            </div>
            <p className="text-sm text-gray-600">No open work orders.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {openWorkOrders.slice(0, 8).map((w) => {
              const deliveredPct = w.orderQuantity > 0 ? Math.round((w.deliveredQty / w.orderQuantity) * 100) : 0;
              return (
                <div
                  key={w.id}
                  onClick={() => navigate('/work-orders')}
                  className="group border border-gray-100 rounded-xl p-3 hover:shadow-sm hover:border-navy-200 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-navy-700">{w.workOrderNumber}</span>
                        <Badge color={
                          w.status === 'COMPLETED' ? 'green' :
                          w.status === 'PENDING_ADMIN' ? 'yellow' :
                          w.status === 'REJECTED' ? 'red' : 'blue'
                        }>{w.status.replace('_', ' ')}</Badge>
                        {w.overdue && <Badge color="red">Overdue</Badge>}
                      </div>
                      <p className="text-sm text-navy-800 truncate mt-1">{w.customerName || '—'} <span className="text-gray-400">•</span> SO {w.supplyOrderNo || '—'}</p>
                    </div>
                    <div className="text-right text-xs flex-shrink-0">
                      <p className="text-gray-500 flex items-center justify-end gap-1">
                        <Calendar size={10} />
                        {w.effectivePdcDate ? formatDate(w.effectivePdcDate) : '—'}
                      </p>
                      <p className="font-semibold text-navy-700 mt-0.5">{w.deliveredQty}/{w.orderQuantity} <span className="text-gray-400 font-normal">({deliveredPct}%)</span></p>
                    </div>
                  </div>
                  {w.orderQuantity > 0 && (
                    <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          deliveredPct === 100 ? 'bg-green-500' :
                          w.overdue ? 'bg-red-500' :
                          deliveredPct >= 70 ? 'bg-blue-500' : 'bg-amber-400'
                        }`}
                        style={{ width: `${Math.min(deliveredPct, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {criticalLowStock > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-red-50 text-red-700 ring-1 ring-red-100">
                <AlertTriangle size={15} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Critical Stock Alerts</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Products at zero or critical stock level</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/monitoring')}>Open Monitoring</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/60">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Stock</th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.filter(p => p.stockStatus === 'Out of Stock' || p.stockStatus === 'Critical').slice(0, 10).map((p, i) => (
                  <tr key={p.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-3 py-2.5 font-medium text-gray-700">{p.name}</td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{p.sku}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-semibold ${Number(p.currentStock) === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {p.currentStock} {p.unit}
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><Badge color="red">{p.stockStatus}</Badge></td>
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

function Loader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  let inner;
  if (user?.role === 'ADMIN') inner = <AdminDashboard />;
  else if (['MANAGER', 'LAB', 'PLANNING'].includes(user?.role)) inner = <ManagerDashboard />;
  else if (user?.role === 'LOGISTICS') inner = <LogisticsDashboard />;
  else if (user?.role === 'SITE_OFFICE') inner = <SiteOfficeDashboard />;
  else if (user?.role === 'SAFETY') inner = <SafetyDashboard />;
  else if (user?.role === 'STORE_MANAGER') inner = <StoreManagerDashboard />;
  else if (user?.role === 'SUPPLY_CHAIN') inner = <SupplyChainDashboard />;
  else if (user?.role === 'PURCHASE_OFFICER') inner = <PurchaseOfficerDashboard />;
  else if (['ACCOUNTING', 'FINANCE'].includes(user?.role)) inner = <AccountingDashboard />;
  else if (user?.role === 'METROLOGY') inner = <MetrologyDashboard />;
  else if (['QC', 'NDT', 'RND', 'DESIGNS'].includes(user?.role)) inner = <QCDashboard />;
  else inner = <AdminDashboard />;

  return (
    <div className="space-y-4">
      <SlaTicker />
      {inner}
    </div>
  );
}
