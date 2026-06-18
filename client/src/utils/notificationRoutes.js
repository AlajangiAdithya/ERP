// Single source of truth: which page a notification opens when clicked.
// Used by the Notifications inbox (list items), the in-app toast popups, so the
// two never drift. The server keeps an identical copy at
// server/src/utils/notificationRoutes.js for OS-tray push clicks — keep both in
// sync when adding a new notification type.
//
// Any type not listed falls back to the inbox itself (safe no-op: the user is
// already looking at their notifications).
export const NOTIFICATION_ROUTES = {
  // Inventory / stock
  LOW_STOCK: '/products',

  // Material issue requests (MIV)
  NEW_REQUEST: '/request-clearance',
  REQUEST_APPROVED: '/my-requests',
  REQUEST_REJECTED: '/my-requests',

  // Inventory transfers
  TRANSFER_REQUEST: '/inventory-transfers',
  TRANSFER_APPROVED: '/inventory-transfers',
  TRANSFER_REJECTED: '/inventory-transfers',

  // Payments
  PAYMENT_REQUEST: '/payment-requests',
  PAYMENT_APPROVED: '/payment-requests',
  PAYMENT_PROCESSED: '/payment-requests',
  PAYMENT_REJECTED: '/payment-requests',

  // Purchase orders
  GOODS_ARRIVED: '/purchase-orders',
  INWARD_COMPLETE: '/purchase-orders',
  PARTIAL_DELIVERY: '/purchase-orders',
  ITEM_STATUS_UPDATE: '/purchase-orders',
  ORDER_PLACED: '/purchase-orders',
  ORDER_PLACED_ON_CREDIT: '/purchase-orders',
  PO_FORCE_CLOSED: '/purchase-orders',
  PO_CLOSED: '/purchase-orders',

  // Inward entry + QC
  INSPECTION_REQUEST: '/inward-entry',
  QC_PASSED: '/inward-entry',
  QC_FAILED: '/inward-entry',
  QC_ON_HOLD: '/inward-entry',
  QC_RE_REVIEW: '/inward-entry',
  INWARD_QC_REQUEST: '/inward-entry',
  INWARD_QC_DONE: '/inward-entry',
  INWARD_QC_HOLD: '/inward-entry',

  // Purchase requests / inspections
  INSPECTION_PASSED: '/purchase-requests',
  INSPECTION_FAILED: '/purchase-requests',
  INSPECTION_PARTIAL: '/purchase-requests',
  NEW_PURCHASE_REQUEST: '/purchase-requests',
  PURCHASE_REQUEST_APPROVED: '/purchase-requests',
  PURCHASE_REQUEST_REJECTED: '/purchase-requests',
  NEW_PURCHASE_ASSIGNMENT: '/purchase-requests',
  PURCHASE_COMPLETED: '/purchase-requests',
  PR_CLOSED: '/purchase-requests',

  // Inter-office notes
  ION_RECEIVED: '/ion',
  ION_STATUS_UPDATE: '/ion',

  // Quotations
  QUOTATION_REVIEW: '/quotations',
  QUOTATION_APPROVED: '/quotations',
  QUOTATION_HOLD: '/quotations',
  QUOTATION_RESUBMITTED: '/quotations',

  // Work orders + closure lifecycle
  WORK_ORDER_PENDING_ADMIN: '/work-orders',
  WORK_ORDER_ASSIGNED_TO_UNIT: '/work-orders',
  WORK_ORDER_UNIT_ACCEPTED: '/work-orders',
  WORK_ORDER_UNIT_REJECTED: '/work-orders',
  WORK_ORDER_ADMIN_ACCEPTED: '/work-orders',
  WORK_ORDER_REJECTED: '/work-orders',
  WO_CLOSURE_UPDATE: '/work-orders',
  WO_CLOSURE_QC_PENDING: '/work-orders',
  WO_CLOSURE_MGMT_PENDING: '/work-orders',
  WO_CLOSURE_FINANCE_PENDING: '/work-orders',
  WO_CLOSURE_ON_HOLD: '/work-orders',
  WO_CLOSURE_HOLD_RESOLVED: '/work-orders',
  WO_CLOSURE_SLA_REMINDER: '/work-orders',
  WO_CLOSURE_SLA_BREACH: '/work-orders',
  WO_CLOSURE_PAYMENT_DELAYED: '/work-orders',
  WO_CLOSURE_WEEKLY_FOLLOWUP: '/work-orders',
  WO_PDC_3MONTH_ALERT: '/work-orders',

  // Gate pass
  GATE_PASS_REQUEST: '/gate-pass',
  GATE_PASS_STAGE: '/gate-pass',
  GATE_PASS_APPROVED: '/gate-pass',
  GATE_PASS_REJECTED: '/gate-pass',
  GATE_PASS_INWARD: '/gate-pass',
  GATE_PASS_COLLECTED: '/gate-pass',

  // Messaging
  MESSAGE_RECEIVED: '/messaging',
  MESSAGE_DONE: '/messaging',

  // Generic / system — no dedicated page, stay in the inbox.
  // (INFO is the attendance-submitted alert; that page is currently hidden.)
  INFO: '/notifications',
  BROADCAST: '/notifications',
};

// Resolve a notification type to the page it should open. Unknown types stay
// in the inbox rather than dumping the user on the dashboard.
export function notificationRoute(type) {
  return NOTIFICATION_ROUTES[type] || '/notifications';
}
