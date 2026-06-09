// Seed the Machinery + Fire Extinguisher registers from RAMS/MMR/03 master list
// and RAMS/OH&S/LOFE. Idempotent: skips rows whose rapsId already exists.
//
// Run with: `node prisma/seedMachinery.js`
const prisma = require('../src/config/db');

// Parse "DD/MM/YY" from the fire-extinguisher source list into a JS Date.
const ddmmyy = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const [, dd, mm, yy] = m;
  // 2-digit years on these documents are 21st century.
  return new Date(`20${yy}-${mm}-${dd}T00:00:00Z`);
};

const MACHINERY = [
  { sn: 1,  name: 'Hydraulic Press',                    capacity: 'Platen size: 1M x 1.2M\nDaylight Gap: 700mm\nMax load: 200 Ton',       makeModel: 'Sri Lakshmi Durga Engg Works', serial: 'NA',         rapsId: 'RAMS/HP-01/LM/01',   place: 'Unit-1' },
  { sn: 2,  name: 'Hydraulic Press',                    capacity: 'Platen Size: 520x520mm\nDaylight gap: 1000mm\nMax Load: 50 Tons',     makeModel: 'Sri Lakshmi Durga Engg Works', serial: 'NA',         rapsId: 'RAMS/HP-02/LM/02',   place: 'Unit-1' },
  { sn: 3,  name: 'Hydraulic Press',                    capacity: 'Platen Size: 460x460mm\nDaylight Gap: 160mm\nMax load: 100 Tons',     makeModel: 'Hallmark Engineers',           serial: 'NA',         rapsId: 'RAMS/HP-07/LM/50',   place: 'Unit-1' },
  { sn: 4,  name: 'Hot Air Circulating Oven',           capacity: 'L1200 x W1200 x H1200mm',                                              makeModel: 'INFRA DIGI IR801B',            serial: '36659',      rapsId: 'RAMS/OVEN-01/LM/03', place: 'Unit-1' },
  { sn: 5,  name: 'Hot Air Circulating Oven',           capacity: 'H x L x W — 24" x 24" x 24"',                                          makeModel: 'INFRA DIGI IR801A',            serial: '39647',      rapsId: 'RAMS/OVEN-02/LM/04', place: 'Unit-1' },
  { sn: 6,  name: 'Vacuum Pump',                        capacity: '2000 Ltr / Min',                                                       makeModel: 'PRABIVAC',                     serial: '4297',       rapsId: 'RAMS/VP-01/LM/05',   place: 'Unit-1' },
  { sn: 7,  name: 'Vacuum Pump',                        capacity: '600 Ltr / Min',                                                        makeModel: 'PRABIVAC',                     serial: '3962',       rapsId: 'RAMS/VP-02/LM/06',   place: 'Unit-1' },
  { sn: 8,  name: 'Rubber Mixing Mill',                 capacity: '14 Dia x 36"',                                                         makeModel: 'INDIA',                        serial: 'NA',         rapsId: 'RAMS/MILL-01/LM/07', place: 'Unit-1' },
  { sn: 9,  name: 'Cold Room',                          capacity: "L6' x H8'\nTemp 40 to 80°C",                                           makeModel: 'RINAC',                        serial: 'C21867',     rapsId: 'RAMS/CR-01/LM/08',   place: 'Unit-1' },
  { sn: 10, name: 'Extruder',                           capacity: 'Rubber Sheet\nWidth-1000mm',                                           makeModel: 'Sri Lakshmi Durga Engineering Works', serial: 'NA',  rapsId: 'RAMS/EXT-02/LM/35',  place: 'Unit-1' },
  { sn: 11, name: 'Ultra Sonic Flaw Detector',          capacity: '',                                                                     makeModel: 'Sonatest UK Masterscan-700M',  serial: '1019853',    rapsId: 'RAMS/UFD-01/LM/33',  place: 'Unit-1 (NDT)' },
  { sn: 12, name: 'Ultra Sonic Flaw Detector',          capacity: '',                                                                     makeModel: 'EECI ADVANSCAN AS-414',        serial: 'S401JTA',    rapsId: 'RAMS/UFD-02/LM/34',  place: 'Unit-1 (NDT)' },
  { sn: 13, name: 'Hot Air Circulation Oven',           capacity: 'L-610mm, W-610mm, H-610mm',                                            makeModel: 'SISCO',                        serial: '120323178',  rapsId: 'RAMS/OVEN-05/LM/29', place: 'Unit-1A' },
  { sn: 14, name: 'Hot Air Circulating Oven',           capacity: 'L-2200mm, W-1700mm, H-2200mm',                                         makeModel: 'Infra Instruments Pvt Ltd',    serial: 'Ser No 50088', rapsId: 'RAMS/OVEN-06/45',  place: 'Unit-1A' },
  { sn: 15, name: 'Radiography Equipment',              capacity: '300 KV / 5MA',                                                         makeModel: 'BALTO SPOT',                   serial: '2220345/3',  rapsId: 'RAMS/RT-01/LM/30',   place: 'Unit-1A' },
  { sn: 16, name: 'Conventional Lathe Machine',         capacity: 'Dia-350mm\nLength-2000mm',                                             makeModel: 'NA',                           serial: 'NA',         rapsId: 'RAMS/CL-03/LM/36',   place: 'Unit-1A' },
  { sn: 17, name: 'Hydraulic Press',                    capacity: 'Platen Size: 2000 x 2000mm\nDaylight Gap: 1100mm\nMax Temp: 200°C\nMax Load: 600 Ton', makeModel: 'Hallmark Engineers', serial: 'NA', rapsId: 'RAMS/HP-03/LM/10', place: 'Unit-2' },
  { sn: 18, name: 'Hydraulic Press',                    capacity: 'Platen Size: 1200 x 1000mm\nDaylight Gap: 1000mm\nMax Temp: 200°C\nMax Load: 350 Ton', makeModel: 'Hallmark Engineers', serial: 'NA', rapsId: 'RAMS/HP-06/LM/49', place: 'Unit-2' },
  { sn: 19, name: 'Prepreg Plant',                      capacity: 'Temp Range: 70 to 100°C',                                              makeModel: 'Bhartia',                      serial: 'NA',         rapsId: 'RAMS/PPG-01/LM/11',  place: 'Unit-2' },
  { sn: 20, name: 'Prepreg Slitting Machine',           capacity: 'NA',                                                                   makeModel: 'VK Engineers',                 serial: 'NA',         rapsId: 'RAMS/PPSM-01/LM/12', place: 'Unit-2' },
  { sn: 21, name: 'Mechanical Hoist with Chain Block Pulley', capacity: '5 Ton',                                                          makeModel: 'INDEF-P Hercules',             serial: 'K2021003067',rapsId: 'RAMS/CBP-02/LM/14',  place: 'Unit-2' },
  { sn: 22, name: 'Hydraulic Press',                    capacity: 'Platen Size: 600 x 600mm\nDaylight Gap: 500mm\nMax Temp: 200°C\nMax Load: 170 Ton', makeModel: 'Sri Lakshmi Durga Engineering Works', serial: 'NA', rapsId: 'RAMS/HP-04/LM/37', place: 'Unit-2' },
  { sn: 23, name: 'Hydraulic Press',                    capacity: 'Platen Size: 450 x 450mm\nDaylight Gap: 500mm\nMax Temp: 200°C\nMax Load: 60 Ton',  makeModel: 'Sri Lakshmi Durga Engineering Works', serial: 'NA', rapsId: 'RAMS/HP-05/LM/38', place: 'Unit-2' },
  { sn: 24, name: 'Universal Testing Machine',          capacity: '2 Ton',                                                                makeModel: 'TEC-SOL INDIA UTM-20/3K',      serial: '210721',     rapsId: 'RAMS/UTM-01/LM/22',  place: 'Unit-2 QC Lab' },
  { sn: 25, name: 'Hot Air Circulating Oven',           capacity: '18" x 18"',                                                            makeModel: 'INFRA DIGI IR 801A',           serial: '35973',      rapsId: 'RAMS/OVEN-03/LM/23', place: 'Unit-2 QC Lab' },
  { sn: 26, name: 'Muffle Furnace',                     capacity: '8" x 8"',                                                              makeModel: 'TC244',                        serial: '38304',      rapsId: 'RAMS/MF-01/LM/24',   place: 'Unit-2 QC Lab' },
  { sn: 27, name: 'CNC Lathe Machine',                  capacity: 'Dia 1000mm\nLength-10 Meter',                                          makeModel: 'Stanko import',                serial: 'NA',         rapsId: 'RAMS/CNC-01/LM/15',  place: 'Unit-3' },
  { sn: 28, name: 'HMT Lathe Machine',                  capacity: 'Dia-400mm\nLength-1 Meter',                                            makeModel: 'HMT',                          serial: 'NA',         rapsId: 'RAMS/HMT-01/LM/16',  place: 'Unit-3' },
  { sn: 29, name: 'Auto clave',                         capacity: 'Dia 2000mm x Length 6500mm',                                           makeModel: 'Innovative Engineering',       serial: 'NA',         rapsId: 'RAMS/ACC-01/LM/17',  place: 'Unit-3' },
  { sn: 30, name: 'CNC Lathe Machine (Quality)',        capacity: 'Dia1000 x L5000mm',                                                    makeModel: 'Quality Machine Products',     serial: 'EHD-BB-7 (Double Gap Bed)', rapsId: 'RAMS/CNC-02/LM/18', place: 'Unit-3' },
  { sn: 31, name: 'Mechanical Hoist with Chain Block Pulley', capacity: '2 Ton',                                                          makeModel: 'Raja Forging India & Sri Lakshmi Durga Engg Works', serial: 'R43220', rapsId: 'RAMS/CBP-03/LM/19', place: 'Unit-3' },
  { sn: 32, name: 'Mechanical Hoist with Chain Block Pulley', capacity: '5 Ton',                                                          makeModel: 'Bajaj Indef, Hercules Hoists Pvt Ltd', serial: 'NA', rapsId: 'RAMS/CBP-04/LM/39', place: 'Unit-3' },
  { sn: 33, name: 'Air Compressor',                     capacity: '9.5 Bar/psi',                                                          makeModel: 'ELGI',                         serial: 'EG-22-10',   rapsId: 'RAMS/AC-02/LM/25',   place: 'Unit-3' },
  { sn: 34, name: 'Conventional Lathe Machine',         capacity: 'Dia 400mm\nLength-3500mm',                                             makeModel: 'NA',                           serial: 'NA',         rapsId: 'RAMS/CL-02/LM/28',   place: 'Unit-3' },
  { sn: 35, name: 'Sand Blasting Machine',              capacity: '5 Bar',                                                                makeModel: 'NA',                           serial: 'NA',         rapsId: 'RAPS/SBM-01/LM/41',  place: 'Unit-3' },
  { sn: 36, name: 'Hot Air Circulating Oven',           capacity: 'L1500 x W1500 x H1500mm',                                              makeModel: 'Ria Instruments RHO-150',      serial: 'Ser No 201', rapsId: 'RAPS/OVEN-07/LM/42', place: 'Unit-3' },
  { sn: 37, name: 'Vacuum Pump',                        capacity: '3000 ltr / min',                                                       makeModel: 'PRABIVAC',                     serial: '4851',       rapsId: 'RAPS/VP-03/LM/46',   place: 'Unit-3' },
  { sn: 38, name: 'Vacuum Pump',                        capacity: '600 ltr / min',                                                        makeModel: 'PRABIVAC',                     serial: '4245',       rapsId: 'RAPS/VP-04/LM/47',   place: 'Unit-3' },
  { sn: 39, name: 'Rubber Mixing Mill',                 capacity: '14" x 36" INCH',                                                       makeModel: 'GG Engineering Works',         serial: 'NA',         rapsId: 'RAMS/MILL-02/LM/31', place: 'Unit-4' },
  { sn: 40, name: 'Extruder',                           capacity: 'Rubber Sheet\nWidth-1000mm',                                           makeModel: 'Sri Lakshmi Durga Engineering Works', serial: 'NA',  rapsId: 'RAMS/EXT-01/LM/20',  place: 'Unit-4' },
  { sn: 41, name: 'CNC Lathe Machine',                  capacity: 'Dia-350mm\nLength-2000mm',                                             makeModel: 'NA',                           serial: 'NA',         rapsId: 'RAMS/CNC-03/LM/40',  place: 'Unit-4' },
  { sn: 42, name: 'Tow Preg Machine',                   capacity: 'Temp range: 0°C to 200°C',                                             makeModel: 'Sri Krishna Enterprises',      serial: 'NA',         rapsId: 'RAMS/Tow Preg-01/48',place: 'Unit-4' },
  { sn: 43, name: 'Tape Winding Machine',               capacity: 'Dia1000mm x L2000mm',                                                  makeModel: 'GEEPEE',                       serial: 'NA',         rapsId: 'RAMS/TWM-01/LM/13',  place: 'Unit-5' },
  { sn: 44, name: 'Filament Winding Machine',           capacity: 'Dia2500mm x L10500mm',                                                 makeModel: 'CNC TECHNICS PVT LTD',         serial: 'NA',         rapsId: 'RAMS/FWM-01/LM/26',  place: 'Unit-5' },
  { sn: 45, name: 'Chain Block Pulley',                 capacity: '2 Ton',                                                                makeModel: 'INDEF-P',                      serial: 'K2122007389',rapsId: 'RAMS/CBP-01/LM/09',  place: 'Unit-5' },
  { sn: 46, name: 'Hot Air Circulating Oven',           capacity: 'L3000mm x W3000 x H10500mm',                                           makeModel: 'SV HEAT ENGINEERING',          serial: 'NA',         rapsId: 'RAMS/OVEN-04/LM/27', place: 'Unit-5' },
  { sn: 47, name: 'Hydro Pressure Test Facility',       capacity: '1000 Ltrs',                                                            makeModel: 'Hi Tech Hydraulics',           serial: 'NA',         rapsId: 'RAMS/HPTF-01/LM/32', place: 'Unit-5' },
  { sn: 48, name: 'Conventional Lathe Machine',         capacity: 'Dia – 400mm\nLength – 3 mtr',                                          makeModel: 'Jay Kisan',                    serial: 'NA',         rapsId: 'RAMS/CL-04/LM/43',   place: 'Unit-5' },
  { sn: 49, name: 'Cold Room',                          capacity: "Length – 10', Width – 10', Height – 8'\nTemp – (-18°C)",               makeModel: 'RINAC',                        serial: 'Ser No. 24/105-2 / Unit Ser No. 241050', rapsId: 'RAMS/CR-02/LM/44', place: 'Unit-5' },
  { sn: 50, name: 'Air Compressor',                     capacity: '220 Ltr',                                                              makeModel: 'ELGI',                         serial: 'CTEE211368', rapsId: 'RAMS/AC-01/LM/21',   place: 'Unit-1' },
  { sn: 51, name: 'CNC Oscillating Template Cutting Machine', capacity: 'Working Length: 2 mtr\nWorking Width: 1.5 mtr',                  makeModel: 'MK Technologies',              serial: 'NA',         rapsId: 'RAMS/CNC TC-01/51',  place: 'Unit-5' },
];

