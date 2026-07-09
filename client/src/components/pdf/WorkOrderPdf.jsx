import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, LOGO_URL } from './shared';

// ── WORK ORDER (RAPS/WO/01) ─────────────────────────────────────────────
// Printable/downloadable Work Order in the customer-facing "ION Format" — the
// 20-row S.No / Description / Details table, filled from the live WO record.
// Mirrors the physical form: Doc No. RAPS/WO/01, Rev 01, authorised + received
// signatory blocks, and the company footer.

// Effective PDC = latest extension's new date, else the base PDC.
const effectivePdc = (wo) => {
  const exts = wo.extensions || [];
  const last = exts.length ? exts[exts.length - 1] : null;
  return last ? last.newPdcDate : wo.pdcDate;
};

// Latest granted extension date (row 18: "Extended PDC if any").
const extendedPdc = (wo) => {
  const exts = wo.extensions || [];
  return exts.length ? exts[exts.length - 1].newPdcDate : null;
};

// Order-quantity cell: list each material line, or fall back to the aggregate.
const orderQtyText = (wo) => {
  const items = wo.items || [];
  if (items.length) {
    return items
      .map((it) => `${it.lineNo}. ${it.description} — ${it.quantity} ${it.uom || wo.orderUnit || 'Nos'}`)
      .join('\n');
  }
  return wo.orderQuantity != null ? `${wo.orderQuantity} ${wo.orderUnit || 'Nos'}` : '';
};

const local = {
  docControl: { alignItems: 'flex-end', marginBottom: 2 },
  docControlText: { fontSize: 8, color: '#111' },
  logo: { width: 120, height: 40, objectFit: 'contain', alignSelf: 'center', marginBottom: 2 },
  certLine: { fontSize: 7, color: '#c0392b', textAlign: 'center', marginBottom: 6 },
  woTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center', textDecoration: 'underline', marginBottom: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
  metaText: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  cellNo: { width: '7%', borderWidth: 1, borderColor: '#000', padding: 3, fontSize: 8, textAlign: 'center' },
  cellDesc: { width: '43%', borderWidth: 1, borderColor: '#000', padding: 3, fontSize: 8 },
  cellDetail: { width: '50%', borderWidth: 1, borderColor: '#000', padding: 3, fontSize: 8 },
  headNo: { width: '7%', borderWidth: 1, borderColor: '#000', padding: 3, fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'center', backgroundColor: '#eee' },
  headDesc: { width: '43%', borderWidth: 1, borderColor: '#000', padding: 3, fontSize: 8, fontFamily: 'Helvetica-Bold', backgroundColor: '#eee' },
  headDetail: { width: '50%', borderWidth: 1, borderColor: '#000', padding: 3, fontSize: 8, fontFamily: 'Helvetica-Bold', backgroundColor: '#eee' },
  remarksBox: { borderWidth: 1, borderColor: '#000', borderTopWidth: 0, padding: 4, minHeight: 34 },
  remarksLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 },
  signBlock: { width: '45%' },
  signText: { fontSize: 8 },
  signName: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  footer: { marginTop: 20, borderTopWidth: 1, borderTopColor: '#000', paddingTop: 4, textAlign: 'center' },
  footerName: { fontSize: 9, fontFamily: 'Helvetica-BoldOblique' },
  footerAddr: { fontSize: 6.5, color: '#333' },
};

