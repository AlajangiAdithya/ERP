// ──── MATERIAL CATEGORY REGISTER ────
// The company's material-code register: every material type, the block of
// material codes reserved for it, and what belongs in it. This is the single
// source of truth for the "Material Type" dropdown everywhere (master data,
// purchase requisition lines, inward entry) AND for the material code a new
// material is given — codes are counted inside the owning category's block.
//
// Mirror of MATERIAL_CATEGORIES in client/src/utils/materialTypes.js — keep both
// in sync. The client falls back to its copy when /products/material-categories
// can't be reached, so the two lists must stay identical.
//
// Codes 801–1000 are deliberately unallocated in the register (a reserved gap),
// so no category claims them.
const MATERIAL_CATEGORIES = [
  { label: 'Plant & Machinery',               from: 1,    to: 300,  description: 'Machines, ovens, compressors, stabilizers, major electrical panels, etc.' },
  { label: 'Lands & Buildings',               from: 301,  to: 500,  description: 'Land, factory buildings, sheds, infrastructure, etc.' },
  { label: 'IT Office & Equipment',           from: 501,  to: 800,  description: 'Computers, printers, servers, UPS, office equipment, etc.' },
  // The register labels all five of these simply "Raw material" but gives each
  // its own code block. They are separate categories here so a new material's
  // code can be counted in the right block — the label keeps the family prefix.
  { label: 'Raw Material - Fabric / Fiber',   from: 1001, to: 1500, description: 'Any fabric / fiber' },
  { label: 'Raw Material - Resins',           from: 1501, to: 2000, description: 'Any type of resins' },
  { label: 'Raw Material - Rubber',           from: 2001, to: 2500, description: 'Any type of rubber materials' },
  { label: 'Raw Material - Chemlok / DDR',    from: 2501, to: 2600, description: 'Any Chemlok / DDR items' },
  { label: 'Raw Material - Grease / Loctite', from: 2601, to: 2700, description: 'Any grease item / Loctite (integration)' },
  { label: 'Raw Material - Metallics',        from: 2701, to: 3000, description: 'Metallics items, etc.' },
  { label: 'Consumable',                      from: 3001, to: 3300, description: 'Abrasives, solvents, release agents, gloves, tapes, cleaning materials, etc.' },
  { label: 'Brought Items',                   from: 3301, to: 3500, description: 'Fasteners, lugs, inserts, connectors, standard components, etc.' },
  { label: 'Measuring & Test Equipment',      from: 3501, to: 4000, description: 'Vernier, micrometer, pressure gauges, weighing scales, UT equipment, etc.' },
  { label: 'Stationery',                      from: 4001, to: 4500, description: 'Paper, labels, barcode ribbons, cartridges, etc.' },
  { label: 'Tools & Fixtures',                from: 4501, to: 5500, description: 'Mandrels, winding fixtures, jigs, gauges, moulds, etc.' },
  { label: 'Packaging Materials',             from: 5501, to: 6000, description: 'Boxes, foam, bubble wrap, VCI, bags, tapes, etc.' },
  { label: 'Maintenance Spares',              from: 6001, to: 6300, description: 'Replacement parts, bearings, belts, electrical spares, pneumatic parts, etc.' },
  { label: 'Electrical Items',                from: 6301, to: 6800, description: 'MCB, MCCB, RCCB, contactors, relays, switches, cables, terminals, SMPS, transformers, etc.' },
  { label: 'Safety / PPE Items',              from: 6801, to: 7000, description: 'Safety shoes, safety helmets, safety goggles, gloves, ear plugs / ear muffs, respirators / masks, safety harness, reflective jackets, other PPE' },
  // Not in the register — the catch-all normalizeMaterialType() falls back to,
  // and the only category with no code block: its codes are typed by hand.
  { label: 'Others',                          from: null, to: null, description: 'Anything that does not belong to a category above. No reserved code block — the material code is entered manually.' },
];

const MATERIAL_TYPES = MATERIAL_CATEGORIES.map((c) => c.label);

// Category a new material starts on in the create forms.
const DEFAULT_MATERIAL_TYPE = 'Raw Material - Fabric / Fiber';

