import { useState } from 'react';
import { Wrench, ClipboardList, Gauge } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import MachineryRegister from './MachineryRegister';
import MachineKpiPanel from '../components/machinery/MachineKpiPanel';
import WorkStatusBoard from '../components/machinery/WorkStatusBoard';

// Machinery hub.
//
//   • Work Status    - THE page. The monthly per-machine ON/OFF sheet, a copy of
//                      "WORKING MACHINE STATUS FILE.xlsx", plus monthly and
//                      year-by-month stats. Drills unit → machine → sheet.
//   • Machine Master - the register + AMC. Kept because it is the only place a
//                      machine can be added or its AMC tracked, and Work Status
//                      reads its machine list straight from there - add a
//                      machine and it appears in the sheet with no code change.
//   • Monthly KPI    - utilisation KPI off the allocation timeline.
//
// Everyone sees every unit. Only a unit's own people (plus SAFETY / ADMIN /
// SUPERADMIN) can write to its sheets, enforced per row server-side in
// machineWorkStatus.routes.js.
//
// The old Allocation board is no longer surfaced here. Its model and routes are
// untouched and the Monthly KPI tab still reads from them.
export default function Machinery() {
  const [tab, setTab] = useState('status');

  const tabs = [
    { key: 'status', label: 'Work Status', icon: ClipboardList },
    { key: 'register', label: 'Machine Master', icon: Wrench },
    { key: 'kpi', label: 'Monthly KPI & Reports', icon: Gauge },
  ];

  return (
    <div className="space-y-5">
      <PageHero
        title="Machinery"
        eyebrow="Safety / HSE · Production"
        subtitle="Daily machine work status by unit, with monthly hours and a month-by-month year view."
        icon={Wrench}
      />

      <div className="flex gap-1 overflow-x-auto border-b border-navy-100">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium
                transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
                  active ? 'border-navy-700 text-navy-800' : 'border-transparent text-gray-500 hover:text-navy-700'
                }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'status' && <WorkStatusBoard />}
      {tab === 'register' && <MachineryRegister embedded />}
      {tab === 'kpi' && <MachineKpiPanel />}
    </div>
  );
}
