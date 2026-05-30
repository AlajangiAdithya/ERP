import CalibrationList from './CalibrationList';

export default function PressureGauges() {
  return (
    <CalibrationList
      category="PRESSURE_GAUGE"
      title="Pressure Gauges"
      defaultName="Pressure Gauge"
      fields={{ operatingRange: true, usedFor: true, leastCount: false, capacity: false }}
    />
  );
}
