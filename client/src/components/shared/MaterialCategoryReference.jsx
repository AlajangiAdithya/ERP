import { useState } from 'react';
import { ChevronDown, ChevronRight, ListOrdered } from 'lucide-react';
import useMaterialCategories from '../../hooks/useMaterialCategories';
import { formatMaterialCode } from '../../utils/materialTypes';

// ─── Material category & code register ───
// The company's material-code list: which block of codes belongs to which
// material type, and what goes in it. Shown wherever someone has to pick a
// Material Type — on the requisition form and on the master-data screens — so the
// category is chosen from the register rather than from memory.
//
// `highlight` outlines the row of the category currently selected.
// Collapsed by default: it is a lookup, not something to read every time.
export default function MaterialCategoryReference({ highlight = '', defaultOpen = false, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  const { categories } = useMaterialCategories();

  const ranged = categories.filter((c) => c.from);
  const others = categories.filter((c) => !c.from);

  // Rows the register leaves unassigned (e.g. 0801–1000) are shown as reserved
  // rather than silently skipped — the printed list has them too.
  const rows = [];
  ranged.forEach((cat, i) => {
    const prev = ranged[i - 1];
    if (prev && cat.from > prev.to + 1) {
      rows.push({ gap: true, from: prev.to + 1, to: cat.from - 1 });
    }
    rows.push(cat);
  });
  others.forEach((cat) => rows.push(cat));

  return (
    <div className={`rounded border border-gray-200 bg-white ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold text-navy-900 hover:bg-gray-50"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <ListOrdered size={13} className="text-navy-700" />
        <span>Material categories &amp; code list</span>
        <span className="font-normal text-gray-500">
          — which material type covers what, and the codes reserved for it
        </span>
      </button>

      {open && (
        <div className="max-h-80 overflow-auto border-t border-gray-200">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-gray-100">
              <tr>
                <th className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-700" style={{ width: '110px' }}>Material Code</th>
                <th className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-700" style={{ width: '210px' }}>Material Type</th>
                <th className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">Material Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.gap) {
                  return (
                    <tr key={`gap-${row.from}`} className="bg-gray-50 text-gray-400">
                      <td className="border border-gray-200 px-2 py-1 font-mono">
                        {formatMaterialCode(row.from)}–{formatMaterialCode(row.to)}
                      </td>
                      <td className="border border-gray-200 px-2 py-1 italic" colSpan={2}>Reserved — not allotted yet</td>
                    </tr>
                  );
                }
                const isCurrent = !!highlight && row.label === highlight;
                return (
                  <tr key={row.label} className={isCurrent ? 'bg-navy-50 font-semibold text-navy-900' : 'text-gray-700'}>
                    <td className="border border-gray-200 px-2 py-1 font-mono whitespace-nowrap">
                      {row.from ? `${formatMaterialCode(row.from)}–${formatMaterialCode(row.to)}` : '—'}
                    </td>
                    <td className="border border-gray-200 px-2 py-1">{row.label}</td>
                    <td className="border border-gray-200 px-2 py-1">{row.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
