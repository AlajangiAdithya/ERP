import CalibrationList from './CalibrationList';

export default function MMR() {
  return (
    <CalibrationList
      category="MMR"
      title="Monitoring & Measuring Resources"
      defaultName=""
      fields={{ operatingRange: true, leastCount: false, capacity: false, usedFor: true }}
    />
  );
}
