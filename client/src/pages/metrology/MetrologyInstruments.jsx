import CalibrationList from './CalibrationList';

export default function MetrologyInstruments() {
  return (
    <CalibrationList
      category="METROLOGY_INSTRUMENT"
      title="Metrology Instruments"
      defaultName=""
      fields={{ operatingRange: true, leastCount: true, capacity: false, usedFor: false }}
    />
  );
}
