export const formatDateTime = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

export const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

export const formatNumber = (num) => {
  if (num == null) return '0';
  return new Intl.NumberFormat('en-IN').format(num);
};

// Pretty-print stock-movement notes that may be JSON (from Excel import) or free text.
export const formatNotes = (raw) => {
  if (!raw) return '—';
  let obj;
  try { obj = JSON.parse(raw); } catch { return raw; }
  if (typeof obj !== 'object' || obj === null) return String(raw);
  const parts = [];
  if (obj.mirNo) parts.push(`MIR ${obj.mirNo}`);
  if (obj.ionNo) parts.push(`ION ${obj.ionNo}`);
  if (obj.docType && obj.docNo) parts.push(`${obj.docType} ${obj.docNo}`);
  else if (obj.docNo) parts.push(obj.docNo);
  if (obj.supplier) parts.push(obj.supplier);
  if (obj.vehicle) parts.push(obj.vehicle);
  if (obj.poRef) parts.push(`PO ${obj.poRef}`);
  if (obj.matType) parts.push(obj.matType);
  if (obj.unit) parts.push(`Unit: ${obj.unit}`);
  if (obj.inspection?.status) parts.push(`QC: ${obj.inspection.status}`);
  if (obj.remarks) parts.push(obj.remarks);
  if (obj.issueDetails) parts.push(`Issued to: ${obj.issueDetails}`);
  if (obj.company) parts.push(obj.company);
  return parts.length ? parts.join(' • ') : (obj.notes || JSON.stringify(obj));
};
