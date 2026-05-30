import CalibrationList from './CalibrationList';

export default function TestingEquipment() {
  return (
    <CalibrationList
      category="TESTING_EQUIPMENT"
      title="Testing Equipment"
      defaultName=""
      fields={{ operatingRange: false, leastCount: false, capacity: false, usedFor: true }}
    />
  );
}
