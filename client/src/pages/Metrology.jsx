import CalibrationList from './metrology/CalibrationList';

// Single unified register for every calibrated instrument. Each group below
// rolls up both the legacy top-level `category` rows (PRESSURE_GAUGE, …) and
// the matching MMR `mmrSubCategory` rows into one bucket the user sees.
// New rows created from this page are stored as MMR + sub-category.
const UNIFIED_CATEGORIES = [
  {
    value: 'PRESSURE_GAUGES',
    label: 'Pressure gauges',
    matchCategories: ['PRESSURE_GAUGE'],
    matchMmrSubs:    ['PRESSURE_GAUGES'],
  },
  {
    value: 'VACUUM_GAUGES',
    label: 'Vacuum gauges',
    matchCategories: ['VACUUM_GAUGE'],
    matchMmrSubs:    ['VACUUM_GAUGES'],
  },
  {
    value: 'METROLOGY_INSTRUMENTS',
    label: 'Metrology instruments',
    matchCategories: ['METROLOGY_INSTRUMENT'],
    matchMmrSubs:    ['METROLOGY_INSTRUMENTS'],
  },
  {
    value: 'LAB_TESTING_EQUIPMENT',
    label: 'Mechanical & chemical lab testing equipment',
    matchCategories: ['TESTING_EQUIPMENT'],
    matchMmrSubs:    ['LAB_TESTING_EQUIPMENT'],
  },
  {
    value: 'AUTOCLAVE_OVEN_THERMOCOUPLES',
    label: 'Autoclave, Oven, Thermocouples',
    matchCategories: [],
    matchMmrSubs:    ['AUTOCLAVE_OVEN_THERMOCOUPLES'],
  },
  {
    value: 'EOT_CRANES_CHAIN_BLOCKS',
    label: 'EOT cranes, Chain block pulleys',
    matchCategories: [],
    matchMmrSubs:    ['EOT_CRANES_CHAIN_BLOCKS'],
  },
  {
    value: 'WEIGHING_BALANCES',
    label: 'Weighing balances',
    matchCategories: ['WEIGHING_BALANCE'],
    matchMmrSubs:    ['WEIGHING_BALANCES'],
  },
  {
    value: 'NDT',
    label: 'NDT',
    matchCategories: [],
    matchMmrSubs:    ['NDT'],
  },
  {
    value: 'OTHER',
    label: 'Other equipment',
    matchCategories: [],
    matchMmrSubs:    ['OTHER'],
  },
];

export default function Metrology() {
  return (
    <CalibrationList
      title="Measuring and Monitoring Resources"
      defaultName=""
      unifiedCategories={UNIFIED_CATEGORIES}
      hideBack
    />
  );
}
