// Categorize all products by name pattern + set min stock levels per category.
// Categories (priority order — first match wins):
//   Tooling, Equipment, Fabric, Chemical, Raw Material, Hardware, PPE / Safety, Office, Others

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Category rules: [name, regex, minFloor, minPctOfStock, minCap]
const RULES = [
  ['Tooling',       /\b(mandrel|fixture|mould|mold(?!ing\s+powder)|jig|tool\s*assy|tool\s*assembly|moulding\s+tool|machining|extraction|punch|die\b|sleeve|liner|bracket|support\s+ring|insert|sub\s+assy|stiffener|cavity)\b/i, 0, 0, 0],
  ['Equipment',     /\b(compressor|lathe|hoist|blower|motor(?!\s+casing)|pump|machine|stirrer|hydra(u|n)lic|generator|press\b|grinder|drill\s+machine|crane|chiller|controller|ssr|pid|printer|computer|exhaust\s+fan|x[-\s]?ray|panel\s+board|micrometer|caliper|gauge|balance|oven|furnace|autoclave|reactor|spectrometer|microscope)\b/i, 0, 0, 0],
  ['PPE / Safety',  /\b(glove|mask|head\s*cap|uniform|helmet|goggle|safety\s+shoe|apron|boot\b|earplug|coverall|respirator)\b/i, 50, 0.10, 1000],
  ['Fabric',        /\b(fabric|carbon|silica|s[-\s]?glass|s2\s*glass|e\s*glass|breather|peel\s*ply|cora|nylon\s+tape|cloth|vacuum\s+film|polythene\s+film|vacrilm|floremat|porous|rayon)\b/i, 20, 0.15, 500],
  ['Chemical',      /\b(acetone|tce|trichloro|ethanol|ipa\b|alcohol|hardener|solvent|cleaner|paint|adhesive|glue|fevicol|fevical|epoxy|primer|silane|si69|catalyst|accelerator|reducer|thinner|degreaser|lubricant|grease)\b/i, 5, 0.15, 200],
  ['Raw Material',  /\b(resin|rubber|perbunan|polymer|powder|granul|silicone|polyurethane|epdm|nbr|hydroxyl|isro|narez|ivp|amitee|amity|lapox|ultrasil|ultrasin|drt\b|ivarez|araldite|aradur|hytite|rhenogram|formaldehyde|melamine|hexamine|filler|pigment|hytite|fineset|carbon\s+fiber|fiber\s+glass|hardner)\b/i, 10, 0.15, 500],
  ['Hardware',      /\b(bolt|nut\b|screw|washer|allen\s*key|hex\s+nut|pipe|rod\b|strip|wire|cable|fastener|stud|hose|valve|fitting|coupling|elbow|flange|clamp|spring|bearing|chain|sprocket|pulley|belt|gasket|o[-\s]ring|seal\b)\b/i, 20, 0.15, 200],
  ['Office',        /\b(file\s|paper|stationery|pen\b|register|sheet|folder|envelope|stapler|punch\s+machine|notebook|tape\s+dispens)\b/i, 2, 0.10, 50],
];

const FALLBACK = ['Others', null, 2, 0.05, 20];

function categorize(name) {
  for (const [cat, rx, floor, pct, cap] of RULES) {
    if (rx.test(name)) return { category: cat, floor, pct, cap };
  }
  const [cat, , floor, pct, cap] = FALLBACK;
  return { category: cat, floor, pct, cap };
}

function calcMin(currentStock, floor, pct, cap) {
  if (cap === 0) return 0; // Tooling / Equipment
  if (currentStock <= 0) return 0;
  const proportional = currentStock * pct;
  const m = Math.max(floor, proportional);
  const clamped = Math.min(cap, m);
  return Math.round(clamped * 100) / 100; // round to 2 decimals
}

async function main() {
  console.log('=== Categorize Products ===');
  const products = await prisma.product.findMany({
    select: { id: true, name: true, currentStock: true, category: true, minStockLevel: true },
  });
  console.log(`Loaded ${products.length} products`);

  const counts = {};
  let updated = 0;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const { category, floor, pct, cap } = categorize(p.name);
    const minLevel = calcMin(p.currentStock, floor, pct, cap);
    counts[category] = (counts[category] || 0) + 1;
    if (p.category !== category || p.minStockLevel !== minLevel) {
      await prisma.product.update({
        where: { id: p.id },
        data: { category, minStockLevel: minLevel },
      });
      updated++;
    }
    if ((i + 1) % 200 === 0) console.log(`  ...${i+1}/${products.length} processed`);
  }

  console.log('\n=== Category distribution ===');
  Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([c,n]) => console.log(`  ${c.padEnd(15)} ${n}`));
  console.log(`\nUpdated ${updated} products.`);
}

main()
  .catch((e) => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
