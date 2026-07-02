import { useState } from 'react';
import { Wrench, CalendarRange, Gauge } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import { useAuth } from '../context/AuthContext';
import MachineryRegister from './MachineryRegister';
import AllocationBoard from '../components/machinery/AllocationBoard';
import MachineKpiPanel from '../components/machinery/MachineKpiPanel';

// Machinery hub — tabbed page (mirrors the procurement-style single page):
//   • Allocation — daily occupation timeline; unit managers schedule WO/ION work
//   • Register   — machine master list + AMC (everyone views; Safety/Unit-5 edit)
//   • Monthly KPI — utilisation KPI + auto per-machine monthly report
// Allocation + KPI tabs are for unit managers and oversight roles; Lab/Metrology/
// NDT and other requester roles only see the Register.
const ALLOCATION_ROLES = ['MANAGER', 'ADMIN', 'PLANNING', 'SUPERADMIN', 'SAFETY'];

export default function Machinery() {
  const { user } = useAuth();
  const showAllocation = ALLOCATION_ROLES.includes(user?.role);
  // Default to Allocation for those who have it; requester roles land on Register.
  const [tab, setTab] = useState(showAllocation ? 'allocation' : 'register');

  const tabs = [
    ...(showAllocation ? [
      { key: 'allocation', label: 'Allocation', icon: CalendarRange },
    ] : []),
    { key: 'register', label: 'Register', icon: Wrench },
    ...(showAllocation ? [
      { key: 'kpi', label: 'Monthly KPI & Reports', icon: Gauge },
    ] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHero
        title="Machinery"
        eyebrow="Safety / HSE · Production"
        subtitle="Machine register, daily allocation timeline, and monthly utilisation KPIs."
        icon={Wrench}
      />

      <div className="flex gap-1 border-b border-navy-100">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active ? 'border-navy-700 text-navy-800' : 'border-transparent text-gray-500 hover:text-navy-700'
              }`}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'allocation' && showAllocation && <AllocationBoard />}
      {tab === 'register' && <MachineryRegister embedded />}
      {tab === 'kpi' && showAllocation && <MachineKpiPanel />}
    </div>
  );
}
