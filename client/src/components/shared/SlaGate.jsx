import { Clock, AlertTriangle } from 'lucide-react';
import { Textarea } from '../ui/Input';
import { SLA_HOURS } from '../../utils/sla';

// ────────────────────────────────────────────────────────────────
// Reusable 48-hour SLA UI, shared by every gated action (PR / PO / Work
// Order / Gate Pass) so the rule is stated the same way everywhere.
//
//   <SlaNotice action="Placing this order" />          ← always visible, states the rule up-front
//   <SlaDelayRemark isDelayed={...} value={...} .../>   ← appears only once past 48h, required
// ────────────────────────────────────────────────────────────────

// Always-on hint so users know the 48h rule before they are late.
export function SlaNotice({ action = 'This step', className = '' }) {
  return (
    <div className={`flex items-start gap-1.5 rounded-lg bg-navy-50 border border-navy-200 px-3 py-2 text-xs text-navy-700 ${className}`}>
      <Clock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        <b>{SLA_HOURS}-hour action window.</b> {action} should be completed within {SLA_HOURS} hours of
        becoming pending. If it takes longer, a delay remark explaining why is mandatory before you can proceed.
      </span>
    </div>
  );
}

// Overdue banner + required, validated delay-remark field. Renders nothing until
// the 48h window is exceeded. `error` comes from slaRemarkState(...).error.
export function SlaDelayRemark({ isDelayed, value, onChange, error, action = 'this step', className = '' }) {
  if (!isDelayed) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
        <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
        <span>
          <span className="font-bold">SLA overdue</span> — {action} has taken more than {SLA_HOURS} hours.
          A delay remark is required.
        </span>
      </div>
      <Textarea
        label={`Delay remark * (required — ${SLA_HOURS}h SLA exceeded)`}
        rows={2}
        value={value}
        onChange={onChange}
        placeholder={`Explain why ${action.toLowerCase()} was delayed beyond ${SLA_HOURS} hours…`}
        error={error || undefined}
      />
    </div>
  );
}
