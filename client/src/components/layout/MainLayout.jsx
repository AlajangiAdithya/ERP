import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import InProgressBadge from '../shared/InProgressBadge';

// Paths that live under the Procurement & Inventory Management hub.
// Visiting any of these shows a back link returning the user to /procurement.
const PROCUREMENT_CHILD_PREFIXES = [
  '/products',
  '/purchase-requests',
  '/quotations',
  '/suppliers',
  '/purchase-orders',
  '/payment-requests',
  '/qc-inspections',
  '/inward-entry',
  '/my-requests',
  '/inventory-transfers',
];

function ProcurementBackBar() {
  const { pathname } = useLocation();
  const isChild = PROCUREMENT_CHILD_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isChild) return null;
  return (
    <div className="mb-4">
      <Link
        to="/procurement"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 bg-white hover:bg-navy-50 border border-navy-200 rounded-md px-2.5 py-1.5 shadow-sm transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Procurement &amp; Inventory
      </Link>
    </div>
  );
}

export default function MainLayout({ children }) {
  return (
    <div className="min-h-screen bg-brand-gray">
      <Sidebar />
      <div className="flex flex-col min-w-0 lg:pl-56">
        <Header />
        <main className="flex-1 p-6 animate-fade-in">
          <ProcurementBackBar />
          {children}
        </main>
      </div>
      <InProgressBadge />
    </div>
  );
}
