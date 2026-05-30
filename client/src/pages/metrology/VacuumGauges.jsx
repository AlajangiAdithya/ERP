import CalibrationList from './CalibrationList';

export default function VacuumGauges() {
  return (
    <CalibrationList
      category="VACUUM_GAUGE"
      title="Vacuum Gauges"
      defaultName="Vacuum Gauge"
      fields={{ operatingRange: true, usedFor: true, leastCount: false, capacity: false }}
    />
  );
}
