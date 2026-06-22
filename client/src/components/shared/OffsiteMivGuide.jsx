import { useState } from 'react';
import {
  Info, ChevronDown, ClipboardList, ShieldCheck, Truck, CheckCircle, PackageCheck,
} from 'lucide-react';
import Card from '../ui/Card';

// Explainer shown ONLY to offsite units (ANSP/Adibatla, ASL, CPDC, IBRPTM, …).
// Their MIV runs a different path from on-site units: material can't be walked
// over from the central store, so it is dispatched out on a non-returnable gate
// pass and the unit acknowledges receipt. This panel walks the offsite team
// through each step so they know what to expect and what they must do.
const STEPS = [
  {
    icon: ClipboardList,
    tone: 'bg-navy-50 text-navy-700 ring-navy-100',
    title: '1. You raise the MIV',
    body: 'Click “New Request”, add the items and quantities your site needs, and submit. Your MIV starts as PENDING.',
  },
  {
    icon: ShieldCheck,
    tone: 'bg-blue-50 text-blue-700 ring-blue-100',
    title: '2. Admin approves it',
    body: 'Because you are an offsite unit, your MIV goes to the Admin (not the central store) for approval. Admin may adjust quantities before approving. It then becomes APPROVED.',
  },
  {
    icon: Truck,
    tone: 'bg-amber-50 text-amber-700 ring-amber-100',
    title: '3. Central store dispatches the material',
    body: 'The store sends your material out on a non-returnable gate pass. A large order may arrive across several gate passes, so your MIV can sit at PARTIAL until everything has been sent.',
  },
  {
    icon: CheckCircle,
    tone: 'bg-green-50 text-green-700 ring-green-100',
    title: '4. You acknowledge receipt',
    body: 'When a gate pass reaches your site, open “Incoming Material — Gate Passes” below and click Acknowledge for each one. This confirms your unit received the goods and closes that gate pass.',
  },
  {
    icon: PackageCheck,
    tone: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    title: '5. The MIV closes',
    body: 'Once every line has been dispatched and acknowledged, your MIV is marked COLLECTED. Nothing comes back — these are non-returnable dispatches.',
  },
];

export default function OffsiteMivGuide({ defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="border-l-4 border-l-navy-600 bg-navy-50/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg ring-1 bg-navy-50 text-navy-700 ring-navy-100 flex-shrink-0">
            <Info size={16} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-800">
              How your MIV works (offsite unit)
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Your material is dispatched out on a gate pass — here is the full flow.
            </p>
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`text-navy-600 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ol className="mt-4 space-y-3">
          {STEPS.map((s) => (
            <li key={s.title} className="flex items-start gap-3">
              <div className={`p-1.5 rounded-lg ring-1 flex-shrink-0 ${s.tone}`}>
                <s.icon size={15} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-gray-800">{s.title}</p>
                <p className="text-[12px] text-gray-600 leading-relaxed mt-0.5">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
