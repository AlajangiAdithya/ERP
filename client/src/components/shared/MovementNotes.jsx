import { Layers } from 'lucide-react';

// Renders a stock-movement note as structured chips instead of one truncated
// string. Handles the three note shapes the server writes:
//   1. JSON (Excel import) — keys like mirNo, ionNo, docNo, supplier, vehicle…
//   2. Free text with document refs — "Collected by X for Unit (RAPS/MIV/25-26/4) [FIFO: B1×2]"
//   3. Plain user-typed text (inward entries).
const REF_RE = /RAPS\/[A-Z]{2,6}\/\d{2}-\d{2}\/\d+/g;
const FIFO_RE = /\[FIFO:\s*([^\]]*)\]/;

function RefChip({ children }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-200/70 font-mono text-[10px] font-semibold whitespace-nowrap">
      {children}
    </span>
  );
}

function InfoChip({ label, children }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200 text-[10px] whitespace-nowrap">
      {label && <span className="uppercase tracking-wide text-gray-400 font-semibold">{label}</span>}
      <span className="font-medium text-gray-700">{children}</span>
    </span>
  );
}

function BatchLine({ children }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-700/90">
      <Layers size={10} className="flex-shrink-0" />
      <span className="font-mono">{children}</span>
    </span>
  );
}

// JSON value may already be a full "RAPS/MIR/25-26/7" — render it as a ref
// chip on its own; otherwise label it.
const jsonChip = (key, label, value) =>
  String(value).startsWith('RAPS/')
    ? <RefChip key={key}>{value}</RefChip>
    : <InfoChip key={key} label={label}>{value}</InfoChip>;

export default function MovementNotes({ notes }) {
  if (!notes) return <span className="text-gray-300">—</span>;

  let obj = null;
  try { obj = JSON.parse(notes); } catch { /* free text */ }

  if (obj && typeof obj === 'object') {
    const chips = [];
    if (obj.mirNo) chips.push(jsonChip('mir', 'MIR', obj.mirNo));
    if (obj.ionNo) chips.push(jsonChip('ion', 'ION', obj.ionNo));
    if (obj.docNo) chips.push(jsonChip('doc', obj.docType || 'Doc', obj.docNo));
    if (obj.poRef) chips.push(jsonChip('po', 'PO', obj.poRef));
    if (obj.supplier) chips.push(<InfoChip key="sup" label="Supplier">{obj.supplier}</InfoChip>);
    if (obj.company) chips.push(<InfoChip key="co" label="Company">{obj.company}</InfoChip>);
    if (obj.vehicle) chips.push(<InfoChip key="veh" label="Vehicle">{obj.vehicle}</InfoChip>);
    if (obj.unit) chips.push(<InfoChip key="unit" label="Unit">{obj.unit}</InfoChip>);
    if (obj.matType) chips.push(<InfoChip key="mat" label="Material">{obj.matType}</InfoChip>);
    if (obj.inspection?.status) chips.push(<InfoChip key="qc" label="QC">{obj.inspection.status}</InfoChip>);
    if (obj.issueDetails) chips.push(<InfoChip key="iss" label="Issued to">{obj.issueDetails}</InfoChip>);
    const text = obj.remarks || obj.notes;
    if (chips.length === 0 && !text) return <span className="text-xs text-gray-500 break-words">{notes}</span>;
    return (
      <div className="flex flex-col gap-1 min-w-[160px] max-w-sm">
        {chips.length > 0 && <div className="flex flex-wrap gap-1">{chips}</div>}
        {text && <p className="text-[11px] text-gray-500 leading-snug whitespace-normal break-words">{text}</p>}
      </div>
    );
  }

  // Free text: pull out document refs and the FIFO batch trail, keep the rest readable.
  const refs = notes.match(REF_RE) || [];
  const fifo = notes.match(FIFO_RE)?.[1]?.trim();
  const text = notes
    .replace(FIFO_RE, '')
    .replace(REF_RE, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[·•,;\s]+$/, '')
    .trim();

  if (refs.length === 0 && !fifo) {
    return <span className="text-xs text-gray-500 whitespace-normal break-words leading-snug">{notes}</span>;
  }

  return (
    <div className="flex flex-col gap-1 min-w-[160px] max-w-sm">
      {text && <p className="text-[11px] text-gray-600 leading-snug whitespace-normal break-words">{text}</p>}
      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {refs.map((r, i) => <RefChip key={`${r}-${i}`}>{r}</RefChip>)}
        </div>
      )}
      {fifo && fifo !== 'none' && <BatchLine>{fifo}</BatchLine>}
    </div>
  );
}
