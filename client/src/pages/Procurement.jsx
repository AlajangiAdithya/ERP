import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Truck, ClipboardCheck, ClipboardList, ArrowLeftRight, ArrowRight,
  FileSearch, CreditCard, Building2, PackagePlus, Package, Sparkles, Boxes,
  GitBranch, FileText, ArrowDown, Download, Paperclip, ScrollText,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';

// ACCOUNTING + FINANCE are admin-level read-only observers across the chain.
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'PLANNING', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];

// Every authenticated role gets Products visibility — stock data is universal.
const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METROLOGY', 'NDT', 'RND', 'SAFETY', 'SUPPLY_CHAIN',
  'DESIGNS', 'FINANCE', 'PLANNING', 'LOGISTICS', 'HR', 'SUPERADMIN',
];

// Narrower visibility for finance-sensitive modules. Unit managers and the
// quality/design departments don't need to see supplier prices or payment runs.
// ACCOUNTING + FINANCE added as read-only observers of the finance-sensitive modules.
const QUOTATION_ROLES = ['ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE'];
const PAYMENT_ROLES   = ['ADMIN', 'PURCHASE_OFFICER', 'ACCOUNTING', 'FINANCE'];

// Inward Entry: Stores actually records inward (write); Manager/QC/Designs/R&D
// can see what's ready and what's been inwarded for traceability (read-only).
// ACCOUNTING + FINANCE get the same read-only traceability view.
const INWARD_ROLES = ['ADMIN', 'STORE_MANAGER', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'ACCOUNTING', 'FINANCE'];

const MODULES = [
  {
    to: '/products',
    icon: Package,
    title: 'Stock Details',
    description: 'Current stock, batches, per-unit balances and FIM lifecycle across the catalogue.',
    roles: ALL_ROLES,
    gradient: 'from-sky-500 via-sky-600 to-cyan-600',
    glow: 'group-hover:shadow-sky-500/40',
    iconBg: 'bg-gradient-to-br from-sky-100 to-cyan-200 text-sky-700',
    ringColor: 'ring-sky-200/60',
  },
  {
    to: '/suppliers',
    icon: Building2,
    title: 'Approved Supplier List',
    description: 'Approved Supplier List, re-evaluation log, assessment forms and performance ratings. Product master data now lives under Stock Details.',
    roles: ['ADMIN', 'MANAGER', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'DESIGNS', 'ACCOUNTING', 'FINANCE'],
    gradient: 'from-fuchsia-500 via-purple-600 to-violet-700',
    glow: 'group-hover:shadow-purple-500/40',
    iconBg: 'bg-gradient-to-br from-fuchsia-100 to-purple-200 text-purple-700',
    ringColor: 'ring-purple-200/60',
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
    to: '/inward-entry',
    icon: PackagePlus,
    title: 'Material Inward Register',
    description: 'Record materials received (PO or direct/cash), request QC, review inline, then inward into stock.',
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
    roles: ['MANAGER', 'LAB', 'QC', 'RND', 'SAFETY', 'DESIGNS', 'METROLOGY', 'NDT', 'PLANNING'],
    gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    glow: 'group-hover:shadow-violet-500/40',
    iconBg: 'bg-gradient-to-br from-violet-100 to-purple-200 text-violet-700',
    ringColor: 'ring-violet-200/60',
  },
  {
    to: '/all-requests',
    icon: ScrollText,
    title: 'All MIV Requests',
    description: 'Every Material Issue Voucher request across units, with full status history.',
    roles: ['ADMIN', 'SAFETY', 'PLANNING', 'ACCOUNTING', 'FINANCE'],
    gradient: 'from-emerald-500 via-teal-500 to-cyan-600',
    glow: 'group-hover:shadow-emerald-500/40',
    iconBg: 'bg-gradient-to-br from-emerald-100 to-teal-200 text-emerald-700',
    ringColor: 'ring-emerald-200/60',
  },
  {
    to: '/inventory-transfers',
    icon: ArrowLeftRight,
    title: 'Inventory Transfers',
    description: 'Move reserved stock between units and departments; track approvals.',
    roles: ['MANAGER', 'LOGISTICS', 'SAFETY', 'ADMIN', 'QC', 'DESIGNS', 'LAB', 'METROLOGY', 'NDT', 'PLANNING', 'ACCOUNTING', 'FINANCE'],
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-600',
    glow: 'group-hover:shadow-rose-500/40',
    iconBg: 'bg-gradient-to-br from-rose-100 to-pink-200 text-rose-700',
    ringColor: 'ring-rose-200/60',
  },
];