const categoryFor = (label) =>
  MATERIAL_CATEGORIES.find((c) => c.label.toLowerCase() === String(label || '').trim().toLowerCase()) || null;

// The code block reserved for a category, or null for 'Others' / an unknown
// (legacy) label — those have no block and are numbered by hand.
const codeRangeFor = (label) => {
  const cat = categoryFor(label);
  return cat && cat.from ? { from: cat.from, to: cat.to } : null;
};

// ──── MATERIAL CODES ────
// Every code in the register is 4 digits wide ("0001", "0301", "1001", "7000"),
// so codes sort the same as text and as numbers.
const MATERIAL_CODE_WIDTH = 4;
const formatMaterialCode = (n) => String(n).padStart(MATERIAL_CODE_WIDTH, '0');

// The number a stored code represents. Handles both the padded form and the
// unpadded legacy codes ("301", "1001"). Returns null for anything non-numeric
// (the old CONS-/RAW- prefixed skus).
const materialCodeToNumber = (value) => {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

// Next free material code for a category, given every code already in use.
// Counts inside the category's own block: max used in the block + 1, and when
// that runs past the end of the block, the lowest still-free slot in it. Returns
// { code, from, to, used, capacity, full }. `code` is null when the category has
// no block ('Others' / a legacy label) or the block is full.
const nextMaterialCode = (label, usedNumbers) => {
  const range = codeRangeFor(label);
  if (!range) return { code: null, from: null, to: null, used: 0, capacity: 0, full: false };
  const { from, to } = range;
  const inBlock = new Set();
  for (const value of usedNumbers) {
    const n = materialCodeToNumber(value);
    if (n !== null && n >= from && n <= to) inBlock.add(n);
  }
  const capacity = to - from + 1;
  let next = null;
  // Normal case: carry on from the highest code issued in this block.
  let max = from - 1;
  for (const n of inBlock) if (n > max) max = n;
  if (max + 1 <= to) {
    next = max + 1;
  } else {
    // The block's tail is taken — fall back to the lowest gap inside it, so a
    // stray high code doesn't declare a mostly-empty block full.
    for (let n = from; n <= to; n++) {
      if (!inBlock.has(n)) { next = n; break; }
    }
  }
  return {
    code: next === null ? null : formatMaterialCode(next),
    from, to,
    used: inBlock.size,
    capacity,
    full: next === null,
  };
};

// Where codes for a category with NO reserved block start. The register runs out
// at 7000, so 'Others' (and any retired label) is numbered from 7001 up — clear
// of every block, and clear of the historic 001, 002… serials that products
// created before the register still carry.
const UNALLOCATED_CODE_START = 7001;

const nextUnallocatedCode = (usedNumbers) => {
  let max = UNALLOCATED_CODE_START - 1;
  for (const value of usedNumbers) {
    const n = materialCodeToNumber(value);
    if (n !== null && n >= UNALLOCATED_CODE_START && n > max) max = n;
  }
  return formatMaterialCode(max + 1);
};

// Is `code` inside the block reserved for `label`? `true` when the category has
// no block (nothing to violate) or the code isn't a plain number.
const codeMatchesCategory = (code, label) => {
  const range = codeRangeFor(label);
  if (!range) return true;
  const n = materialCodeToNumber(code);
  if (n === null) return true;
  return n >= range.from && n <= range.to;
};

// "0001–0300" — how a block is shown next to its category.
const formatCodeRange = (label) => {
  const range = codeRangeFor(label);
  return range ? `${formatMaterialCode(range.from)}–${formatMaterialCode(range.to)}` : '—';
};

// ──── LEGACY LABELS ────
// Categories that were retired when the register above replaced the old ad-hoc
// list. Products still carrying one keep it — normalizeMaterialType() returns
// these unchanged rather than guessing a new block for them, and the forms append
// the stored label to the dropdown so it stays visible until someone re-picks.
// A label here must NOT be one that was merely renamed (see the aliases in
// normalizeMaterialType — 'Machinery' → 'Plant & Machinery' and friends): those
// mean the same thing and are safe to move.
const LEGACY_MATERIAL_TYPES = [
  'Raw Material',
  'Raw Materials - Composites',
  'Hand Tools',
  'Hand Tools & Fastners',
];

// Map anything a user, import sheet or older record can carry onto a current
// category label. Renames are followed; genuinely retired labels are preserved;
// everything else lands on 'Others'.
const normalizeMaterialType = (value) => {
  if (!value) return 'Others';
  const raw = String(value).trim();
  const t = raw.toLowerCase();

  // Already a current label (any casing / spacing).
  const exact = categoryFor(raw);
  if (exact) return exact.label;

  // Raw materials — one block per kind, so match on the kind named. 'composites'
  // is deliberately absent: the retired 'Raw Materials - Composites' label spans
  // several of these blocks, so it is preserved rather than guessed at.
  if (/\braw\b|resin|rubber|chemlok|loctite|metallic|metalic|fabric|fibre|fiber/.test(t)) {
    if (/fabric|fiber|fibre|cloth/.test(t))        return 'Raw Material - Fabric / Fiber';
    if (/resin/.test(t))                           return 'Raw Material - Resins';
    if (/rubber|elastomer/.test(t))                return 'Raw Material - Rubber';
    if (/chemlok|chemlock|ddr/.test(t))            return 'Raw Material - Chemlok / DDR';
    if (/grease|loctite/.test(t))                  return 'Raw Material - Grease / Loctite';
    if (/metallic|metalic|\bmetal\b/.test(t))      return 'Raw Material - Metallics';
  }

  // Renames — same meaning, new label.
  if (/^(machinery|machineries|machine|plant (&|and) machinery|plant machinery)$/.test(t)) return 'Plant & Machinery';
  if (/^(land|lands|building|buildings|lands? (&|and) buildings?)$/.test(t)) return 'Lands & Buildings';
  if (/^(it|it office|it equipment|it office (&|and) equipment|office equipment)$/.test(t)) return 'IT Office & Equipment';
  if (/^(fasteners|fastners|fastener|fastner|brought item|brought items|bought items|bought item)$/.test(t)) return 'Brought Items';
  if (/^(consumable|consumables)$/.test(t)) return 'Consumable';
  if (/^(measuring (&|and) test equipment|measuring equipment|test equipment|measuring instruments)$/.test(t)) return 'Measuring & Test Equipment';
  if (/^(stationery|stationary)$/.test(t)) return 'Stationery';
  if (/^(tools (&|and) fixtures|tooling (&|and) fixtures|fixtures|fixture)$/.test(t)) return 'Tools & Fixtures';
  if (/^(packaging|packing|packaging material|packaging materials|packing materials)$/.test(t)) return 'Packaging Materials';
  if (/^(maintenance spare|maintenance spares|spares)$/.test(t)) return 'Maintenance Spares';
  if (/^(electrical items?|electrical|electricals|electric items|electrical goods)$/.test(t)) return 'Electrical Items';
  if (/^(safety|ppe|safety items|ppe items|safety ?\/? ?ppe items?|safety (&|and) ppe items?)$/.test(t)) return 'Safety / PPE Items';

  // Retired labels stay put — see LEGACY_MATERIAL_TYPES above.
  const legacy = LEGACY_MATERIAL_TYPES.find((l) => l.toLowerCase() === t);
  if (legacy) return legacy;
  if (/^(raw|raw_material|raw material|raw materials)$/.test(t)) return 'Raw Material';

  return 'Others';
};

module.exports = {
  MATERIAL_CATEGORIES,
  MATERIAL_TYPES,
  DEFAULT_MATERIAL_TYPE,
  LEGACY_MATERIAL_TYPES,
  MATERIAL_CODE_WIDTH,
  UNALLOCATED_CODE_START,
  nextUnallocatedCode,
  categoryFor,
  codeRangeFor,
  codeMatchesCategory,
  formatMaterialCode,
  formatCodeRange,
  materialCodeToNumber,
  nextMaterialCode,
  normalizeMaterialType,
};
