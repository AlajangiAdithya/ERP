import { Link } from 'react-router-dom';
import {
  ShoppingCart, Truck, ClipboardCheck, ClipboardList, ArrowLeftRight, ArrowRight,
  FileSearch, CreditCard, Building2, PackagePlus, Package, Sparkles, Boxes,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING'];

// Every authenticated role gets Products visibility — stock data is universal.
const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METROLOGY', 'NDT', 'RND', 'SAFETY', 'SUPPLY_CHAIN',
  'DESIGNS', 'FINANCE', 'PLANNING', 'LOGISTICS', 'SUPERADMIN',
];

// Narrower visibility for finance-sensitive modules. Unit managers and the
// quality/design departments don't need to see supplier prices or payment runs.
const QUOTATION_ROLES = ['ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER'];
const PAYMENT_ROLES   = ['ADMIN', 'PURCHASE_OFFICER', 'ACCOUNTING'];

// Inward Entry: Stores actually records inward (write); Manager/QC/Designs/R&D
// can see what's ready and what's been inwarded for traceability (read-only).
const INWARD_ROLES = ['ADMIN', 'STORE_MANAGER', 'MANAGER', 'QC', 'DESIGNS', 'RND'];

const MODULES = [
  {
    to: '/products',
    icon: Package,
    title: 'Products',
    description: 'Browse the product catalogue, current stock, and per-unit balances.',
    roles: ALL_ROLES,
    gradient: 'from-sky-500 via-sky-600 to-cyan-600',
    glow: 'group-hover:shadow-sky-500/40',
    iconBg: 'bg-gradient-to-br from-sky-100 to-cyan-200 text-sky-700',
    ringColor: 'ring-sky-200/60',
  },
  {
    to: '/purchase-requests',
    icon: ShoppingCart,
    title: 'Purchase Requests',
    titleFor: { PURCHASE_OFFICER: 'Purchase Assignments' },
    description: 'Raise and track material purchase requests across departments.',
    roles: CHAIN_ROLES,
    gradient: 'from-blue-500 via-blue-600 to-indigo-600',
    glow: 'group-hover:shadow-blue-500/40',
    iconBg: 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700',
    ringColor: 'ring-blue-200/60',
  },
  {
    to: '/quotations',
    icon: FileSearch,
    title: 'Quotations',
    description: 'Collect supplier quotations and select winning bids.',
    roles: QUOTATION_ROLES,
    gradient: 'from-indigo-500 via-violet-500 to-purple-600',
    glow: 'group-hover:shadow-indigo-500/40',
    iconBg: 'bg-gradient-to-br from-indigo-100 to-violet-200 text-indigo-700',
    ringColor: 'ring-indigo-200/60',
  },
  {
    to: '/purchase-orders',
    icon: Truck,
    title: 'Purchase Orders',
    description: 'Issue purchase orders to suppliers and monitor delivery status.',
    roles: CHAIN_ROLES,
    gradient: 'from-emerald-500 via-emerald-600 to-green-600',
    glow: 'group-hover:shadow-emerald-500/40',
    iconBg: 'bg-gradient-to-br from-emerald-100 to-green-200 text-emerald-700',
    ringColor: 'ring-emerald-200/60',
  },
  {
    to: '/payment-requests',
    icon: CreditCard,
    title: 'Payment Requests',
    description: 'Raise, approve, and clear supplier payment requests.',
    roles: PAYMENT_ROLES,
    gradient: 'from-teal-500 via-cyan-500 to-sky-500',
    glow: 'group-hover:shadow-teal-500/40',
    iconBg: 'bg-gradient-to-br from-teal-100 to-cyan-200 text-teal-700',
    ringColor: 'ring-teal-200/60',
  },
  {
    to: '/suppliers',
    icon: Building2,
    title: 'Suppliers',
    description: 'Manage approved vendor list and supplier contact details.',
    roles: CHAIN_ROLES,
    gradient: 'from-slate-500 via-slate-600 to-gray-700',
    glow: 'group-hover:shadow-slate-500/40',
    iconBg: 'bg-gradient-to-br from-slate-100 to-gray-200 text-slate-700',
    ringColor: 'ring-slate-200/60',
  },
  {
    to: '/qc-inspections',
    icon: ClipboardCheck,
    title: 'QC Inspections',
    description: 'Inspect inward materials and record quality acceptance results.',
    roles: CHAIN_ROLES,
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    glow: 'group-hover:shadow-amber-500/40',
    iconBg: 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-700',
    ringColor: 'ring-amber-200/60',
  },
  {
    to: '/inward-entry',
    icon: PackagePlus,
    title: 'Inward Entry',
    description: 'Receive QC-passed materials into stores and track FIM acceptance.',
    roles: INWARD_ROLES,
    gradient: 'from-orange-500 via-amber-500 to-yellow-500',
    glow: 'group-hover:shadow-orange-500/40',
    iconBg: 'bg-gradient-to-br from-orange-100 to-amber-200 text-orange-700',
    ringColor: 'ring-orange-200/60',
  },
  {
    to: '/my-requests',
    icon: ClipboardList,
    title: 'MIV Requests',
    description: 'Material Issue Voucher requests for store withdrawals.',
    roles: ['MANAGER', 'LAB'],
    gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    glow: 'group-hover:shadow-violet-500/40',
    iconBg: 'bg-gradient-to-br from-violet-100 to-purple-200 text-violet-700',
    ringColor: 'ring-violet-200/60',
  },
  {
    to: '/inventory-transfers',
    icon: ArrowLeftRight,
    title: 'Inventory Transfers',
    description: 'Move stock between units and track transfer approvals.',
    roles: ['MANAGER', 'LOGISTICS', 'SAFETY'],
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-600',
    glow: 'group-hover:shadow-rose-500/40',
    iconBg: 'bg-gradient-to-br from-rose-100 to-pink-200 text-rose-700',
    ringColor: 'ring-rose-200/60',
  },
];

export default function Procurement() {
  const { user } = useAuth();
  const role = user?.role;

  const visible = MODULES.filter((m) => m.roles.includes(role));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-indigo-900 px-7 py-7 text-white shadow-2xl">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-6 opacity-10">
          <Boxes size={140} strokeWidth={1} />
        </div>

        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-200/80 font-semibold">
            <Sparkles size={14} className="text-blue-300" />
            <span>Procurement Workspace</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Procurement &amp; Inventory Management</h1>
          <p className="text-sm text-blue-100/90 mt-2 max-w-2xl leading-relaxed">
            A single workspace for products, purchase, quality, and material movement workflows
            across the entire supply chain.
          </p>
        </div>
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
                className={`group relative block rounded-2xl bg-white border border-navy-100/60 shadow-card
                  hover:-translate-y-1 hover:shadow-2xl ${m.glow}
                  transition-all duration-300 overflow-hidden`}
              >
                <div className={`h-1.5 bg-gradient-to-r ${m.gradient}`} />
                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${m.gradient} opacity-0 group-hover:opacity-20 blur-2xl transition-opacity duration-500 pointer-events-none`} />

                <div className="p-5 relative">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`p-3 rounded-xl ${m.iconBg} ring-1 ${m.ringColor} shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                      <Icon size={22} strokeWidth={2.2} />
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-navy-800 group-hover:text-navy-900 leading-snug">
                    {(m.titleFor && m.titleFor[role]) || m.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed line-clamp-2">{m.description}</p>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 group-hover:text-navy-800 group-hover:gap-2 transition-all">
                      Open module
                      <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