export default function Procurement() {
  const { user } = useAuth();
  const role = user?.role;
  const [workflowOpen, setWorkflowOpen] = useState(false);

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

          <button
            type="button"
            onClick={() => setWorkflowOpen(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors"
          >
            <GitBranch size={16} />
            View Workflow
            <ArrowRight size={14} />
          </button>
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

      <WorkflowModal isOpen={workflowOpen} onClose={() => setWorkflowOpen(false)} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Read-only reference flowchart shown from the "View Workflow" button on the
// procurement dashboard. Lists each step, who acts, the status transitions,
// and which documents are downloadable from which screen.
// ───────────────────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  {
    icon: ShoppingCart,
    title: 'Purchase Request (PR)',
    actor: 'Manager / QC / Designs / R&D / Lab / Metrology / NDT',
    to: '/purchase-requests',
    summary: 'Department raises a request for material or services. Lab / Metrology / NDT PRs clear QC first.',
    statuses: ['PENDING_QC', 'PENDING_ADMIN', 'APPROVED'],
    docs: [
      { label: 'PR PDF', detail: 'Open the PR row → "Download PDF" → PR-<requestNumber>.pdf' },
      { label: 'Item spec attachments', detail: 'Each item can carry a spec file (.pdf / image) viewable from the PR detail view.' },
    ],
    color: 'from-blue-500 to-indigo-600',
    ring: 'ring-blue-200',
  },
  {
    icon: FileSearch,
    title: 'Quotations',
    actor: 'Purchase Officer / Store Manager / Admin',
    to: '/quotations',
    summary: 'Collect supplier quotes for the approved PR items and select the winning bid.',
    statuses: ['AWAITING_QUOTATION', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED'],
    docs: [
      { label: 'Supplier quote files', detail: 'Uploaded per supplier under each PR item — download from the Quotation modal.' },
      { label: 'Approved Supplier List', detail: 'Cross-reference at /suppliers before choosing a vendor.' },
    ],
    color: 'from-indigo-500 to-violet-600',
    ring: 'ring-indigo-200',
  },
  {
    icon: Building2,
    title: 'Approved Suppliers (reference)',
    actor: 'Purchase Officer / Manager',
    to: '/suppliers',
    summary: 'Verify vendor onboarding documents before quoting and ordering.',
    statuses: ['APPROVED', 'CONDITIONAL', 'REJECTED', 'TERMINATED'],
    docs: [
      { label: 'Vendor Evaluation PDF', detail: 'One-time onboarding doc — open the supplier row to download.' },
      { label: 'Supplier Assessment PDF', detail: 'FY-bound — must be re-uploaded each new financial year.' },
      { label: 'Supplier Re-Evaluation Form', detail: 'Latest per FY shown in the Evaluation Details panel.' },
      { label: 'Performance Ratings', detail: 'Generated from PO history; viewable inline on each supplier.' },
    ],
    color: 'from-slate-500 to-gray-700',
    ring: 'ring-slate-200',
  },
  {
    icon: Truck,
    title: 'Purchase Order (PO)',
    actor: 'Purchase Officer → Accounting',
    to: '/purchase-orders',
    summary: 'PO issued to the chosen supplier; accounting clears credit or advance.',
    statuses: ['PENDING_ACCOUNTING', 'CREDIT_PLACED', 'PLACED', 'ORDERED', 'GOODS_ARRIVED'],
    docs: [
      { label: 'PO PDF', detail: 'Generated per PO with the standard Terms & Conditions annexure (/po-terms-and-conditions.pdf).' },
      { label: 'Supplier Invoice PDF', detail: 'Uploaded against the PO when goods arrive (required for QC).' },
    ],
    color: 'from-emerald-500 to-green-600',
    ring: 'ring-emerald-200',
  },
  {
    icon: CreditCard,
    title: 'Payment Requests',
    actor: 'Purchase Officer / Accounting',
    to: '/payment-requests',
    summary: 'Advance, partial, or final payment raised against the PO and cleared by accounting.',
    statuses: ['PENDING', 'APPROVED', 'PAID'],
    docs: [
      { label: 'Internal ledger record', detail: 'No standalone PDF — visible on the Payment Requests screen and on the PO history.' },
    ],
    color: 'from-teal-500 to-sky-500',
    ring: 'ring-teal-200',
  },
  {
    icon: PackagePlus,
    title: 'Material Inward Register + QC',
    actor: 'Stores → QC → Stores',
    to: '/inward-entry',
    summary: 'When material reaches the store, Stores logs it (PO or direct), requests QC, QC reviews inline, then Stores inwards the accepted qty into stock.',
    statuses: ['DRAFT', 'QC_REQUESTED', 'QC_IN_REVIEW', 'QC_DONE', 'INWARDED'],
    docs: [
      { label: 'MIR row', detail: 'One register row per material line — carries vehicle, document, batch, expiry, issued-to and the QC report remark.' },
      { label: 'MIV back-link', detail: 'The MIV no. column auto-fills when a unit later draws the batch.' },
    ],
    color: 'from-orange-500 to-yellow-500',
    ring: 'ring-orange-200',
  },
  {
    icon: ClipboardList,
    title: 'MIV Requests (Store withdrawals)',
    actor: 'Manager / Lab / QC / R&D',
    to: '/my-requests',
    summary: 'Departments raise Material Issue Voucher requests to withdraw stock from stores.',
    statuses: ['PENDING', 'APPROVED', 'ISSUED'],
    docs: [
      { label: 'MIV slip', detail: 'Printable issue voucher generated when stores issue the material.' },
    ],
    color: 'from-violet-500 to-fuchsia-500',
    ring: 'ring-violet-200',
  },
  {
    icon: ArrowLeftRight,
    title: 'Inventory Transfers & Stock',
    actor: 'Manager / Logistics / Safety',
    to: '/inventory-transfers',
    summary: 'Move stock between units; track balances and movement history.',
    statuses: ['PENDING', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'],
    docs: [
      { label: 'Stock Statement PDF', detail: 'Generated on the Stock Movements screen (per-date snapshot).' },
      { label: 'Stock Statement CSV', detail: 'From /products → "Download Stock Statement" button.' },
    ],
    color: 'from-rose-500 to-pink-600',
    ring: 'ring-rose-200',
  },
];

function WorkflowModal({ isOpen, onClose }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Procurement Workflow & Documents" size="full">
      <div className="space-y-2">
        <p className="text-sm text-gray-600">
          End-to-end flow of how a purchase request travels through the system, who acts at each
          stage, and where to download or upload the supporting documents. This is read-only — use
          the linked module on each step to actually take action.
        </p>

        <div className="mt-4 space-y-3">
          {WORKFLOW_STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div key={step.title}>
                <div className="relative rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className={`h-1 bg-gradient-to-r ${step.color}`} />
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      {/* Step number + icon */}
                      <div className="flex items-center gap-3 sm:flex-col sm:items-center sm:w-20 shrink-0">
                        <div className={`relative w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} text-white flex items-center justify-center shadow-md ring-2 ${step.ring}`}>
                          <Icon size={22} strokeWidth={2.2} />
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white text-[10px] font-bold text-navy-700 ring-1 ring-gray-200 flex items-center justify-center">
                            {idx + 1}
                          </span>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-base font-semibold text-navy-800">{step.title}</h3>
                            <p className="text-xs text-gray-500 mt-0.5">
                              <span className="font-medium text-gray-700">Who:</span> {step.actor}
                            </p>
                          </div>
                          <Link
                            to={step.to}
                            onClick={onClose}
                            className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-900 bg-navy-50 hover:bg-navy-100 px-2.5 py-1 rounded-md transition-colors"
                          >
                            Go to module <ArrowRight size={12} />
                          </Link>
                        </div>

                        <p className="mt-2 text-sm text-gray-600 leading-relaxed">{step.summary}</p>

                        {/* Status chips */}
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status flow:</span>
                          {step.statuses.map((s, i) => (
                            <span key={s} className="inline-flex items-center gap-1">
                              <span className="px-2 py-0.5 rounded-md bg-gray-100 text-[11px] font-mono text-gray-700 border border-gray-200">
                                {s}
                              </span>
                              {i < step.statuses.length - 1 && (
                                <ArrowRight size={10} className="text-gray-300" />
                              )}
                            </span>
                          ))}
                        </div>

                        {/* Documents */}
                        <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                            <FileText size={12} />
                            Documents
                          </div>
                          <ul className="space-y-1.5">
                            {step.docs.map((d) => (
                              <li key={d.label} className="flex items-start gap-2 text-sm">
                                <Download size={14} className="text-navy-600 mt-0.5 shrink-0" />
                                <div>
                                  <span className="font-medium text-navy-800">{d.label}</span>
                                  <span className="text-gray-600"> — {d.detail}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {idx < WORKFLOW_STEPS.length - 1 && (
                  <div className="flex justify-center py-1.5">
                    <ArrowDown size={18} className="text-gray-300" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 flex items-start gap-2">
          <Paperclip size={14} className="mt-0.5 shrink-0" />
          <span>
            Tip: every PDF download is gated by your role. If a "Download" button is missing on a row,
            check with admin — your role may not have read access to that document type.
          </span>
        </div>
      </div>
    </Modal>
  );
}