const DRY_ABC = 'Dry Powder Fire Extinguisher (ABC)';
const CO2    = 'Carbon Dioxide Fire Extinguisher';

const FIRE_EXT = [
  // Unit-1
  { sn:1, type: DRY_ABC, capacity: '4 Kgs',   rapsId: 'RAMS/ABC-01/FE-01', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-1',  location: 'Stair case entrance' },
  { sn:2, type: DRY_ABC, capacity: '4 Kgs',   rapsId: 'RAMS/ABC-02/FE-02', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-1',  location: 'Main entrance shutter' },
  { sn:3, type: CO2,     capacity: '4.5 Kgs', rapsId: 'RAMS/CO2-01/FE-03', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-1',  location: 'Main entrance' },
  // Unit-2
  { sn:1, type: DRY_ABC, capacity: '4 Kgs',   rapsId: 'RAMS/ABC-03/FE-04', refilledOn: '11/11/25', nextDueOn: '10/11/26', unit: 'Unit-2',  location: 'Main entrance shutter' },
  { sn:2, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-04/FE-05', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-2',  location: 'QC Lab entrance' },
  { sn:3, type: CO2,     capacity: '4.5 Kgs', rapsId: 'RAMS/CO2-02/FE-06', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-2',  location: 'Pre preg machine area' },
  // Unit-3
  { sn:1, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-05/FE-07', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-3',  location: 'Main entrance Lt side' },
  { sn:2, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-06/FE-08', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-3',  location: 'New CNC Lathe' },
  { sn:3, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-07/FE-09', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-3',  location: 'Left side wall layup area' },
  { sn:4, type: CO2,     capacity: '4.5 Kgs', rapsId: 'RAMS/CO2-03/FE-10', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-3',  location: 'Auto clave area' },
  // Unit-4
  { sn:1, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-08/FE-11', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-4',  location: 'Tea room side shutter' },
  { sn:2, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-09/FE-12', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-4',  location: 'Main entrance' },
  { sn:3, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-10/FE-13', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-4',  location: 'Conference hall entrance' },
  { sn:4, type: CO2,     capacity: '4.5 Kgs', rapsId: 'RAMS/CO2-04/FE-14', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-4',  location: 'Rubber Lining area' },
  { sn:5, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-12/FE-16', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-4',  location: 'Store' },
  { sn:6, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-13/FE-17', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-4',  location: 'Chemical pit area' },
  // Unit-5
  { sn:1, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-14/FE-18', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-5',  location: 'CNC Filament winding wall' },
  { sn:2, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-15/FE-19', refilledOn: '18/11/25', nextDueOn: '17/11/26', unit: 'Unit-5',  location: 'Near CNC Tape winding area' },
  { sn:3, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-16/FE-20', refilledOn: '18/11/25', nextDueOn: '17/11/26', unit: 'Unit-5',  location: 'Main Entrance Rt side' },
  { sn:4, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-17/FE-21', refilledOn: '07/04/25', nextDueOn: '06/04/26', unit: 'Unit-5',  location: 'PPT Area' },
  { sn:5, type: CO2,     capacity: '4.5 Kgs', rapsId: 'RAMS/CO2-05/FE-22', refilledOn: '17/11/25', nextDueOn: '16/11/26', unit: 'Unit-5',  location: 'Hot air oven side wall' },
  { sn:6, type: CO2,     capacity: '4.5 Kgs', rapsId: 'RAMS/CO2-06/FE-23', refilledOn: '07/04/25', nextDueOn: '06/04/26', unit: 'Unit-5',  location: 'Main Electric Panel Board' },
  // Unit-1A
  { sn:1, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-18/FE-24', refilledOn: '06/01/26', nextDueOn: '05/01/27', unit: 'Unit-1A', location: 'Lt side to Main shutter' },
  { sn:2, type: DRY_ABC, capacity: '6 Kgs',   rapsId: 'RAMS/ABC-19/FE-25', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Unit-1A', location: 'NDT Facility entrance' },
  // Corporate office Gannavaram
  { sn:1, type: DRY_ABC, capacity: '4 Kgs',   rapsId: 'RAMS/ABC-11/FE-15', refilledOn: '06/04/26', nextDueOn: '05/04/27', unit: 'Corporate office Gannavaram', location: 'Hall' },
];

async function main() {
  let machineryInserted = 0;
  for (const row of MACHINERY) {
    const existing = await prisma.machinery.findUnique({ where: { rapsId: row.rapsId } });
    if (existing) continue;
    await prisma.machinery.create({
      data: {
        serialNumber:    row.sn,
        name:            row.name,
        capacity:        row.capacity || null,
        makeModel:       row.makeModel || null,
        machineSerialNo: row.serial && row.serial !== 'NA' ? row.serial : null,
        rapsId:          row.rapsId,
        place:           row.place || null,
      },
    });
    machineryInserted += 1;
  }

  let feInserted = 0;
  for (const row of FIRE_EXT) {
    const existing = await prisma.fireExtinguisher.findUnique({ where: { rapsId: row.rapsId } });
    if (existing) continue;
    await prisma.fireExtinguisher.create({
      data: {
        serialNumber: row.sn,
        type:         row.type,
        capacity:     row.capacity,
        rapsId:       row.rapsId,
        refilledOn:   ddmmyy(row.refilledOn),
        nextDueOn:    ddmmyy(row.nextDueOn),
        unit:         row.unit,
        location:     row.location || null,
      },
    });
    feInserted += 1;
  }

  console.log(`Machinery inserted:        ${machineryInserted} / ${MACHINERY.length}`);
  console.log(`Fire extinguishers added:  ${feInserted} / ${FIRE_EXT.length}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
