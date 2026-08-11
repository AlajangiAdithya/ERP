// Table catalogue for the raw row editors (the SUPERADMIN Real-time Corrections
// page and the DATA_EDITOR Edit Data page).
//
// Two jobs:
//
//  1. GROUPS + labels. Every Prisma model is editable, but a flat A–Z list of 84
//     schema names is not something an operator can find anything in. Each model
//     is filed under a business area and given a readable name, so all the data
//     is actually reachable rather than merely present.
//
//  2. VIRTUAL TABLES. A virtual table is a REAL model plus a fixed filter,
//     published under a business-facing name. FIM entries, for example, are
//     GatePass rows sharing a table with every outward gate pass — so "FIM
//     Entry" lists only the FIM rows and writes straight back to GatePass.
//     Reads, updates and deletes all stay inside the filter, so a curated view
//     can never be used to reach a row outside it; inserts get the view's
//     defining columns forced on so a new row lands where it was created.

// A GatePass row is a FIM / customer-property entry when it is INWARD — the
// same filter the FIM register itself uses (InwardEntry → Inward FIM tab), so
// every row an operator can see there is reachable here. Deliberately NOT
// narrowed to `fimNumber != null`: that column is only stamped on newer STORES
// entries, and legacy rows would silently drop out of the view.
const FIM_GATEPASS_WHERE = { direction: 'INWARD' };

const FIM_GROUP = 'FIM / Customer Property';

const VIRTUAL_TABLES = {
  FimEntry: {
    model: 'GatePass',
    label: 'FIM Entry',
    hint: 'Customer FIM / free-issue-material inward entries — the FIM register',
    group: FIM_GROUP,
    where: FIM_GATEPASS_WHERE,
    createDefaults: { direction: 'INWARD' },
  },
  FimEntryItem: {
    model: 'GatePassItem',
    label: 'FIM Entry — Items',
    hint: 'Line items recorded on a FIM inward entry',
    group: FIM_GROUP,
    where: { gatePass: FIM_GATEPASS_WHERE },
    // A line can only be attached to a gate pass that is itself a FIM entry.
    parent: { fk: 'gatePassId', model: 'GatePass', where: FIM_GATEPASS_WHERE },
  },
  FimBatch: {
    model: 'ProductBatch',
    label: 'FIM Batch',
    hint: 'Stock batches created from FIM material (unit assignment, acceptance, return)',
    group: FIM_GROUP,
    where: { isFim: true },
    createDefaults: { isFim: true },
  },
};

// Every model, filed by business area. Order here is the order the editor shows
// them in. Anything missing (a newly added model) falls into "Other" rather than
// disappearing — see assertCatalogueCovers* below.
const GROUPS = {
  [FIM_GROUP]: ['FimTestReport'],
  'Procurement — Requests': [
    'PurchaseRequest', 'PurchaseRequestItem', 'PurchaseRequestAttachment',
    'PurchaseRequestItemAttachment', 'PurchaseRequestDateHistory',
    'ProductRequest', 'RequestItem', 'MaterialPool', 'MaterialPoolItem',
  ],
  'Procurement — Quotations & Orders': [
    'Quotation', 'QuotationItem', 'QuotationSource',
    'PurchaseOrder', 'PurchaseOrderItem', 'PurchaseOrderItemAllocation',
    'PurchaseOrderNumberHistory', 'PurchaseOrderSource', 'PaymentRequest',
  ],
  Suppliers: [
    'Supplier', 'SupplierAssessmentForm', 'SupplierVendorEvaluation',
    'SupplierReEvaluation', 'SupplierPerformanceRating', 'SupplierPerformanceRatingItem',
  ],
  'Stores & Inventory': [
    'Product', 'ProductBatch', 'ProductSpec', 'ProductDeptStock', 'ProductUnitStock',
    'ProductEditHistory', 'StockMovement', 'MaterialInwardRegister', 'InventoryTransferRequest',
  ],
  'Quality Control': ['QCInspection', 'QCInspectionItem'],
  'Work Orders': [
    'WorkOrder', 'WorkOrderItem', 'WorkOrderAlarm', 'WorkOrderAlarmNote',
    'WorkOrderBgEntry', 'WorkOrderInsuranceEntry', 'WorkOrderExtension',
    'WorkOrderHoldRequest', 'WorkOrderPdcChange', 'WorkOrderEditHistory', 'WorkOrderInvoice',
  ],
  'Work Order Closure': [
    'WorkOrderClosure', 'WorkOrderClosureItem', 'WorkOrderClosureDoc',
    'WorkOrderClosureWeeklyFollowup',
  ],
  'Gate Pass & Logistics': [
    'GatePass', 'GatePassItem', 'GatePassMivLink', 'Vehicle', 'VehicleTrip', 'Driver',
  ],
  'Machinery & Safety': ['Machinery', 'MachineAllocation', 'MachineDowntime', 'FireExtinguisher'],
  'Metrology & Calibration': ['CalibrationItem', 'CalibrationRecord'],
  'QMS & Documents': ['QmsCertification', 'QmsDocument', 'InterOfficeNote', 'IONItem'],
  'HR & Training': [
    'Employee', 'AttendanceEmployee', 'AttendanceEntry', 'AttendanceMonthSubmission',
    'TrainingPlan', 'TrainingPlanItem', 'TrainingSession', 'TrainingAttendee', 'SkillMatrix',
  ],
  'Users & System': [
    'User', 'Unit', 'Session', 'AuditLog', 'Notification', 'Message',
    'PushSubscription', 'CalendarEvent',
  ],
};

