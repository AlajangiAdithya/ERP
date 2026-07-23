// ────────────────────────────────────────────────────────────────
// 48-hour action SLA.
//
// Every pending approval / action across the system has one rule: it should be
// completed within 48 hours of becoming pending. If it takes longer, whoever
// actions it MUST record a genuine delay remark explaining why. The remark is
// validated (see reasonValidation) so placeholder / gibberish text is rejected.
//
// This module is the single source of truth for that window so PR, PO, Work
// Order and Gate Pass flows all behave identically.
// ────────────────────────────────────────────────────────────────

import { reasonError } from './reasonValidation';

export const SLA_HOURS = 48;
export const SLA_MS = SLA_HOURS * 60 * 60 * 1000;

// True once more than 48h have elapsed since `since`.
export function isPastSla(since) {
  if (!since) return false;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > SLA_MS;
}

/**
 * Gate state for a pending action's delay remark.
 * @param {string|Date|null} since  when the task became pending
 * @param {string} value            current remark text
 * @returns {{ isDelayed: boolean, error: string, blocked: boolean }}
 *   isDelayed — past the 48h window (remark is required)
 *   error     — validation message for the remark (empty when valid / not needed)
 *   blocked   — true when the action must be blocked (overdue + missing/invalid remark)
 */
export function slaRemarkState(since, value) {
  const isDelayed = isPastSla(since);
  const error = isDelayed ? reasonError(value, { fieldLabel: 'delay remark' }) : '';
  const blocked = isDelayed && (!String(value || '').trim() || !!error);
  return { isDelayed, error, blocked };
}
