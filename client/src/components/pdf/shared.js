import { StyleSheet, View, Text, Image } from '@react-pdf/renderer';
import React from 'react';

export const LOGO_URL = `${window.location.origin}/raps-logo-pdf.png`;

export const formatDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const formatDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const formatCurrency = (n) => `Rs.${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111',
  },
  header: {
    borderWidth: 1,
    borderColor: '#444',
    padding: 6,
    marginBottom: 6,
    textAlign: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#d8d8d8',
  },
  brandLogo: { width: 110, height: 28, objectFit: 'contain' },
  brandTitleBlock: { flex: 1 },
  brandName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#0a2540' },
  brandTagline: { fontSize: 7, color: '#666' },
  docType: { fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  auditBox: {
    marginTop: 8,
    padding: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  auditRow: { flexDirection: 'row', marginBottom: 2 },
  auditLabel: { fontSize: 7, color: '#666', width: 90 },
  auditValue: { fontSize: 7, color: '#222', flex: 1 },
  title: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtitle: { fontSize: 8, color: '#555' },

  // Paper table
  table: { width: '100%', marginBottom: 6 },
  row: { flexDirection: 'row' },
  cellLabel: {
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#f0f0f0',
    padding: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
  },
  cell: {
    borderWidth: 1,
    borderColor: '#444',
    padding: 4,
    fontSize: 8,
  },
  cellHeader: {
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#d8d8d8',
    padding: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    textAlign: 'center',
  },

  // Meta/info
  section: { marginTop: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 4 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 24,
    right: 24,
    fontSize: 7,
    color: '#666',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    paddingTop: 4,
  },

  // Signatures
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  sigBox: { width: '30%', borderTopWidth: 1, borderTopColor: '#444', paddingTop: 4, fontSize: 8, textAlign: 'center' },
});

export const CompanyHeader = ({ docType, docNumber }) => (
  React.createElement(View, { style: styles.brandRow },
    React.createElement(Image, { src: LOGO_URL, style: styles.brandLogo }),
    React.createElement(View, { style: styles.brandTitleBlock }),
    React.createElement(View, null,
      React.createElement(Text, { style: styles.docType }, docType || ''),
      docNumber ? React.createElement(Text, { style: styles.subtitle }, `No. ${docNumber}`) : null,
    )
  )
);

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

export const AuditTrail = ({ entries = [] }) => {
  const valid = entries.filter((e) => e && e.value);
  if (!valid.length) return null;
  return React.createElement(View, { style: styles.auditBox },
    React.createElement(Text, { style: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 3 } }, 'Audit Trail'),
    ...valid.map((e, i) =>
      React.createElement(View, { key: i, style: styles.auditRow },
        React.createElement(Text, { style: styles.auditLabel }, e.label),
        React.createElement(Text, { style: styles.auditValue }, e.value),
      )
    )
  );
};
