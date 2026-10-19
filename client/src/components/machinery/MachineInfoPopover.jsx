import { useEffect, useRef, useState } from 'react';
import { Info, X, Paperclip, AlertTriangle } from 'lucide-react';
import { formatDate } from '../../utils/formatters';

// The small "i" next to a machine. Shows that machine's master record plus the
// two live numbers people actually open it for - hours run this month and when
// it last ran. Everything here is read-only; editing lives in Machine Master.

const amcColor = (status, expiry) => {
  const expired = expiry && new Date(expiry).getTime() < Date.now();
  if (expired) return 'text-red-700 bg-red-50 ring-red-200';
  if ((status || '').toUpperCase() === 'ACTIVE') return 'text-green-700 bg-green-50 ring-green-200';
  if ((status || '').toUpperCase() === 'EXPIRED') return 'text-red-700 bg-red-50 ring-red-200';
  return 'text-gray-600 bg-gray-50 ring-gray-200';
};

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm text-navy-800 break-words">{children ?? <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

export default function MachineInfoPopover({ machine, stats }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  // Close on outside click and on Escape. Escape also returns focus to the
  // trigger so keyboard users are not dumped at the top of the page.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!machine) return null;

  const expired = machine.amcExpiry && new Date(machine.amcExpiry).getTime() < Date.now();

  return (
    <div className="relative inline-flex" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Machine details for ${machine.name}`}
        aria-expanded={open}
        title="Machine details"
        className="inline-flex items-center justify-center w-9 h-9 rounded-full text-navy-600
          hover:bg-navy-100/70 hover:text-navy-800 transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <Info size={17} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${machine.name} details`}
          className="absolute left-0 top-full z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)]
            rounded-xl border border-navy-100 bg-white p-4 shadow-xl ring-1 ring-navy-900/5"
        >
          <div className="flex items-start justify-between gap-3 border-b border-navy-100 pb-2.5">
            <div className="min-w-0">
              <p className="text-sm font-bold text-navy-800 break-words">{machine.name}</p>
              <p className="font-mono text-[11px] text-gray-500 break-all">{machine.rapsId}</p>
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); btnRef.current?.focus(); }}
              aria-label="Close details"
              className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg text-gray-400
                hover:bg-navy-50 hover:text-navy-700 transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <X size={15} />
            </button>
          </div>

          {stats && (
            <div className="grid grid-cols-2 gap-2 border-b border-navy-100 py-3">
              <div className="rounded-lg bg-navy-50/70 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-500">Hours this month</p>
                <p className="text-lg font-bold tabular-nums text-navy-800">{stats.hours ?? 0}</p>
              </div>
              <div className="rounded-lg bg-navy-50/70 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-navy-500">Days run</p>
                <p className="text-lg font-bold tabular-nums text-navy-800">{stats.daysRun ?? 0}</p>
              </div>
            </div>
          )}

          <dl className="divide-y divide-navy-50 pt-1">
            <Row label="Unit">{machine.unit?.name || machine.place}</Row>
            <Row label="Place">{machine.place}</Row>
            <Row label="Capacity / Size">{machine.capacity}</Row>
            <Row label="Make & Model">{machine.makeModel}</Row>
            <Row label="Serial No">{machine.machineSerialNo}</Row>
            <Row label="AMC">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${amcColor(machine.amcStatus, machine.amcExpiry)}`}>
                {expired && <AlertTriangle size={12} />}
                {machine.amcStatus || 'NA'}
                {machine.amcExpiry && <span className="font-normal">· {formatDate(machine.amcExpiry)}</span>}
              </span>
            </Row>
            <Row label="AMC Vendor">{machine.amcVendor}</Row>
            {machine.amcAttachment && (
              <Row label="AMC Document">
                <a
                  href={machine.amcAttachment}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  <Paperclip size={13} /> Open document
                </a>
              </Row>
            )}
            <Row label="Remarks">{machine.remarks}</Row>
          </dl>
        </div>
      )}
    </div>
  );
}
