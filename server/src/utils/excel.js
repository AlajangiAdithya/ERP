const ExcelJS = require('exceljs');

// ─── Shared XLSX builder ───
// One place that knows how a RAPS export should look, so every "Export to Excel"
// button in the app produces the same thing: navy header band, frozen header row,
// autofilter, zebra rows, sensible column widths and real typed cells (dates stay
// dates, money stays money) so Excel can sort/filter/sum without any cleanup.

const HEADER_BG = 'FF0F2B46'; // navy-900
const HEADER_FG = 'FFFFFFFF';
const ZEBRA_BG = 'FFF3F5F8';
const BORDER = 'FFD8DEE6';

// Excel formats. Dates are written as real Date cells — the numFmt only decides
// how they are displayed, so the user can still re-format or compute on them.
const FMT = {
  date: 'dd-mmm-yyyy',
  dateTime: 'dd-mmm-yyyy hh:mm',
  money: '#,##0.00',
  qty: '#,##0.###',
  int: '#,##0',
};

// Hard cap on rows pulled for a single export. Guards the server (and Excel)
// against someone exporting a five-year-old database in one click; the caller
// reports the truncation on the "Export Info" sheet.
const EXPORT_ROW_CAP = 5000;

// Excel rejects : \ / ? * [ ] in sheet names and caps them at 31 chars.
const sheetName = (name) => (name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);

// Null-safe stringify for text cells. Cells here are written as typed string
// cells, not formulas, so a user remark starting with "=" or "-" stays inert text
// in Excel — no apostrophe escaping (which would show up as literal data).
const safeText = (v) => (v === null || v === undefined ? '' : String(v));

const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());

// Wraps a Prisma DateTime for a date cell. Null-safe — blank beats "Invalid Date".
const dateCell = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const yesNo = (v) => (v ? 'Yes' : 'No');

// ENUM_VALUE → "Enum Value" for any status/role we have no explicit label for.
const titleCase = (v) =>
  !v ? '' : String(v).toLowerCase().split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * Adds a formatted sheet.
 *
 * columns: [{ header, key, width?, fmt?: 'date'|'dateTime'|'money'|'qty'|'int', wrap?, align? }]
 * rows:    array of plain objects keyed by column.key. Values may be string,
 *          number, Date or null — strings are sanitised against formula injection.
 */
function addSheet(workbook, { name, columns, rows, zebra = true }) {
  const ws = workbook.addWorksheet(sheetName(name), {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || autoWidth(c, rows),
    style: {
      numFmt: c.fmt ? FMT[c.fmt] : undefined,
      alignment: { vertical: 'top', horizontal: c.align || 'left', wrapText: !!c.wrap },
    },
  }));

  for (const row of rows) {
    const cells = {};
    for (const c of columns) {
      const v = row[c.key];
      cells[c.key] = isDate(v) || typeof v === 'number' ? v : safeText(v);
    }
    ws.addRow(cells);
  }

  // Header band
  const header = ws.getRow(1);
  header.height = 24;
  header.font = { bold: true, size: 11, color: { argb: HEADER_FG } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

  const thin = { style: 'thin', color: { argb: BORDER } };
  ws.eachRow((row, i) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
    });
    if (zebra && i > 1 && i % 2 === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_BG } };
      });
    }
  });

  // Autofilter over the populated block so every column is sortable in Excel.
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
  }

  return ws;
}

// Width from the widest value in the column, clamped so one long remark can't
// push a column off the page.
function autoWidth(column, rows) {
  const min = column.wrap ? 28 : Math.max(10, column.header.length + 4);
  let widest = column.header.length + 4;
  for (const r of rows) {
    const v = r[column.key];
    if (v === null || v === undefined) continue;
    const len = isDate(v) ? 18 : String(v).length + 2;
    if (len > widest) widest = len;
  }
  return Math.min(column.wrap ? 45 : 34, Math.max(min, widest));
}

// Leading sheet that records exactly what this file contains — which filters were
// applied, who pulled it and when. Without it an exported sheet is unauditable:
// nobody can tell later whether it was "all PRs" or "one status, one month".
function addInfoSheet(workbook, { title, user, filters = [], counts = [], truncated }) {
  const ws = workbook.addWorksheet('Export Info', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Field', key: 'field', width: 26 },
    { header: 'Value', key: 'value', width: 60 },
  ];

  const rows = [
    { field: 'Report', value: title },
    { field: 'Generated On', value: new Date(), fmt: 'dateTime' },
    { field: 'Generated By', value: user ? `${user.name || user.username || 'User'} (${titleCase(user.role)})` : '—' },
    ...filters.map((f) => ({ field: f.label, value: f.value || 'All' })),
    ...counts.map((c) => ({ field: c.label, value: c.value, fmt: c.fmt || 'int' })),
  ];
  if (truncated) {
    rows.push({
      field: 'Note',
      value: `Only the ${EXPORT_ROW_CAP} most recent records are included. Narrow the date range or status to export the rest.`,
    });
  }

  for (const r of rows) {
    const typed = isDate(r.value) || typeof r.value === 'number';
    const row = ws.addRow({ field: r.field, value: typed ? r.value : safeText(r.value) });
    if (typed && r.fmt && FMT[r.fmt]) row.getCell('value').numFmt = FMT[r.fmt];
    row.getCell('field').font = { bold: true };
    row.getCell('value').alignment = { wrapText: true, vertical: 'top' };
  }

  const header = ws.getRow(1);
  header.height = 22;
  header.font = { bold: true, size: 11, color: { argb: HEADER_FG } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
  header.alignment = { vertical: 'middle' };

  if (truncated) {
    const last = ws.getRow(ws.rowCount);
    last.getCell('value').font = { bold: true, color: { argb: 'FFB45309' } };
  }
  return ws;
}

function createWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RAPS ERP';
  wb.lastModifiedBy = 'RAPS ERP';
  wb.created = new Date();
  return wb;
}

// `RAPS_Purchase_Requests_2026-08-02.xlsx`
const exportFileName = (base) => {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `RAPS_${base.replace(/\s+/g, '_')}_${stamp}.xlsx`;
};

// Streams the workbook out as a download. Content-Disposition is exposed to the
// browser by the CORS config so the client can use the server-side filename.
async function sendWorkbook(res, workbook, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = {
  EXPORT_ROW_CAP,
  FMT,
  addInfoSheet,
  addSheet,
  createWorkbook,
  dateCell,
  exportFileName,
  num,
  safeText,
  sendWorkbook,
  titleCase,
  yesNo,
};
