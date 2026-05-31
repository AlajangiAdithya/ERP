import CalibrationList from './metrology/CalibrationList';

// Single unified register for every calibrated instrument. Replaces the old
// 6-card hub — everything lives on this page now, filterable by the seven
// categories the client tracks (matches MMR sub-categories on the server).
const MMR_SUB_OPTIONS = [
  { value: 'PRESSURE_GAUGES',              label: 'Pressure gauges' },
  { value: 'VACUUM_GAUGES',                label: 'Vacuum gauges' },
  { value: 'METROLOGY_INSTRUMENTS',        label: 'Metrology instruments' },
  { value: 'LAB_TESTING_EQUIPMENT',        label: 'Mechanical & chemical lab testing equipment' },
  { value: 'AUTOCLAVE_OVEN_THERMOCOUPLES', label: 'Autoclave, Oven, Thermocouples' },
  { value: 'EOT_CRANES_CHAIN_BLOCKS',      label: 'EOT cranes, Chain block pulleys' },
  { value: 'OTHER',                        label: 'Other equipment' },
];

export default function Metrology() {
  return (
    <CalibrationList
      category="MMR"
      title="Metrology & Calibration"
      defaultName=""
      fields={{ operatingRange: true, leastCount: false, capacity: false, usedFor: true }}
      mmrSubOptions={MMR_SUB_OPTIONS}
      hideBack
    />
  );
}
