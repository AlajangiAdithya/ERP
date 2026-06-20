import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import InProgressBadge from '../shared/InProgressBadge';
import ImpersonationBanner from '../superadmin/ImpersonationBanner';

// Hub → child-route map. Visiting any child path shows a back link returning
// the user to the parent hub. Add new hubs here; everything else is wired up.
const HUB_CHILDREN = [
  {
    hubPath: '/procurement',
    hubLabel: 'Procurement & Inventory',
    childPrefixes: [
      '/products',
      '/purchase-requests',
      '/quotations',
      '/suppliers',
      '/purchase-orders',
      '/payment-requests',
      '/inward-entry',
      '/my-requests',
      '/inventory-transfers',
    ],
  },
  {
    hubPath: '/monitoring',
    hubLabel: 'Monitoring',
    childPrefixes: [
      '/stock-movements',
      '/audit-logs',
      '/unit-usage',
    ],
  },
];

function HubBackBar() {
  const { pathname } = useLocation();
  const hub = HUB_CHILDREN.find((h) =>
    h.childPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
  );
  if (!hub) return null;
  return (
    <div className="mb-4">
      <Link
        to={hub.hubPath}
        className="group inline-flex items-center gap-1.5 text-xs font-semibold text-navy-700 bg-white hover:bg-navy-50 border border-navy-200 hover:border-navy-300 rounded-lg px-3 py-1.5 shadow-sm transition-all"
      >
        <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
        Back to {hub.hubLabel}
      </Link>
    </div>
  );
}

export default function MainLayout({ children }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="flex flex-col min-w-0 lg:pl-56">
        <Header />
        <main className="flex-1 p-6 animate-fade-in">
          <HubBackBar />
          {children}
        </main>
      </div>
      <InProgressBadge />
      <ImpersonationBanner />
    </div>
  );
}
