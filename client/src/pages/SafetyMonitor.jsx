import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, ShoppingCart, FileSearch, Truck, CreditCard, ClipboardCheck,
  ScrollText, BarChart3, DoorOpen, ArrowLeftRight, FlaskConical, Briefcase,
  History, FileText,
} from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';

const TILES = [
  { to: '/purchase-requests',   label: 'Purchase Requests',   icon: ShoppingCart,   endpoint: '/purchase-requests',   key: 'requests' },
  { to: '/quotations',          label: 'Quotations',          icon: FileSearch,     endpoint: '/quotations',          key: 'quotations' },
  { to: '/purchase-orders',     label: 'Purchase Orders',     icon: Truck,          endpoint: '/purchase-orders',     key: 'orders' },
  { to: '/payment-requests',    label: 'Payment Requests',    icon: CreditCard,     endpoint: '/payment-requests',    key: 'paymentRequests' },
  { to: '/qc-inspections',      label: 'QC Inspections',      icon: ClipboardCheck, endpoint: '/qc-inspections',      key: 'inspections' },
  { to: '/all-requests',        label: 'MIV Requests',        icon: ScrollText,     endpoint: '/requests',            key: 'requests' },
  { to: '/stock-movements',     label: 'Stock Movements',     icon: BarChart3,      endpoint: '/inventory/movements', key: 'movements' },
  { to: '/gate-pass',           label: 'Gate Passes',         icon: DoorOpen,       endpoint: '/gatepasses',          key: 'gatePasses' },
  { to: '/inventory-transfers', label: 'Inventory Transfers', icon: ArrowLeftRight, endpoint: '/inventory-transfers', key: 'transfers' },
  { to: '/ion',                 label: 'Inter Office Notes',  icon: FlaskConical,   endpoint: '/ion',                 key: 'ions' },
  { to: '/tenders',             label: 'Tenders',             icon: Briefcase,      endpoint: '/tenders',             key: 'tenders' },
  { to: '/audit-logs',          label: 'Audit Logs',          icon: FileText,       endpoint: '/reports/audit-logs',  key: 'logs' },
  { to: '/unit-usage',          label: 'Unit Usage',          icon: History,        endpoint: '/reports/unit-usage',  key: 'logs' },
];

export default function SafetyMonitor() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      TILES.map((t) =>
        api.get(t.endpoint, { params: { limit: 1 } })
          .then(({ data }) => ({ to: t.to, total: data.total ?? (Array.isArray(data[t.key]) ? data[t.key].length : 0) }))
          .catch(() => ({ to: t.to, total: null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map = {};
      results.forEach((r) => { map[r.to] = r.total; });
      setCounts(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
          <ShieldCheck size={24} className="text-blue-600" /> Safety Monitor
        </h1>
        <p className="text-sm text-navy-600">Read-only overview of every workflow across the organisation.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {TILES.map((tile) => {
          const Icon = tile.icon;
          const total = counts[tile.to];
          return (
            <Link key={tile.to} to={tile.to}>
              <Card className="p-4 hover:shadow-md hover:border-blue-300 transition cursor-pointer h-full">
                <div className="flex items-start justify-between">
                  <Icon size={22} className="text-navy-600" />
                  <span className="text-xs text-navy-400">View →</span>
                </div>
                <p className="text-sm font-medium text-navy-900 mt-3">{tile.label}</p>
                <p className="text-2xl font-bold text-navy-800 mt-1">
                  {loading ? '…' : (total ?? '—')}
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
