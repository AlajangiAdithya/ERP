import { useState } from 'react';
import {
  Info, ChevronDown, ClipboardList, ShieldCheck, Truck, CheckCircle, PackageCheck,
  CheckSquare, PackagePlus, Eye, Building2,
} from 'lucide-react';
import Card from '../ui/Card';

// ─── "How your MIV works" - one panel, written per audience ───
//
// A MIV takes a different route depending on who is looking at it, and the two
// that diverge most are an on-site unit (store issues from stock) and an offsite
// site (Admin approves, material travels out on a gate pass). People kept hunting
// for buttons their role will never see, so each audience gets the flow written
// from their own side, in their own words.
//
// The store's two guides live on the clearance page itself, because they carry
// live counts of what is waiting at each step.

const TONE = {
  navy:   'bg-navy-50 text-navy-700 ring-navy-100',
  blue:   'bg-blue-50 text-blue-700 ring-blue-100',
  amber:  'bg-amber-50 text-amber-700 ring-amber-100',
  green:  'bg-green-50 text-green-700 ring-green-100',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  gray:   'bg-gray-50 text-gray-600 ring-gray-200',
};

// Offsite unit - material cannot be walked over from the central store, so it is
// dispatched on a non-returnable gate pass and the site acknowledges receipt.
const OFFSITE_UNIT = {
  title: 'How your MIV works (offsite unit)',
  subtitle: 'Your material is dispatched out on a gate pass - here is the full flow.',
  steps: [
    { icon: ClipboardList, tone: 'navy', title: '1. You raise the MIV', body: 'Click “New Request”, add the items and quantities your site needs, and submit. Your MIV starts as PENDING.' },
    { icon: ShieldCheck, tone: 'blue', title: '2. Admin approves it', body: 'Because you are an offsite unit, your MIV goes to the Admin (not the central store) for approval. Admin may adjust quantities before approving. It then becomes APPROVED.' },
    { icon: Truck, tone: 'amber', title: '3. Central store dispatches the material', body: 'The store sends your material out on a non-returnable gate pass. A large order may arrive across several gate passes, so your MIV can sit at PARTIAL until everything has been sent.' },
    { icon: CheckCircle, tone: 'green', title: '4. You acknowledge receipt', body: 'When a gate pass reaches your site, open “Incoming Material - Gate Passes” below and click Acknowledge for each one. This confirms your unit received the goods and closes that gate pass.' },
    { icon: PackageCheck, tone: 'indigo', title: '5. The MIV closes', body: 'Once every line has been dispatched and acknowledged, your MIV is marked COLLECTED. Nothing comes back - these are non-returnable dispatches.' },
  ],
};

// On-site unit / department requester - the everyday path.
const REQUESTER = {
  title: 'How your MIV works',
  subtitle: 'Raise it, the store issues from stock, you collect.',
  steps: [
    { icon: ClipboardList, tone: 'navy', title: '1. You raise the MIV', body: 'Click “New Request”, add the items and quantities you need, and submit. It goes straight to the central store - no approval step in between. Your MIV starts as PENDING.' },
    { icon: CheckSquare, tone: 'green', title: '2. The store issues it', body: 'Stores accepts and issues whatever is in stock at that moment. Batch numbers and an Issue No are filled in automatically and the stock is reduced there and then.' },
    { icon: PackagePlus, tone: 'amber', title: '3. Short lines wait', body: 'Anything the store could not cover stays pending and your MIV shows PARTIAL. You do not raise a new request - the store tops it up from their Partial tab when the material arrives.' },
    { icon: PackageCheck, tone: 'indigo', title: '4. You collect it', body: 'Collect the material from the store against the Issue No. Once every line is issued the MIV reads COLLECTED. If the store rejects it, the reason comes back to you.' },
  ],
};