const OTHER_GROUP = 'Other';

// model name → group, and the position it should appear at.
const TABLE_GROUP = {};
const TABLE_ORDER = {};
let _seq = 0;
for (const [group, names] of Object.entries(GROUPS)) {
  for (const n of names) {
    TABLE_GROUP[n] = group;
    TABLE_ORDER[n] = _seq++;
  }
}

// Extra copy for a handful of tables whose purpose isn't obvious from the name.
const TABLE_HINTS = {
  FimTestReport: 'Customer test certificates handed over with the FIM',
  ProductEditHistory: 'Audit trail of Stores edits to product details',
  WorkOrderEditHistory: 'Audit trail of edits to work order scope details',
  PurchaseOrderNumberHistory: 'Record of PO re-numbering',
  PurchaseRequestDateHistory: 'Record of required-by date changes on a PR',
  Session: 'Active login sessions — deleting one logs that device out',
  AuditLog: 'System-wide action log',
};

// "QCInspection" → "QC Inspection", "WorkOrderBgEntry" → "Work Order BG Entry".
// Splits PascalCase while keeping runs of capitals intact, then upper-cases the
// abbreviations the business actually uses.
const ABBREVIATIONS = { Qms: 'QMS', Fim: 'FIM', Bg: 'BG', Pdc: 'PDC', Miv: 'MIV', Po: 'PO', Pr: 'PR', Qc: 'QC' };

// Names the generic splitter can't get right on its own.
const TABLE_LABELS = {
  SupplierReEvaluation: 'Supplier Re-Evaluation',
  InterOfficeNote: 'Inter-Office Note',
  WorkOrderClosureWeeklyFollowup: 'Work Order Closure — Weekly Follow-up',
};

function prettyTableLabel(name) {
  if (TABLE_LABELS[name]) return TABLE_LABELS[name];
  const parts = name.match(/[A-Z]+(?![a-z])|[A-Z][a-z]+|\d+/g) || [name];
  return parts.map((p) => ABBREVIATIONS[p] || p).join(' ');
}

// PascalCase table name → camelCase Prisma model accessor.
const modelKey = (table) => table.charAt(0).toLowerCase() + table.slice(1);

// Resolve any table name the editors accept into the underlying Prisma model
// plus its scope. Returns null for an unknown name so callers 404 on it.
// `realTables` is the DMMF-derived list of genuine model names.
function resolveTable(name, realTables) {
  const v = VIRTUAL_TABLES[name];
  if (v) return { name, model: v.model, key: modelKey(v.model), where: v.where, createDefaults: v.createDefaults, parent: v.parent, virtual: true };
  if (realTables.includes(name)) return { name, model: name, key: modelKey(name), where: undefined, createDefaults: undefined, parent: undefined, virtual: false };
  return null;
}

// Combine the virtual table's scope with a caller-supplied filter (the search
// OR clause). Either side may be undefined.
function scopedWhere(scope, extra) {
  if (scope && extra) return { AND: [scope, extra] };
  return scope || extra;
}

// The table list both editors render: curated views first, then every real
// model in business-area order. `countRows(key, where)` does the counting so
// each route keeps its own error handling.
async function listTables(realTables, countRows) {
  const out = [];
  for (const [name, v] of Object.entries(VIRTUAL_TABLES)) {
    out.push({
      name,
      label: v.label,
      hint: v.hint,
      group: v.group,
      virtual: true,
      model: v.model, // the real table underneath, shown in the editor banner
      rows: await countRows(modelKey(v.model), v.where),
    });
  }

  // Grouped models in catalogue order; anything unlisted lands in "Other" so a
  // newly added model is still editable the moment it exists.
  const ordered = [...realTables].sort((a, b) => {
    const oa = TABLE_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
    const ob = TABLE_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
    return oa - ob || a.localeCompare(b);
  });

  for (const t of ordered) {
    out.push({
      name: t,
      label: prettyTableLabel(t),
      hint: TABLE_HINTS[t],
      group: TABLE_GROUP[t] || OTHER_GROUP,
      virtual: false,
      rows: await countRows(modelKey(t)),
    });
  }
  return out;
}

// Which models the catalogue doesn't file anywhere. Used by the catalogue test
// so a new model shows up as a warning instead of quietly sitting in "Other".
function ungroupedTables(realTables) {
  return realTables.filter((t) => !TABLE_GROUP[t]);
}

module.exports = {
  VIRTUAL_TABLES, GROUPS, TABLE_GROUP, TABLE_HINTS,
  resolveTable, scopedWhere, listTables, modelKey, prettyTableLabel, ungroupedTables,
};
