import { Link } from 'react-router-dom';
import {
  ShoppingCart, Truck, ClipboardCheck, ClipboardList, ArrowLeftRight, ArrowRight,
  FileSearch, CreditCard, Building2, PackagePlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING'];

// Narrower visibility for finance-sensitive modules. Unit managers and the
// quality/design departments don't need to see supplier prices or payment runs.
const QUOTATION_ROLES = ['ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER'];
const PAYMENT_ROLES   = ['ADMIN', 'PURCHASE_OFFICER', 'ACCOUNTING'];

// Inward Entry: Stores actually records inward (write); Manager/QC/Designs/R&D
// can see what's ready and what's been inwarded for traceability (read-only).
const INWARD_ROLES = ['ADMIN', 'STORE_MANAGER', 'MANAGER', 'QC', 'DESIGNS', 'RND'];

const MODULES = [
  {
    to: '/purchase-requests',
    icon: ShoppingCart,
    title: 'Purchase Requests',
    titleFor: { PURCHASE_OFFICER: 'Purchase Assignments' },
    description: 'Raise and track material purchase requests across departments.',
    roles: CHAIN_ROLES,
    accent: 'from-blue-500 to-blue-600',
    iconBg: 'bg-blue-50 text-blue-600',
  },
  {
    to: '/quotations',
    icon: FileSearch,
    title: 'Quotations',
    description: 'Collect supplier quotations and select winning bids.',
    roles: QUOTATION_ROLES,
    accent: 'from-indigo-500 to-indigo-600',
    iconBg: 'bg-indigo-50 text-indigo-600',
  },
  {
    to: '/purchase-orders',
    icon: Truck,
    title: 'Purchase Orders',
    description: 'Issue purchase orders to suppliers and monitor delivery status.',
    roles: CHAIN_ROLES,
    accent: 'from-emerald-500 to-emerald-600',
    iconBg: 'bg-emerald-50 text-emerald-600',
  },
  {
    to: '/payment-requests',
    icon: CreditCard,
    title: 'Payment Requests',
    description: 'Raise, approve, and clear supplier payment requests.',
    roles: PAYMENT_ROLES,
    accent: 'from-teal-500 to-teal-600',
    iconBg: 'bg-teal-50 text-teal-600',
  },
  {
    to: '/suppliers',
    icon: Building2,
    title: 'Suppliers',
    description: 'Manage approved vendor list and supplier contact details.',
    roles: CHAIN_ROLES,
    accent: 'from-slate-500 to-slate-600',
    iconBg: 'bg-slate-50 text-slate-600',
  },
  {
    to: '/qc-inspections',
    icon: ClipboardCheck,
    title: 'QC Inspections',
    description: 'Inspect inward materials and record quality acceptance results.',
    roles: CHAIN_ROLES,
    accent: 'from-amber-500 to-amber-600',
    iconBg: 'bg-amber-50 text-amber-600',
  },
  {
    to: '/inward-entry',
    icon: PackagePlus,
    title: 'Inward Entry',
    description: 'Receive QC-passed materials into stores and track FIM acceptance.',
    roles: INWARD_ROLES,
    accent: 'from-orange-500 to-orange-600',
    iconBg: 'bg-orange-50 text-orange-600',
  },
  {
    to: '/my-requests',
    icon: ClipboardList,
    title: 'MIV Requests',
    description: 'Material Issue Voucher requests for store withdrawals.',
    roles: ['MANAGER', 'LAB'],
    accent: 'from-violet-500 to-violet-600',
    iconBg: 'bg-violet-50 text-violet-600',
  },
  {
    to: '/inventory-transfers',
    icon: ArrowLeftRight,
    title: 'Inventory Transfers',
    description: 'Move stock between units and track transfer approvals.',
    roles: ['MANAGER', 'LOGISTICS', 'SAFETY'],
    accent: 'from-rose-500 to-rose-600',
    iconBg: 'bg-rose-50 text-rose-600',
  },
];

export default function Procurement() {
  const { user } = useAuth();
  const role = user?.role;

  const visible = MODULES.filter((m) => m.roles.includes(role));

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-navy-800 to-navy-700 rounded-2xl px-6 py-6 text-white shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">Procurement</h1>
        <p className="text-sm text-blue-100/90 mt-1">
          A single workspace for purchase, quality, and material movement workflows.
        </p>
      </div>

      {visible.length === 0 ? (
        <Card>
          <p className="text-center text-gray-500 py-6">
            You don't have access to any procurement modules.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map((m) => {
            const Icon = m.icon;
            return (
              <Link
                key={m.to}
                to={m.to}
                className="group block rounded-xl bg-white border border-navy-100/60 shadow-card hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 overflow-hidden"
              >
                <div className={`h-1 bg-gradient-to-r ${m.accent}`} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`p-2.5 rounded-lg ${m.iconBg}`}>
                      <Icon size={22} strokeWidth={2} />
                    </div>
                    <ArrowRight
                      size={18}
                      className="text-gray-300 group-hover:text-navy-700 group-hover:translate-x-1 transition-all duration-150"
                    />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-navy-800">
                    {(m.titleFor && m.titleFor[role]) || m.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">{m.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
