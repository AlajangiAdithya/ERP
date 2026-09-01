// ──── MATERIAL CATEGORY REGISTER ────
// The company's material-code register: every material type, the block of
// material codes reserved for it, and what belongs in it. Single source of truth
// for every "Material Type" dropdown in the app (PR lines, inward entry, master
// data, product edit) AND for the material code a new material is given — codes
// are counted inside the owning category's block, by the server.
//
// Mirror of MATERIAL_CATEGORIES in server/src/utils/materialCategories.js; keep
// both in sync. The forms fetch /products/material-categories and fall back to
// this list when that call fails, so the fallback has to stay complete.
//
// Codes 801–1000 are deliberately unallocated in the register (a reserved gap),
// so no category claims them.
export const MATERIAL_CATEGORIES = [
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
  // Not in the register — the catch-all, and the only category with no code
  // block: its material codes are typed by hand.
  { label: 'Others',                          from: null, to: null, description: 'Anything that does not belong to a category above. No reserved code block — the material code is entered manually.' },
];

export const MATERIAL_TYPE_OPTIONS = MATERIAL_CATEGORIES.map((c) => c.label);

// Category a new material starts on in the create forms.
export const DEFAULT_MATERIAL_TYPE = 'Raw Material - Fabric / Fiber';

export const categoryFor = (label, categories) =>
  (categories?.length ? categories : MATERIAL_CATEGORIES)
    .find((c) => c.label?.toLowerCase() === String(label || '').trim().toLowerCase()) || null;

// Every code in the register is 4 digits wide ("0001", "0301", "1001", "7000").
export const formatMaterialCode = (n) => String(n).padStart(4, '0');

// "0001–0300" for a category, or '—' when it has no reserved block ('Others',
// or a retired label still sitting on an old product).
export const formatCodeRange = (label, categories) => {
  const cat = categoryFor(label, categories);
  return cat?.from ? `${formatMaterialCode(cat.from)}–${formatMaterialCode(cat.to)}` : '—';
};

// Is this material code inside its category's block? `true` when the category has
// no block (nothing to violate) or the code isn't a plain number — the forms only
// use this to warn, never to block a save.
export const codeMatchesCategory = (code, label, categories) => {
  const cat = categoryFor(label, categories);
  if (!cat?.from) return true;
  const s = String(code ?? '').trim();
  if (!/^\d+$/.test(s)) return true;
  const n = parseInt(s, 10);
  return n >= cat.from && n <= cat.to;
};

// Options to render for a record that already has a category. Retired labels
// ('Raw Material', 'Hand Tools', 'Fasteners', 'Machinery', 'Hand Tools &
// Fastners') still sit on older products, and a <select> whose value isn't in its
// option list silently shows — and then saves — something else. Appending the
// stored value keeps it visible until whoever edits the record deliberately picks
// a current category.
export const withStoredType = (options, current) => {
  const list = options?.length ? options : MATERIAL_TYPE_OPTIONS;
  return current && !list.includes(current) ? [...list, current] : list;
};
