import CalibrationList from './CalibrationList';

// Universal sub-category buckets the client uses to slice the MMR register
// (Pressure gauges, vacuum gauges, metrology instruments, lab testing,
// autoclave/oven/thermocouples, EOT cranes/chain blocks, other).
const MMR_SUB_OPTIONS = [
  { value: 'PRESSURE_GAUGES',              label: 'Pressure gauges' },
  { value: 'VACUUM_GAUGES',                label: 'Vacuum gauges' },
  { value: 'METROLOGY_INSTRUMENTS',        label: 'Metrology instruments' },
  { value: 'LAB_TESTING_EQUIPMENT',        label: 'Mechanical & chemical lab testing equipment' },
  { value: 'AUTOCLAVE_OVEN_THERMOCOUPLES', label: 'Autoclave, Oven, Thermocouples' },
  { value: 'EOT_CRANES_CHAIN_BLOCKS',      label: 'EOT cranes, Chain block pulleys' },
  { value: 'OTHER',                        label: 'Other equipment' },
];

export default function MMR() {
  return (
    <CalibrationList
      category="MMR"
      title="Monitoring & Measuring Resources"
      defaultName=""
      fields={{ operatingRange: true, leastCount: false, capacity: false, usedFor: true }}
      mmrSubOptions={MMR_SUB_OPTIONS}
    />
  );
}