export default function WorkOrderPdf({ data }) {
  const n = data || {};

  // 20-row form. Each row: [S.No, Description label, filled value].
  const rows = [
    ['Name of Customer', n.customerName],
    ['Supply Order Description', n.supplyOrderDescription || n.nomenclature],
    ['Supply Order No / Date', [n.supplyOrderNo, n.supplyOrderDate ? `Dt. ${formatDate(n.supplyOrderDate)}` : ''].filter(Boolean).join('  ')],
    ['Order Quantity', orderQtyText(n)],
    ['FIM Details (If any)', n.fimDetails],
    ['Inspection Agency', n.inspectionAgency],
    ['QAP No', n.qapNo],
    ['Customer details', n.customerContact],
    ['PDC Date', formatDate(effectivePdc(n))],
    ['Delivery clause', n.deliveryClause],
    ['Drawings details', n.drawingsDetails],
    ['Process Drawings details', n.processDrawingsDetails],
    ['Tooling (RAPS scope / Customer scope)', n.toolingScope],
    ['Packing Details (RAPS scope / FIM)', n.packingDetails],
    ['Transportation Details (RAPS scope / Customer scope)', n.transportationDetails],
    ['Major works execute at which site', n.majorWorksAtSite],
    ['Project Co-Ordinator', n.projectCoordinator],
    ['Extended PDC if any', extendedPdc(n) ? formatDate(extendedPdc(n)) : ''],
    ['Other information', n.otherInformation],
    ['Order Terms & Conditions / Scope', n.orderTermsAndScope],
  ];

  const cellText = (v) => (v === null || v === undefined ? '' : String(v));

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Doc-control block (form template identifiers) */}
        <View style={local.docControl}>
          <Text style={local.docControlText}>Doc. No.: RAPS/WO/01</Text>
          <Text style={local.docControlText}>Rev No: 01, Date: 20/02/2026</Text>
        </View>

        {/* Logo + certification line + title */}
        <Image src={LOGO_URL} style={local.logo} />
        <Text style={local.certLine}>An AS9100D Certified Organization</Text>
        <Text style={local.woTitle}>WORK ORDER</Text>

        {/* ION + date header */}
        <View style={local.metaRow}>
          <Text style={local.metaText}>ION: {n.ionNumber || '—'}</Text>
          <Text style={local.metaText}>Date: {formatDate(n.createdAt || n.supplyOrderDate)}</Text>
        </View>
        <View style={local.metaRow}>
          <Text style={{ fontSize: 8 }}>Ref. SO: {n.supplyOrderNo || '—'}</Text>
          <Text style={{ fontSize: 8 }}>WO No: {n.workOrderNumber || '—'}</Text>
        </View>

        {/* Main 20-row table */}
        <View style={{ marginTop: 4 }}>
          <View style={styles.row}>
            <Text style={local.headNo}>S.NO</Text>
            <Text style={local.headDesc}>DESCRIPTION</Text>
            <Text style={local.headDetail}>DETAILS</Text>
          </View>
          {rows.map(([label, value], idx) => (
            <View style={styles.row} key={idx} wrap={false}>
              <Text style={local.cellNo}>{idx + 1}</Text>
              <Text style={local.cellDesc}>{label}</Text>
              <Text style={local.cellDetail}>{cellText(value)}</Text>
            </View>
          ))}
          {/* Remarks band spanning the whole width */}
          <View style={local.remarksBox}>
            <Text style={local.remarksLabel}>Remarks if any:</Text>
            <Text style={{ fontSize: 8 }}>{cellText(n.remarks)}</Text>
          </View>
        </View>

        {/* Signatories */}
        <View style={local.signRow}>
          <View style={local.signBlock} />
          <View style={local.signBlock}>
            <Text style={local.signText}>(Authorized signatory)</Text>
            <Text style={local.signName}>K MAHESH BABU</Text>
          </View>
        </View>
        <View style={{ marginTop: 18 }}>
          <Text style={local.signText}>(Received signatory)</Text>
        </View>

        {/* Company footer */}
        <View style={local.footer}>
          <Text style={local.footerName}>Ramesh&apos;s Aerospace Products &amp; Services Pvt. Ltd.</Text>
          <Text style={local.footerAddr}>
            Regd. Off: Flat No: 112, D. No: 9-182/1, LK Towers, Roy Nagar, Gannavaram – 521 101,
          </Text>
          <Text style={local.footerAddr}>
            Vijayawada, Krishna Dist., Andhra Pradesh, INDIA, Ph: 08676-252345, E-mail: admin@rameshs.ind.in
          </Text>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}   RAPS ERP   {n.workOrderNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
