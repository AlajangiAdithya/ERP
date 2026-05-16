// Backfill: extract unique suppliers from Quotation / QuotationItem / PurchaseOrder
// snapshot strings, dedupe by case-insensitive trimmed name, create Supplier rows,
// and link supplierId on every source record. Idempotent — safe to re-run.
//
//   node prisma/backfill-suppliers.js
//
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const normalise = (s) => (s || '').trim();
const key = (s) => normalise(s).toLowerCase();

async function withRetry(fn, label, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`[retry ${i + 1}/${retries}] ${label}: ${e.code || e.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function main() {
  console.log('Reading existing supplier snapshots...');

  const quotations = await withRetry(() => prisma.quotation.findMany({
    where: { supplierId: null },
    select: { id: true, supplierName: true, supplierContact: true, supplierAddress: true, createdAt: true },
  }), 'fetch quotations');

  const quotationItems = await withRetry(() => prisma.quotationItem.findMany({
    where: { supplierId: null },
    select: { id: true, supplierName: true, supplierContact: true, supplierAddress: true, quotation: { select: { createdAt: true } } },
  }), 'fetch quotation items');

  const purchaseOrders = await withRetry(() => prisma.purchaseOrder.findMany({
    where: { supplierId: null },
    select: { id: true, supplierName: true, createdAt: true },
  }), 'fetch purchase orders');

  const purchaseOrderItems = await withRetry(() => prisma.purchaseOrderItem.findMany({
    where: { supplierId: null },
    select: { id: true, purchaseOrder: { select: { supplierName: true, createdAt: true } } },
  }), 'fetch purchase order items');

  console.log(`Snapshots: ${quotations.length} Q, ${quotationItems.length} QI, ${purchaseOrders.length} PO, ${purchaseOrderItems.length} POI`);

  const acc = new Map();
  const remember = (rawName, contact, address, at) => {
    const k = key(rawName);
    if (!k) return;
    const existing = acc.get(k) || { displayName: normalise(rawName), contact: null, address: null, latestAt: new Date(0) };
    const t = at ? new Date(at) : new Date(0);
    if (t > existing.latestAt) {
      existing.latestAt = t;
      existing.displayName = normalise(rawName);
      if (contact) existing.contact = normalise(contact);
      if (address) existing.address = normalise(address);
    } else {
      if (!existing.contact && contact) existing.contact = normalise(contact);
      if (!existing.address && address) existing.address = normalise(address);
    }
    acc.set(k, existing);
  };

  for (const q of quotations) remember(q.supplierName, q.supplierContact, q.supplierAddress, q.createdAt);
  for (const qi of quotationItems) remember(qi.supplierName, qi.supplierContact, qi.supplierAddress, qi.quotation?.createdAt);
  for (const po of purchaseOrders) remember(po.supplierName, null, null, po.createdAt);
  for (const poi of purchaseOrderItems) remember(poi.purchaseOrder?.supplierName, null, null, poi.purchaseOrder?.createdAt);

  console.log(`Found ${acc.size} unique supplier(s).`);

  // Read existing suppliers up front; do all name-matching in memory to minimise roundtrips.
  const existing = await withRetry(() => prisma.supplier.findMany({ select: { id: true, name: true } }), 'fetch suppliers');
  const existingByKey = new Map(existing.map(s => [s.name.toLowerCase().trim(), s.id]));

  const idByKey = new Map();
  let createdCount = 0;
  let i = 0;
  for (const [k, info] of acc.entries()) {
    i++;
    const sid = existingByKey.get(k);
    if (sid) {
      idByKey.set(k, sid);
      continue;
    }
    try {
      const s = await withRetry(() => prisma.supplier.create({
        data: { name: info.displayName, contact: info.contact || null, address: info.address || null },
      }), `create supplier ${info.displayName}`);
      idByKey.set(k, s.id);
      createdCount++;
      if (i % 25 === 0) console.log(`  ...processed ${i}/${acc.size}`);
    } catch (e) {
      // Unique violation (rare race) — re-fetch
      const found = await withRetry(() => prisma.supplier.findFirst({ where: { name: { equals: info.displayName, mode: 'insensitive' } } }), 'refetch supplier');
      if (found) idByKey.set(k, found.id);
      else throw e;
    }
  }
  console.log(`Created ${createdCount} new Supplier rows. Total mapped: ${idByKey.size}`);

  // Build groups: supplierId -> list of source ids per table, so we can use updateMany
  const groupIds = (rows, getName) => {
    const m = new Map(); // sid -> [ids]
    for (const r of rows) {
      const sid = idByKey.get(key(getName(r)));
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, []);
      m.get(sid).push(r.id);
    }
    return m;
  };

  const qGroups = groupIds(quotations, r => r.supplierName);
  const qiGroups = groupIds(quotationItems, r => r.supplierName);
  const poGroups = groupIds(purchaseOrders, r => r.supplierName);
  const poiGroups = groupIds(purchaseOrderItems, r => r.purchaseOrder?.supplierName);

  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

  const bulkLink = async (model, groups, label) => {
    let count = 0;
    for (const [sid, ids] of groups.entries()) {
      for (const c of chunk(ids, 200)) {
        await withRetry(() => prisma[model].updateMany({ where: { id: { in: c } }, data: { supplierId: sid } }), `link ${label}`);
        count += c.length;
      }
    }
    console.log(`Linked ${count} ${label} rows.`);
  };

  await bulkLink('quotation', qGroups, 'Quotation');
  await bulkLink('quotationItem', qiGroups, 'QuotationItem');
  await bulkLink('purchaseOrder', poGroups, 'PurchaseOrder');
  await bulkLink('purchaseOrderItem', poiGroups, 'PurchaseOrderItem');

  // ── productId backfill (best-effort exact name match) ──
  console.log('Backfilling productId on items by exact name match...');
  const allProducts = await withRetry(() => prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true } }), 'fetch products');
  const productByName = new Map(allProducts.map(p => [p.name.toLowerCase().trim(), p.id]));

  const linkProductIds = async (model, label) => {
    const rows = await withRetry(() => prisma[model].findMany({ where: { productId: null }, select: { id: true, productName: true } }), `fetch ${label}`);
    const groups = new Map(); // pid -> [ids]
    for (const r of rows) {
      const pid = productByName.get((r.productName || '').toLowerCase().trim());
      if (!pid) continue;
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid).push(r.id);
    }
    let count = 0;
    for (const [pid, ids] of groups.entries()) {
      for (const c of chunk(ids, 200)) {
        await withRetry(() => prisma[model].updateMany({ where: { id: { in: c } }, data: { productId: pid } }), `link product ${label}`);
        count += c.length;
      }
    }
    console.log(`  ${label}: linked ${count}/${rows.length}`);
  };

  await linkProductIds('quotationItem', 'QuotationItem');
  await linkProductIds('purchaseOrderItem', 'PurchaseOrderItem');

  console.log('\n✓ Backfill complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
