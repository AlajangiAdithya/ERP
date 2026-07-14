// ────────────────────────────────────────────────────────────────
// Turnaround-time (TAT) status.
//
// Every pending task (PR acceptance, PO creation, unit acceptance, …) has a
// "pending since" timestamp. This computes an ageing level so lists can flag
// slow items at a glance:
//   • ok     — within the warn window (default < 24h)
//   • warn   — over the warn window (yellow, default ≥ 24h)
//   • breach — over the breach window (red, default ≥ 48h)
//   • none   — no timestamp / not applicable
//
// Thresholds match the 48h SLA already enforced on the delay-remark fields.
// ────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

/**
 * @param {string|Date|null|undefined} since  when the task started pending
 * @param {{ warnHours?: number, breachHours?: number, now?: number }} [opts]
 * @returns {{ level: 'none'|'ok'|'warn'|'breach', hours: number|null, warnHours: number, breachHours: number }}
 */
export function tatStatus(since, opts = {}) {
  const { warnHours = 24, breachHours = 48, now = Date.now() } = opts;
  if (!since) return { level: 'none', hours: null, warnHours, breachHours };
  const start = since instanceof Date ? since.getTime() : new Date(since).getTime();
  if (Number.isNaN(start)) return { level: 'none', hours: null, warnHours, breachHours };
  const hours = (now - start) / HOUR_MS;
  let level = 'ok';
  if (hours >= breachHours) level = 'breach';
  else if (hours >= warnHours) level = 'warn';
  return { level, hours, warnHours, breachHours };
}

// Row background tint for a table row (subtle, keeps text readable).
export function tatRowClass(level) {
  if (level === 'breach') return 'bg-red-50 hover:bg-red-100/70';
  if (level === 'warn') return 'bg-yellow-50 hover:bg-yellow-100/70';
  return '';
}

// Badge (pill) colour + dot classes for a given level.
export const tatBadgeClass = {
  breach: 'bg-red-100 text-red-800 ring-red-300',
  warn: 'bg-yellow-100 text-yellow-800 ring-yellow-300',
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  none: 'bg-gray-50 text-gray-500 ring-gray-200',
};

// Human-friendly elapsed label: "3h", "1d 4h", "18h".
export function formatElapsed(hours) {
  if (hours == null) return '';
  const h = Math.max(0, Math.floor(hours));
  if (h < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins}m`;
  }
  if (h < 48) return `${h}h`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}
