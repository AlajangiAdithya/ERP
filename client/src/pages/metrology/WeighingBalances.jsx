import CalibrationList from './CalibrationList';

export default function WeighingBalances() {
  return (
    <CalibrationList
      category="WEIGHING_BALANCE"
      title="Weighing Balances"
      defaultName="Weighing Balance"
      fields={{ capacity: true, leastCount: true, operatingRange: false, usedFor: false }}
    />
  );
}
