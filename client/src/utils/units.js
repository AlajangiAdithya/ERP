// Canonical UOM (unit of measure) options — the single source of truth for
// every material UOM dropdown in the app (PR, inward, cash, FIM, gate pass,
// quotation, products, …). Keep this list in sync everywhere instead of
// hardcoding per-form lists. "Nos." = a count of individual numbers/pieces.
// "days" covers time-billed lines (equipment hire, manpower, service contracts)
// where the quantity is a duration rather than a physical count.
export const UOM_OPTIONS = [
  'Nos.', 'pcs', 'kg', 'litre', 'meter', 'Sq. mtr', 'ton', 'box', 'drum', 'bag', 'roll', 'set', 'days',
];
