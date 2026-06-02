// Import the client's Approved Supplier List (Excel) into the Supplier table.
// Idempotent — re-runs upsert by name (Supplier.name is @unique). Vendor IDs
// are minted via the same RAPS/SUP/<NNNN> sequence used by supplier.routes.js,
// so newly created rows continue the existing counter.
//
// Source file is hard-coded to the user's Downloads path.
//
//   node prisma/import-approved-suppliers.js
//
// PDFs (vendor evaluation / supplier assessment) are NOT imported here —
// the user will upload them later via the UI.
//
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Repo-relative path so it works the same on the laptop and on EC2.
const SRC = path.join(__dirname, 'seed-data', 'Approved supplier list.xlsx');

// Sheets to import. Each sheet contains its own block of supplier rows; the
// "Raw material" sheet has 4 header rows before the data starts, "Consumbles"
// starts immediately. The third sheet "Raw" is a duplicate subset of
// "Raw material" with extra performance-review columns and is intentionally
// skipped — those re-evaluation rows live in SupplierReEvaluation, not here.
const SHEETS = [
  { name: 'Raw material', skipRows: 4, materialType: 'MATERIAL' },
  { name: 'Consumbles',   skipRows: 0, materialType: 'MATERIAL' },
];

const norm = (v) => (v == null ? null : String(v).replace(/\r\n/g, '\n').replace(/\s+\n/g, '\n').trim() || null);

// Excel stores dates as serial numbers (days since 1899-12-30). Convert to JS Date.
function excelSerialToDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

function normalizeApprovalStatus(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('appo') || s.startsWith('appr')) return 'APPROVED';   // "Approved" / "Apporved" typo
  if (s.startsWith('cond')) return 'CONDITIONAL';
  if (s.startsWith('rej'))  return 'REJECTED';
  if (s.startsWith('term')) return 'TERMINATED';
  return null;
}

// Col 3 in the sheet packs contact person + phone together in many formats:
//   "M sreenivasulu Ph:9490701582"
//   "Mittal chudasama  "
//   "9940145022"  (raw number)
// Split into { contactPerson, contactPhone } best-effort.
function splitContact(raw) {
  if (raw == null) return { contactPerson: null, contactPhone: null };
  const s = String(raw).trim();
  if (!s) return { contactPerson: null, contactPhone: null };
  // Pure digits → phone only.
  if (/^[\d\s+\-()]+$/.test(s)) {
    const digits = s.replace(/\D/g, '');
    return { contactPerson: null, contactPhone: digits || null };
  }
  // "Name Ph:9999999999" / "Name Mob:9999" / "Name 9999999999"
  const m = s.match(/^(.*?)(?:\s*(?:ph|mob|mobile|phone|cell)\s*[:.-]?\s*|\s+)(\+?[\d\s\-()]{7,})\s*$/i);
  if (m) {
    const person = norm(m[1]);
    const phone = m[2].replace(/\D/g, '');
    return { contactPerson: person, contactPhone: phone || null };
  }
  return { contactPerson: norm(s), contactPhone: null };
}

async function nextVendorId() {
  const rows = await prisma.supplier.findMany({
    where: { vendorIdNo: { startsWith: 'RAPS/SUP/' } },
    select: { vendorIdNo: true },
  });
  let max = 0;
  for (const { vendorIdNo } of rows) {
    if (!vendorIdNo) continue;
    const n = parseInt(vendorIdNo.slice('RAPS/SUP/'.length), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

async function main() {
  console.log(`Reading ${SRC} ...`);
  const wb = XLSX.readFile(SRC);

  // Collect parsed records keyed by lower-cased name (dedupe across sheets).
  const records = new Map();
  for (const sheet of SHEETS) {
    const ws = wb.Sheets[sheet.name];
    if (!ws) { console.warn(`  ! Sheet "${sheet.name}" not found, skipping.`); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    let kept = 0;
    for (let i = sheet.skipRows; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const [excelId, name, address, contactRaw, scope, _mt, statusRaw, dateRaw, control, remarks] = r;
      // Need a numeric ID column and a non-empty name to count as a data row.
      if (typeof excelId !== 'number' && !(typeof excelId === 'string' && /^\d+$/.test(excelId.trim()))) continue;
      const nm = norm(name);
      if (!nm) continue;
      const { contactPerson, contactPhone } = splitContact(contactRaw);
      const key = nm.toLowerCase();
      if (records.has(key)) continue; // first occurrence wins
      records.set(key, {
        name: nm,
        address: norm(address),
        contactPerson,
        contactPhone,
        contact: norm(contactRaw), // legacy single-line
        scopeOfSupply: norm(scope),
        materialType: sheet.materialType,
        approvalStatus: normalizeApprovalStatus(statusRaw),
        approvalDate: excelSerialToDate(dateRaw),
        typeAndExtentOfControl: norm(control),
        remarks: norm(remarks),
      });
      kept++;
    }
    console.log(`  • ${sheet.name}: parsed ${kept} supplier rows`);
  }
  console.log(`Total unique suppliers parsed: ${records.size}`);

  // Pre-fetch existing suppliers by lower-cased name for fast skip detection.
  const existing = await prisma.supplier.findMany({ select: { id: true, name: true, vendorIdNo: true } });
  const existingByName = new Map(existing.map(s => [s.name.toLowerCase(), s]));

  let created = 0, updated = 0, vendorIdSeq = await nextVendorId();
  for (const [key, rec] of records.entries()) {
    const found = existingByName.get(key);
    try {
      if (found) {
        // Update only fields that are currently null on the existing row;
        // never overwrite curated data the user may have edited.
        const fill = {};
        const need = await prisma.supplier.findUnique({ where: { id: found.id } });
        if (!need.address && rec.address) fill.address = rec.address;
        if (!need.contactPerson && rec.contactPerson) fill.contactPerson = rec.contactPerson;
        if (!need.contactPhone && rec.contactPhone) fill.contactPhone = rec.contactPhone;
        if (!need.contact && rec.contact) fill.contact = rec.contact;
        if (!need.scopeOfSupply && rec.scopeOfSupply) fill.scopeOfSupply = rec.scopeOfSupply;
        if (!need.materialType && rec.materialType) fill.materialType = rec.materialType;
        if (!need.approvalStatus && rec.approvalStatus) fill.approvalStatus = rec.approvalStatus;
        if (!need.approvalDate && rec.approvalDate) fill.approvalDate = rec.approvalDate;
        if (!need.typeAndExtentOfControl && rec.typeAndExtentOfControl) fill.typeAndExtentOfControl = rec.typeAndExtentOfControl;
        if (!need.remarks && rec.remarks) fill.remarks = rec.remarks;
        if (!need.vendorIdNo) { vendorIdSeq++; fill.vendorIdNo = `RAPS/SUP/${String(vendorIdSeq).padStart(4, '0')}`; }
        if (Object.keys(fill).length > 0) {
          await prisma.supplier.update({ where: { id: found.id }, data: fill });
          updated++;
        }
      } else {
        vendorIdSeq++;
        const vendorIdNo = `RAPS/SUP/${String(vendorIdSeq).padStart(4, '0')}`;
        await prisma.supplier.create({ data: { ...rec, vendorIdNo } });
        created++;
      }
    } catch (e) {
      console.error(`  ! ${rec.name}: ${e.code || ''} ${e.message}`);
    }
  }

  console.log(`\n✓ Done. Created: ${created}, Updated (filled blanks): ${updated}, Skipped (already complete): ${records.size - created - updated}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
