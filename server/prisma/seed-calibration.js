/**
 * Seed the CalibrationItem table from the master calibration registers:
 *   - List of Pressure Gauges        (Doc RAMS/MMR/03, updated 04-10-2025)
 *   - List of Vacuum Gauges          (Doc RAMS/MMR/03, updated 29-09-2025)
 *   - Weighing Balances Calibration  (Doc RAMS/WS/01,  updated 20-11-2025)
 *   - List of Testing Equipments     (Doc RAMS/OA/LAB/CAL/01, updated 10-10-2025)
 *   - Metrology Instruments List     (Doc RAMS/MIL/01, updated 20-09-2026)
 *   - Monitoring & Measuring Resrcs  (Doc RAMS/MMR/03, updated 16-11-2025)
 *
 * Idempotent: wipes existing CalibrationItem rows before inserting so the
 * registers always reflect the source documents.
 */
const prisma = require('../src/config/db');

const D = (s) => (s ? new Date(s) : null);

const PRESSURE_GAUGES = [
  // UNIT-I
  { sNo: 1,  name: 'Pressure Gauge',     operatingRange: '0-400 Kg/Cm²',  make: 'Baumer',   serialNo: '03093',          rapsplSerialNo: null,                   unitLocation: 'UNIT-I',  calibrationOn: '2025-02-13', calibrationDueDate: '2026-02-12', recallDueDate: '2026-01-27', calibrationCertificate: 'SCSPL/WI/PG/CC/1279', usedFor: 'Hydraulic Press-I' },
  { sNo: 2,  name: 'Pressure Gauge',     operatingRange: '0-280 Kg/Cm²',  make: 'Baumer',   serialNo: '00603',          rapsplSerialNo: null,                   unitLocation: 'UNIT-I',  calibrationOn: '2025-02-13', calibrationDueDate: '2026-02-12', recallDueDate: '2026-01-27', calibrationCertificate: 'SCSPL/WI/PG/CC/1282', usedFor: 'Hydraulic Press-II' },
  { sNo: 3,  name: 'Pressure Gauge',     operatingRange: '0-420 Kg/Cm²',  make: 'Baumer',   serialNo: 'R225.59-01291',  rapsplSerialNo: null,                   unitLocation: 'UNIT-I',  calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-06', calibrationCertificate: 'KPS/25/MP/S035-01', usedFor: null },
  { sNo: 4,  name: 'Pressure Gauge',     operatingRange: '0-420 Kg/Cm²',  make: 'Baumer',   serialNo: 'R225.59-01311',  rapsplSerialNo: null,                   unitLocation: 'UNIT-I',  calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-06', calibrationCertificate: 'KPS/25/MP/S035-03', usedFor: null },
  { sNo: 5,  name: 'Pressure Gauge',     operatingRange: '0-25 Kg/Cm²',   make: 'ELGI',     serialNo: null,             rapsplSerialNo: null,                   unitLocation: 'UNIT-I',  calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-06', calibrationCertificate: 'KPS/25/MP/S035-02', usedFor: 'Compressor' },
  // UNIT-II
  { sNo: 6,  name: 'Pressure Gauge',     operatingRange: '0 to 420 bar',  make: 'Mass',     serialNo: 'EN 837-1',       rapsplSerialNo: 'RAMS/PG-03/MMR/16',    unitLocation: 'UNIT-II', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-08', usedFor: 'Hydraulic Press-I' },
  { sNo: 7,  name: 'Pressure Gauge',     operatingRange: '0 to 280 Kg/Cm²', make: 'Baumer', serialNo: 'P162.59-00679',  rapsplSerialNo: null,                   unitLocation: 'UNIT-II', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-07', usedFor: 'Hydraulic Press-II' },
  { sNo: 8,  name: 'Pressure Gauge',     operatingRange: '0 to 200 Kg/Cm²', make: 'Baumer', serialNo: 'M113.59-00360',  rapsplSerialNo: null,                   unitLocation: 'UNIT-II', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-06', usedFor: 'Hydraulic Press-III' },
  { sNo: 9,  name: 'Pressure Gauge',     operatingRange: '0 to 400 Kg/Cm²', make: 'Baumer', serialNo: '9000RHSG',       rapsplSerialNo: 'RAMS/HP-06/LM/49',     unitLocation: 'UNIT-II', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-09', usedFor: '(Hydraulic Press-06)' },
  // UNIT-III
  { sNo: 10, name: 'Pressure Gauge',     operatingRange: '0-16 Kg/Cm²',   make: 'GL-H-GURU', serialNo: '121-36',         rapsplSerialNo: null,                  unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/24/MP/S035-12', usedFor: 'Compressor Tank (S.B)' },
  { sNo: 11, name: 'Pressure Gauge',     operatingRange: '0-10.6 Kg/Cm²', make: 'GL-H-GURU', serialNo: null,             rapsplSerialNo: null,                  unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/24/MP/S035-13', usedFor: 'Sand Blasting' },
  { sNo: 12, name: 'Pressure Gauge',     operatingRange: '0-280 Bar',     make: 'MASS',     serialNo: '20180300',       rapsplSerialNo: null,                   unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/24/MP/S035-10', usedFor: 'Hydraulic Pump' },
  { sNo: 13, name: 'Pressure Gauge',     operatingRange: '0-16 Kg/Cm²',   make: 'H-GURU',   serialNo: '121-68',         rapsplSerialNo: null,                   unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/24/MP/S035-14', usedFor: 'Auto Clave' },
  { sNo: 14, name: 'Pressure Gauge',     operatingRange: '0-16 Kg/Cm²',   make: 'H-GURU',   serialNo: '121-68',         rapsplSerialNo: null,                   unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/24/MP/S035-11', usedFor: 'Auto Clave (Top)' },
  { sNo: 15, name: 'Pressure Transmitter', operatingRange: '0-25 Bar',    make: 'WIKAI',    serialNo: '110FNHWH',       rapsplSerialNo: null,                   unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/24/MP/S035-15', usedFor: 'Auto Clave' },
  // UNIT-V
  { sNo: 16, name: 'Pressure Gauge',     operatingRange: '0-100 Bar',     make: 'Mass',     serialNo: '20K85739',       rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-20', usedFor: 'Filament Winding Machine' },
  { sNo: 17, name: 'Pressure Gauge',     operatingRange: '0-160 Bar',     make: 'Mass',     serialNo: null,             rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-19', usedFor: 'Filament Winding Machine' },
  { sNo: 18, name: 'Pressure Gauge',     operatingRange: '0-10 Kg/Cm²',   make: 'BAUMER',   serialNo: 'T162.59-05792',  rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-06-10', calibrationDueDate: '2026-06-09', recallDueDate: '2026-05-25', calibrationCertificate: 'SCS/06-25/1408-02', usedFor: 'Filament Winding Machine' },
  { sNo: 19, name: 'Pressure Gauge',     operatingRange: '0-14 Kg/Cm²',   make: 'MICRO',    serialNo: null,             rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-21', usedFor: 'Filament Winding Machine' },
  { sNo: 20, name: 'Pressure Gauge',     operatingRange: '0-21 Kg/Cm²',   make: 'HK',       serialNo: '2203629',        rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-23', usedFor: null },
  { sNo: 21, name: 'Pressure Gauge',     operatingRange: '0-250 Kg/Cm²',  make: 'WIKA',     serialNo: '900018MA',       rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-22', usedFor: null },
  { sNo: 22, name: 'Pressure Gauge',     operatingRange: '0-160 Kg/Cm²',  make: 'BAUMER',   serialNo: 'R076.59-01477',  rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-06-09', calibrationDueDate: '2026-06-08', recallDueDate: '2026-05-25', calibrationCertificate: 'KPS/25/MP/S009-01', usedFor: null },
  { sNo: 23, name: 'Pressure Gauge',     operatingRange: '0-10 Kg/Cm²',   make: 'BAUMER',   serialNo: 'T162.59-05794',  rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-06-10', calibrationDueDate: '2026-06-09', recallDueDate: '2026-05-25', calibrationCertificate: 'SCS/06-25/1408-05', usedFor: null },
  { sNo: 24, name: 'Pressure Gauge',     operatingRange: '0-70 Kg/Cm²',   make: 'BAUMER',   serialNo: 'R415.59-00350',  rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-06-10', calibrationDueDate: '2026-06-09', recallDueDate: '2026-05-25', calibrationCertificate: 'SCS/06-25/1408-04', usedFor: null },
  { sNo: 25, name: 'Pressure Gauge',     operatingRange: '0-70 Kg/Cm²',   make: 'BAUMER',   serialNo: 'R354.59-00878',  rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-06-10', calibrationDueDate: '2026-06-09', recallDueDate: '2026-05-25', calibrationCertificate: 'SCS/06-25/1408-03', usedFor: null },
  { sNo: 26, name: 'Pressure Gauge',     operatingRange: '0-70 Kg/Cm²',   make: 'BAUMER',   serialNo: 'R354.59-00882',  rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-06-10', calibrationDueDate: '2026-06-09', recallDueDate: '2026-05-25', calibrationCertificate: 'SCS/06-25/1408-01', usedFor: null },
  { sNo: 27, name: 'Digital Pressure Gauge', operatingRange: '0-100 bar', make: 'RADIX',    serialNo: '25071066',       rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-09-06', calibrationDueDate: '2026-09-08', recallDueDate: '2025-05-24', calibrationCertificate: 'KPS/25/MP/L017-01', usedFor: null },
  { sNo: 28, name: 'Digital Pressure Gauge', operatingRange: '0-100 bar', make: 'RADIX',    serialNo: '25071061',       rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-05-27', calibrationDueDate: '2026-05-26', recallDueDate: '2026-05-11', calibrationCertificate: '25-0011002-PG', usedFor: null },
  { sNo: 29, name: 'Pressure Gauge',     operatingRange: '0-4 Kg/Cm²',    make: 'BAUMER',   serialNo: '00695',          rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-10-01', calibrationDueDate: '2026-09-30', recallDueDate: '2026-09-14', calibrationCertificate: 'SCSPL/WI/PG/CC/1281', usedFor: null },
  { sNo: 30, name: 'Pressure Gauge',     operatingRange: '0-70 Kg/Cm²',   make: 'BAUMER',   serialNo: '00864',          rapsplSerialNo: null,                   unitLocation: 'UNIT-V', calibrationOn: '2025-10-01', calibrationDueDate: '2026-09-30', recallDueDate: '2026-09-14', calibrationCertificate: 'SCSPL/WI/PG/CC/1280', usedFor: null },
];

const VACUUM_GAUGES = [
  { name: 'Vacuum Gauge',    operatingRange: '0 to 760 mm Hg', make: 'GL-H-Guru', serialNo: 'F 21-3350', rapsplSerialNo: null, unitLocation: 'UNIT-I',   calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-06', calibrationCertificate: 'KPS/25/MP/S035-04', usedFor: 'Vacuum Pump-1' },
  { name: 'Vacuum Gauge',    operatingRange: '0 to 760 mm Hg', make: 'GL-H-Guru', serialNo: 'F 21-3410', rapsplSerialNo: null, unitLocation: 'UNIT-I',   calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-06', calibrationCertificate: 'KPS/25/MP/S035-05', usedFor: 'Vacuum Pump-2' },
  { name: 'Vacuum Gauge',    operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: 'VG-01',     rapsplSerialNo: null, unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-16', usedFor: 'Autoclave' },
  { name: 'Vacuum Gauge',    operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: 'VG-02',     rapsplSerialNo: null, unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-17', usedFor: 'Autoclave' },
  { name: 'Vacuum Gauge',    operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: '4245',      rapsplSerialNo: null, unitLocation: 'UNIT-III', calibrationOn: '2025-09-26', calibrationDueDate: '2026-09-25', recallDueDate: '2026-09-10', calibrationCertificate: 'KPS/25/MP/S035-18', usedFor: 'Autoclave' },
  { name: 'Vacuum Gauge',    operatingRange: '0 to -760 mm Hg', make: 'H-Guru',   serialNo: 'L24-1123',  rapsplSerialNo: null, unitLocation: 'UNIT-V',   calibrationOn: '2025-06-09', calibrationDueDate: '2026-06-08', recallDueDate: '2026-05-25', calibrationCertificate: 'KPS/25/MP/S009-05', usedFor: 'Vacuum Pump' },
  { name: 'SS Vacuum Gauge', operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: '01215',     rapsplSerialNo: null, unitLocation: 'UNIT-V',   calibrationOn: '2024-12-30', calibrationDueDate: '2025-12-29', recallDueDate: '2025-12-14', calibrationCertificate: 'SCSPL/WI/VG/CC/1275', usedFor: null },
  { name: 'SS Vacuum Gauge', operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: '01154',     rapsplSerialNo: null, unitLocation: 'UNIT-V',   calibrationOn: '2024-12-30', calibrationDueDate: '2025-12-29', recallDueDate: '2025-12-14', calibrationCertificate: 'SCSPL/WI/VG/CC/1276', usedFor: null },
  { name: 'SS Vacuum Gauge', operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: '01143',     rapsplSerialNo: null, unitLocation: 'UNIT-V',   calibrationOn: '2024-12-30', calibrationDueDate: '2025-12-29', recallDueDate: '2025-12-14', calibrationCertificate: 'SCSPL/WI/VG/CC/1277', usedFor: null },
  { name: 'SS Vacuum Gauge', operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: '01216',     rapsplSerialNo: null, unitLocation: 'UNIT-V',   calibrationOn: '2024-12-30', calibrationDueDate: '2025-12-29', recallDueDate: '2025-12-14', calibrationCertificate: 'SCSPL/WI/VG/CC/1278', usedFor: null },
  { name: 'SS Vacuum Gauge', operatingRange: '0 to 760 mm Hg', make: 'Baumer',    serialNo: '00351',     rapsplSerialNo: null, unitLocation: 'UNIT-V',   calibrationOn: '2024-12-30', calibrationDueDate: '2025-12-29', recallDueDate: '2025-12-14', calibrationCertificate: 'SCSPL/WI/VG/CC/1283', usedFor: null },
];

const WEIGHING_BALANCES = [
  { rapsplSerialNo: 'RAPS/WS/150-Kg/01',     serialNo: '2432176',       make: 'ZOBRA',              model: null,        leastCount: '20g',     capacityMin: '20g',     capacityMax: '150Kg',   calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/8',  unitLocation: 'UNIT-1' },
  { rapsplSerialNo: 'RAPS/WS/30-Kg/02',      serialNo: 'H2500082288',   make: 'ESSAE',              model: 'DX-451',    leastCount: '100g',    capacityMin: '100g',    capacityMax: '30Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/6',  unitLocation: 'UNIT-1' },
  { rapsplSerialNo: 'RAPS/WS/3000g/03',      serialNo: 'B2500446809',   make: 'ESSAE',              model: 'DX-451',    leastCount: '10g',     capacityMin: '10g',     capacityMax: '3000g',   calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/7',  unitLocation: 'UNIT-1' },
  { rapsplSerialNo: 'RAPS/WS/10Kg/04',       serialNo: null,            make: null,                 model: null,        leastCount: '0.001Kg', capacityMin: '0.001Kg', capacityMax: '10Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/15', unitLocation: 'UNIT-1A' },
  { rapsplSerialNo: 'RAPS/WS/220g/05',       serialNo: 'N1200212-092',  make: 'SCALE TEC',          model: 'SAB-224CL', leastCount: '0.0001g', capacityMin: '0.0001g', capacityMax: '220g',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/3',  unitLocation: 'UNIT-2(Lab)' },
  { rapsplSerialNo: 'RAPS/WS/600g/06',       serialNo: 'FB60021329225', make: 'ESSAE',              model: 'FB-600',    leastCount: '0.1g',    capacityMin: '0.1g',    capacityMax: '600g',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/1',  unitLocation: 'UNIT-2(Lab)' },
  { rapsplSerialNo: 'RAPS/WS/600g/07',       serialNo: '16072541',      make: 'SAMSON',             model: 'S-600HC',   leastCount: '0.2g',    capacityMin: '0.2g',    capacityMax: '600g',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/2',  unitLocation: 'UNIT-2(Lab)' },
  { rapsplSerialNo: 'RAPS/WS/80Kg/08',       serialNo: null,            make: 'TVST',               model: null,        leastCount: '5g',      capacityMin: '5g',      capacityMax: '80Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/14', unitLocation: 'UNIT-2' },
  { rapsplSerialNo: 'RAPS/WS/25Kg/09',       serialNo: null,            make: 'OMEGA',              model: null,        leastCount: '0.001 Kg', capacityMin: '0.001 Kg', capacityMax: '25Kg',  calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/4',  unitLocation: 'UNIT-3' },
  { rapsplSerialNo: 'RAPS/WS/1000Kg/10',     serialNo: 'B250044S533',   make: 'ESSAE',              model: 'DX-451',    leastCount: '4Kg',     capacityMin: '4Kg',     capacityMax: '1000Kg',  calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/5',  unitLocation: 'UNIT-3' },
  { rapsplSerialNo: 'RAPS/WS/3000Kg/11',     serialNo: 'DS4512131479',  make: 'ESSAE',              model: 'DX-451',    leastCount: '10Kg',    capacityMin: '10Kg',    capacityMax: '3000Kg',  calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/9',  unitLocation: 'UNIT-3' },
  { rapsplSerialNo: 'RAPS/WS/150Kg/12',      serialNo: '8105672',       make: 'KGR',                model: 'KT150Kg',   leastCount: '10g',     capacityMin: '10g',     capacityMax: '150Kg',   calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/10', unitLocation: 'UNIT-4' },
  { rapsplSerialNo: 'RAPS/WS/15Kg/13',       serialNo: '3684',          make: 'United',             model: 'DS104',     leastCount: '10g',     capacityMin: '10g',     capacityMax: '150kg',   calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/11', unitLocation: 'UNIT-4' },
  { rapsplSerialNo: 'RAPS/WS/20Kg/14',       serialNo: 'G852227S2695',  make: 'ESSAE',              model: 'DX-852',    leastCount: '0.1g',    capacityMin: '0.1g',    capacityMax: '20Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/16', unitLocation: 'UNIT-4' },
  { rapsplSerialNo: 'RAPS/WS/3000Kg/15',     serialNo: 'B2500442975',   make: 'ESSAE',              model: 'DX-451',    leastCount: '10Kg',    capacityMin: '10Kg',    capacityMax: '3000Kg',  calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/12', unitLocation: 'UNIT-4' },
  { rapsplSerialNo: 'RAPS/WS/20Kg/16',       serialNo: 'G852227S2696',  make: 'ESSAE',              model: 'DX-852',    leastCount: '0.1g',    capacityMin: '0.1g',    capacityMax: '20Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/13', unitLocation: 'UNIT-5' },
  { rapsplSerialNo: 'RAPS/SB/25Kg/17',       serialNo: null,            make: 'BABY SUSPENSION SCALE', model: null,     leastCount: '1Kg',     capacityMin: '1Kg',     capacityMax: '25Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/1/1',  unitLocation: 'UNIT-5' },
  { rapsplSerialNo: 'RAPS/SW/1mg/01 to RAPS/SW/200*g/02', serialNo: null, make: 'Accuracy Weights', model: null,        leastCount: '1mg',     capacityMin: '1mg',     capacityMax: '200g',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/2/2',  unitLocation: 'UNIT-2(Lab)' },
  { rapsplSerialNo: 'RAPS/SW/50g/01 to RAPS/SW/20*Kg/03', serialNo: null, make: null,               model: null,        leastCount: '50g',     capacityMin: '50g',     capacityMax: '20Kg',    calibrationOn: '2025-11-19', calibrationDueDate: '2026-11-18', recallDueDate: '2026-11-03', calibrationCertificate: 'SC T/191125/5/2',  unitLocation: 'Store' },
];

const TESTING_EQUIPMENT = [
  { sNo: 1,  name: 'Universal Testing Machine',                make: 'TEC-SOL INDIA',  model: 'UTM-20/3K',  serialNo: '210721',       rapsplSerialNo: 'RAMS/UTM-01/LM/22', calibrationOn: '2025-10-10', calibrationDueDate: '2026-09-10', recallDueDate: '2026-09-25', calibrationCertificate: 'CC-2525-S-0003/17C' },
  { sNo: 2,  name: 'Brook Field LV Viscometer',                make: 'AMTEK',          model: 'DV2TLVT j0', serialNo: '86042107',     rapsplSerialNo: 'RAMS/VM-01/MMR/40', calibrationOn: '2025-06-07', calibrationDueDate: '2026-06-06', recallDueDate: '2026-06-17', calibrationCertificate: 'SLT/RAPSPL/QS/CAL/001' },
  { sNo: 3,  name: 'Analytical Balance (ESSAE)',               make: 'E.T.P.L FB 600', model: 'ETPLFB-600', serialNo: 'FB60021329225', rapsplSerialNo: 'RAMS/WS/600-gms/06', calibrationOn: '2024-11-20', calibrationDueDate: '2025-11-19', recallDueDate: '2025-11-04', calibrationCertificate: 'SCT/201124/10/6' },
  { sNo: 4,  name: 'Analytical Balance (SAMSON)',              make: 'SAMSON',         model: 'S-600 H.C',  serialNo: '16072541',     rapsplSerialNo: 'RAMS/WS/600-gms/07', calibrationOn: '2024-11-20', calibrationDueDate: '2025-11-19', recallDueDate: '2025-11-04', calibrationCertificate: 'SCT/201124/10/7' },
  { sNo: 5,  name: 'Analytical Balance (SCALE TECH)',          make: 'SCALE TECH',     model: 'SAB-224CL',  serialNo: 'N1200212-092', rapsplSerialNo: 'RAMS/WS/220-gms/05', calibrationOn: '2024-11-20', calibrationDueDate: '2025-11-19', recallDueDate: '2025-11-04', calibrationCertificate: 'SCT/201124/10/8' },
  { sNo: 6,  name: 'Temperature Controller (Hot Air Circulating Oven)', make: null,    model: 'TCK-41, J-TYPE', serialNo: '35973',    rapsplSerialNo: 'RAMS/OVEN-03/LM/23', calibrationOn: '2025-01-30', calibrationDueDate: '2026-01-29', recallDueDate: '2026-01-14', calibrationCertificate: 'CC265824000000356F' },
  { sNo: 7,  name: 'Temperature Controller (Muffle Furnace)',  make: null,             model: 'TC244',      serialNo: '38304',        rapsplSerialNo: 'RAMS/MF-01/LM/24', calibrationOn: '2025-01-30', calibrationDueDate: '2026-01-29', recallDueDate: '2026-01-14', calibrationCertificate: 'CC265824000000355F' },
  { sNo: 8,  name: 'Dial Thickness Gauge',                     make: 'Mitutoyo',       model: 'ZSM704',     serialNo: '2046S',        rapsplSerialNo: 'RAMS/DTG/34', calibrationOn: '2025-03-03', calibrationDueDate: '2026-03-02', recallDueDate: '2026-02-25', calibrationCertificate: 'VKRCL/2025-26/1705' },
  { sNo: 9,  name: 'Shore "A" Hardness',                       make: 'STI',            model: 'SHORE "A" Type', serialNo: 'DIN-53505', rapsplSerialNo: 'RAMS/SH 01/MMR/32', calibrationOn: null, calibrationDueDate: null, recallDueDate: null, calibrationCertificate: 'SELF' },
  { sNo: 10, name: 'Barcol Hardness',                          make: 'BAKER',          model: '934-1',      serialNo: '2020/015',     rapsplSerialNo: 'RAMS/BH-01/MMR/31', calibrationOn: null, calibrationDueDate: null, recallDueDate: null, calibrationCertificate: 'SELF' },
];

// Metrology Instruments — Vernier Calipers, Micrometers, etc.
// Approximate transcription from the WhatsApp image (some serial / cert columns
// were partially illegible — left as null where unreadable so Metrology can
// fill in correct values via the UI).
const METROLOGY_INSTRUMENTS = [
  { sNo: 1,  name: 'Dial Vernier Caliper',     operatingRange: '0-300mm', leastCount: '0.01', make: null, model: null, serialNo: '15349907', rapsplSerialNo: 'RAMS/DVC/01', calibrationOn: '2025-02-10', calibrationDueDate: '2026-02-09', recallDueDate: '2026-01-26', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 2,  name: 'Dial Vernier Caliper',     operatingRange: '0-300mm', leastCount: '0.02', make: null, model: null, serialNo: '23254937', rapsplSerialNo: 'RAMS/DVC/02', calibrationOn: '2025-09-24', calibrationDueDate: '2026-09-23', recallDueDate: '2026-09-09', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 3,  name: 'Dial Vernier Caliper',     operatingRange: '0-300mm', leastCount: '0.02', make: null, model: null, serialNo: 'JK564644', rapsplSerialNo: 'RAMS/DVC/03', calibrationOn: '2025-02-23', calibrationDueDate: '2026-02-22', recallDueDate: '2026-02-08', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 4,  name: 'Dial Vernier Caliper',     operatingRange: '0-200mm', leastCount: '0.01', make: null, model: null, serialNo: '23559919', rapsplSerialNo: 'RAMS/DVC/04', calibrationOn: '2025-09-24', calibrationDueDate: '2026-09-23', recallDueDate: '2026-09-09', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 5,  name: 'Digital Vernier Caliper',  operatingRange: '0-200mm', leastCount: '0.01', make: null, model: null, serialNo: '1093282',  rapsplSerialNo: 'RAMS/DVC/05', calibrationOn: '2025-04-26', calibrationDueDate: '2026-04-25', recallDueDate: '2026-04-11', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 6,  name: 'Digital Vernier Caliper',  operatingRange: '0-200mm', leastCount: '0.01', make: null, model: null, serialNo: '21037593', rapsplSerialNo: 'RAMS/DVC/06', calibrationOn: '2025-04-26', calibrationDueDate: '2026-04-25', recallDueDate: '2026-04-11', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 7,  name: 'Knife Edge Vernier Caliper', operatingRange: '0-300mm', leastCount: '0.05', make: null, model: null, serialNo: '197070', rapsplSerialNo: 'RAMS/KEVC/01', calibrationOn: '2025-05-12', calibrationDueDate: '2026-05-11', recallDueDate: '2026-04-27', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 8,  name: 'Vernier Height Gauge',     operatingRange: '0-300mm', leastCount: '0.02', make: null, model: null, serialNo: '1092387',  rapsplSerialNo: 'RAMS/VHG/01', calibrationOn: '2025-04-26', calibrationDueDate: '2026-04-25', recallDueDate: '2026-04-11', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 9,  name: 'Vernier Height Gauge',     operatingRange: '0-300mm', leastCount: '0.02', make: null, model: null, serialNo: '11703367', rapsplSerialNo: 'RAMS/VHG/02', calibrationOn: '2025-04-26', calibrationDueDate: '2026-04-25', recallDueDate: '2026-04-11', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 10, name: 'Vernier Caliper',          operatingRange: '0-200mm', leastCount: '0.02', make: null, model: null, serialNo: null,       rapsplSerialNo: 'RAMS/VC/01',  calibrationOn: '2025-04-26', calibrationDueDate: '2026-04-25', recallDueDate: '2026-04-11', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 11, name: 'Outside Micro Meter',      operatingRange: '0-25mm',  leastCount: '0.01', make: null, model: null, serialNo: '4624274',  rapsplSerialNo: 'RAMS/OMM/01', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 12, name: 'Outside Micro Meter',      operatingRange: '25-50mm', leastCount: '0.01', make: null, model: null, serialNo: '6122110',  rapsplSerialNo: 'RAMS/OMM/02', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 13, name: 'Outside Micro Meter',      operatingRange: '50-75mm', leastCount: '0.01', make: null, model: null, serialNo: null,       rapsplSerialNo: 'RAMS/OMM/03', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 14, name: 'Outside Micro Meter',      operatingRange: '75-100mm',leastCount: '0.01', make: null, model: null, serialNo: null,       rapsplSerialNo: 'RAMS/OMM/04', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 15, name: 'Outside Micro Meter',      operatingRange: '100-125mm', leastCount: '0.01', make: null, model: null, serialNo: null,     rapsplSerialNo: 'RAMS/OMM/05', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 16, name: 'Outside Micro Meter',      operatingRange: '125-150mm', leastCount: '0.01', make: null, model: null, serialNo: null,     rapsplSerialNo: 'RAMS/OMM/06', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 17, name: 'Outside Micro Meter',      operatingRange: '150-175mm', leastCount: '0.01', make: null, model: null, serialNo: null,     rapsplSerialNo: 'RAMS/OMM/07', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
  { sNo: 18, name: 'Outside Micro Meter',      operatingRange: '175-200mm', leastCount: '0.01', make: null, model: null, serialNo: null,     rapsplSerialNo: 'RAMS/OMM/08', calibrationOn: '2025-11-12', calibrationDueDate: '2026-11-11', recallDueDate: '2026-10-28', calibrationCertificate: 'VKRCL/2025-26/M/F', unitLocation: 'UNIT-1' },
];

// Monitoring & Measuring Resources (MMR) — thermocouples and PID controllers,
// transcribed from the WhatsApp image. Hot Air Circulating Oven + 3 Zone PID
// controllers and J-type thermocouples.
const MMR_RESOURCES = [
  { sNo: 1, name: 'Hot Air Circulating Oven',                    make: null, model: null,    serialNo: null,           rapsplSerialNo: 'RAMS/OVEN-04/LM/27', operatingRange: '1500mm(L) x 3000mm(W) x 3000mm(H)', calibrationOn: '2025-11-14', calibrationDueDate: '2026-11-13', recallDueDate: '2026-10-29', calibrationCertificate: 'CC265825000003390P', unitLocation: 'UNIT-5', usedFor: 'Hot Air Circulating Oven' },
  { sNo: 2, name: 'Thermocouple with PID Controller (Zone-1)',   make: null, model: 'J-TYPE', serialNo: '2102 263377',  rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003351F', unitLocation: 'UNIT-5' },
  { sNo: 3, name: 'J-Type Thermocouple with Safety Controller (Zone-1)', make: null, model: 'J-TYPE', serialNo: '2K 2163848', rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003352F', unitLocation: 'UNIT-5' },
  { sNo: 4, name: 'Temperature Scanner for Zone-1',              make: null, model: 'J-TYPE', serialNo: '21072021103118', rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003353F', unitLocation: 'UNIT-5' },
  { sNo: 5, name: 'Thermocouple with PID Controller (Zone-2)',   make: null, model: 'J-TYPE', serialNo: '210 263371',    rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003354F', unitLocation: 'UNIT-5' },
  { sNo: 6, name: 'J-Type Thermocouple with Safety Controller (Zone-2)', make: null, model: 'J-TYPE', serialNo: '2K 2161328', rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003355F', unitLocation: 'UNIT-5' },
  { sNo: 7, name: 'Temperature Scanner for Zone-2',              make: null, model: 'J-TYPE', serialNo: '21072021015',   rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003355F', unitLocation: 'UNIT-5' },
  { sNo: 8, name: 'Thermocouple with PID Controller (Zone-3)',   make: null, model: 'J-TYPE', serialNo: '20K 639829',    rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003357F', unitLocation: 'UNIT-5' },
  { sNo: 9, name: 'J-Type Thermocouple with Safety Controller (Zone-3)', make: null, model: 'J-TYPE', serialNo: '2K 2162236', rapsplSerialNo: null, calibrationOn: '2025-11-13', calibrationDueDate: '2026-11-12', recallDueDate: '2026-10-11', calibrationCertificate: 'CC265825000003358F', unitLocation: 'UNIT-5' },
];

const toRow = (category) => (r) => ({
  category,
  name:                   r.name,
  make:                   r.make           || null,
  model:                  r.model          || null,
  serialNo:               r.serialNo       || null,
  rapsplSerialNo:         r.rapsplSerialNo || null,
  operatingRange:         r.operatingRange || null,
  capacityMin:            r.capacityMin    || null,
  capacityMax:            r.capacityMax    || null,
  leastCount:             r.leastCount     || null,
  unitLocation:           r.unitLocation   || null,
  usedFor:                r.usedFor        || null,
  calibrationOn:          D(r.calibrationOn),
  calibrationDueDate:     D(r.calibrationDueDate),
  recallDueDate:          D(r.recallDueDate),
  calibrationCertificate: r.calibrationCertificate || null,
  periodicity:            r.periodicity    || 'Every One Year',
});

async function main() {
  console.log('Wiping existing CalibrationItem rows...');
  await prisma.calibrationItem.deleteMany({});

  const rows = [
    ...PRESSURE_GAUGES.map(toRow('PRESSURE_GAUGE')),
    ...VACUUM_GAUGES.map(toRow('VACUUM_GAUGE')),
    ...WEIGHING_BALANCES.map(toRow('WEIGHING_BALANCE')),
    ...TESTING_EQUIPMENT.map(toRow('TESTING_EQUIPMENT')),
    ...METROLOGY_INSTRUMENTS.map(toRow('METROLOGY_INSTRUMENT')),
    ...MMR_RESOURCES.map(toRow('MMR')),
  ];

  // Default a name for weighing balances (no `name` field in the source)
  rows.forEach((r) => {
    if (!r.name) r.name = 'Weighing Balance';
  });

  console.log(`Inserting ${rows.length} calibration items...`);
  await prisma.calibrationItem.createMany({ data: rows });

  const counts = await prisma.calibrationItem.groupBy({
    by: ['category'],
    _count: { _all: true },
  });
  console.log('Per-category counts:');
  counts.forEach((c) => console.log(`  ${c.category}: ${c._count._all}`));
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