// Admin - the only role that approves an offsite MIV.
const ADMIN = {
  title: 'How MIVs work (what Admin does)',
  subtitle: 'You are the approval step for offsite sites - on-site MIVs never reach you.',
  steps: [
    { icon: Building2, tone: 'amber', title: 'Offsite MIVs need you', body: 'A MIV from an offsite site (ANSP, Adibatla, ASL, CPDC, IBRPTM, RCI) cannot be issued over the counter, so it comes to you instead of the store. Open it here and approve - you can change the quantity on any line before you do, or reject it with a reason.' },
    { icon: Truck, tone: 'blue', title: 'Then the store takes over', body: 'Once you approve, Stores converts it into a non-returnable gate pass and sends the material out. Nothing further is needed from you - if it sits unapproved, the system will keep reminding you daily.' },
    { icon: CheckSquare, tone: 'green', title: 'On-site MIVs bypass you', body: 'A MIV from an on-site unit goes straight to the store, which issues it from stock. You see it here for oversight only.' },
    { icon: PackageCheck, tone: 'indigo', title: 'How they close', body: 'An on-site MIV closes when the store has issued every line. An offsite MIV closes when every line has been dispatched AND the receiving site has acknowledged each gate pass. Until then it reads PARTIAL.' },
    { icon: ClipboardList, tone: 'navy', title: 'Your own MIVs', body: 'You can raise MIVs for yourself from My Requests; they follow the ordinary store-issue path like any other department.' },
  ],
};

// Accounts / Finance / Planning - department requesters with org-wide visibility.
const OVERSIGHT = {
  title: 'How MIVs work (your department)',
  subtitle: 'You raise your own, and you can see everyone else’s.',
  steps: [
    { icon: ClipboardList, tone: 'navy', title: '1. You raise your own MIV', body: 'Use “New Request” for material your department needs - stationery, consumables and the like. You do not belong to a production unit, so your MIV draws from your department’s reserved stock plus the unassigned pool.' },
    { icon: CheckSquare, tone: 'green', title: '2. The store issues it', body: 'It goes straight to the central store, which issues whatever is in stock. Batch numbers and an Issue No are filled in automatically.' },
    { icon: PackagePlus, tone: 'amber', title: '3. Short lines wait', body: 'An uncovered line keeps the MIV at PARTIAL until the store tops it up. Nothing for you to re-raise.' },
    { icon: Eye, tone: 'gray', title: 'Watching the rest', body: 'All MIV Requests shows every MIV in the organisation, whichever unit raised it - read-only. You can act only on the ones you raised yourself.' },
  ],
};

// Logistics - a requester like any department, plus they move the vehicles.
const LOGISTICS = {
  title: 'How MIVs work (Logistics)',
  subtitle: 'You raise your own MIVs, and you carry the offsite ones.',
  steps: [
    { icon: ClipboardList, tone: 'navy', title: '1. Your own MIV', body: 'Raise one from “New Request” for material your team needs. It goes straight to the central store and is issued from stock, like any other department.' },
    { icon: CheckSquare, tone: 'green', title: '2. The store issues it', body: 'Stores issues whatever is available; anything short keeps the MIV at PARTIAL until they top it up.' },
    { icon: Truck, tone: 'amber', title: 'Offsite material you carry', body: 'Material for an offsite site travels on a non-returnable gate pass that Stores raises from the approved MIV. The vehicle and driver go on the gate pass, and it moves to IN TRANSIT when it leaves.' },
    { icon: CheckCircle, tone: 'blue', title: 'Arrival closes it', body: 'The receiving site acknowledges the gate pass when the load lands. That closes the pass, and once every pass for the MIV is acknowledged the MIV itself closes.' },
  ],
};

const AUDIENCES = { OFFSITE_UNIT, REQUESTER, ADMIN, OVERSIGHT, LOGISTICS };

// Which flow applies to this user. `context` nudges a role that has more than one
// relationship with MIVs: Admin on the oversight screen gets the approval guide,
// Admin on My Requests gets the ordinary requester one.
export function mivAudienceFor(user, context = 'OWN') {
  const role = user?.role;
  if (context === 'OVERSIGHT') {
    if (role === 'ADMIN') return 'ADMIN';
    return 'OVERSIGHT';
  }
  if (user?.unit?.isOffsite) return 'OFFSITE_UNIT';
  if (role === 'LOGISTICS') return 'LOGISTICS';
  if (['ACCOUNTING', 'FINANCE', 'PLANNING'].includes(role)) return 'OVERSIGHT';
  return 'REQUESTER';
}

export default function MivWorkflowGuide({ audience = 'REQUESTER', defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const spec = AUDIENCES[audience] || REQUESTER;

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
            <h3 className="text-sm font-semibold text-navy-800">{spec.title}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{spec.subtitle}</p>
          </div>
        </div>
        <ChevronDown size={18} className={`text-navy-600 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ol className="mt-4 space-y-3">
          {spec.steps.map((s) => (
            <li key={s.title} className="flex items-start gap-3">
              <div className={`p-1.5 rounded-lg ring-1 flex-shrink-0 ${TONE[s.tone] || TONE.navy}`}>
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
