import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { LOGO_URL, formatDate } from './shared';

// Indian-style amount: 23,20,000-00 (rupees with locale grouping, dash, two-digit paise).
const formatINR = (n) => {
  const num = Number(n || 0);
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  return `${rupees.toLocaleString('en-IN')}-${String(paise).padStart(2, '0')}`;
};

// Letter-style PO modelled on RAPS/PO Rev 01 (sample format Dt: 05/06/2024).
const s = StyleSheet.create({
  page: { padding: 36, paddingBottom: 60, fontSize: 10, fontFamily: 'Times-Roman', color: '#111' },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  brandLogo: { width: 180, height: 60, objectFit: 'contain', marginRight: 10 },
  brandBlock: { flex: 1 },
  brandName: { fontSize: 13, fontFamily: 'Times-Bold', color: '#0a2540' },
  stampBlock: { textAlign: 'right' },
  stampLine: { fontSize: 8, fontFamily: 'Times-Bold' },
  hr: { borderBottomWidth: 1, borderBottomColor: '#222', marginVertical: 6 },

  refRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  refText: { fontSize: 10, fontFamily: 'Times-Bold' },

  block: { marginTop: 10 },
  toLabel: { fontSize: 10 },
  toLine: { fontSize: 10, fontFamily: 'Times-Bold' },
  toSub: { fontSize: 10 },

  salutation: { marginTop: 10, fontSize: 10 },
  subject: { marginTop: 10, fontSize: 10, fontFamily: 'Times-Bold' },
  refQuote: { marginTop: 2, fontSize: 10 },

  intro: { marginTop: 10, fontSize: 10 },

  // Items table
  table: { marginTop: 8, borderWidth: 1, borderColor: '#222' },
  tRow: { flexDirection: 'row' },
  tRowBordered: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#222' },
  th: {
    fontFamily: 'Times-Bold', fontSize: 9, padding: 4, textAlign: 'center',
    borderRightWidth: 1, borderRightColor: '#222', backgroundColor: '#eee',
  },
  thLast: {
    fontFamily: 'Times-Bold', fontSize: 9, padding: 4, textAlign: 'center', backgroundColor: '#eee',
  },
  td: { fontSize: 9, padding: 4, borderRightWidth: 1, borderRightColor: '#222' },
  tdLast: { fontSize: 9, padding: 4 },
  tdCenter: { fontSize: 9, padding: 4, borderRightWidth: 1, borderRightColor: '#222', textAlign: 'center' },
  tdRight: { fontSize: 9, padding: 4, borderRightWidth: 1, borderRightColor: '#222', textAlign: 'right' },
  tdRightLast: { fontSize: 9, padding: 4, textAlign: 'right' },

  desc: { fontSize: 9 },

  totalLabel: {
    fontFamily: 'Times-Bold', fontSize: 9, padding: 4, textAlign: 'right',
    borderRightWidth: 1, borderRightColor: '#222',
  },
  totalAmt: { fontFamily: 'Times-Bold', fontSize: 9, padding: 4, textAlign: 'right' },

  termsTitle: { marginTop: 12, fontSize: 10, fontFamily: 'Times-Bold' },
  termsLine: { marginTop: 2, fontSize: 9 },
  note: { marginTop: 10, fontSize: 9, fontStyle: 'italic' },

  closing: { marginTop: 18, fontSize: 10 },
  signBlock: { marginTop: 36, fontSize: 10 },
  footer: {
    position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7,
    color: '#888', textAlign: 'center', borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: 4,
  },
});

// Column widths (sum to 100%)
const COL = { sl: '7%', desc: '49%', qty: '14%', rate: '15%', amt: '15%' };

export default function POPdf({ order }) {
  const items = order?.items || [];
  const pr = order?.purchaseRequest;
  const quotation = order?.quotation;

  const supplierAddress = quotation?.supplierAddress || '';
  const supplierContact = quotation?.supplierContact || '';
  const addressLines = supplierAddress
    ? supplierAddress.split(/\r?\n|,\s*/).map((x) => x.trim()).filter(Boolean)
    : [];

  // Subject summary — first 3 product names, comma-separated.
  const subjectMaterials = items.slice(0, 3).map((i) => i.productName).filter(Boolean).join(', ');
  const subjectMore = items.length > 3 ? `, +${items.length - 3} more` : '';
  const subject = order?.customName
    ? `Purchase Order for Supply of ${order.customName}`
    : `Purchase Order for Supply of ${subjectMaterials}${subjectMore}`;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Letterhead */}
        <View style={s.brandRow}>
          <Image src={LOGO_URL} style={s.brandLogo} />
          <View style={s.brandBlock}>
            <Text style={s.brandName}>Ramesh's Aerospace Products & Services Pvt. Ltd.</Text>
          </View>
          <View style={s.stampBlock}>
            <Text style={s.stampLine}>Form no.: RAPS/PO Rev 01</Text>
            <Text style={s.stampLine}>Dt: 05/06/2024</Text>
          </View>
        </View>
        <View style={s.hr} />

        {/* Ref + Date */}
        <View style={s.refRow}>
          <Text style={s.refText}>Ref: {order?.orderNumber || '—'}</Text>
          <Text style={s.refText}>Date: {formatDate(order?.createdAt)}</Text>
        </View>
        <View style={s.refRow}>
          <Text style={s.refText}>
            PR No: {pr?.requestNumber || '—'}  Dt: {formatDate(pr?.createdAt)}
          </Text>
          <Text style={s.refText}> </Text>
        </View>

        {/* To block */}
        <View style={s.block}>
          <Text style={s.toLabel}>To,</Text>
          <Text style={s.toLine}>M/s {order?.supplierName || quotation?.supplierName || '—'}</Text>
          {addressLines.map((line, i) => (
            <Text key={i} style={s.toSub}>{line}</Text>
          ))}
          {supplierContact && (
            <Text style={s.toSub}>Kind Attn: {supplierContact}</Text>
          )}
        </View>

        {/* Salutation + Subject */}
        <Text style={s.salutation}>Dear Sir,</Text>
        <Text style={s.subject}>Subject: {subject}.</Text>
        {quotation?.quotationNumber && (
          <Text style={s.refQuote}>
            Ref: Your Quotation No: {quotation.quotationNumber} Dt: {formatDate(quotation.createdAt)}
          </Text>
        )}

        <Text style={s.intro}>
          With reference to the above and subsequent discussions, we are pleased to place an order on you for the supply of the following.
        </Text>

        {/* Items table */}
        <View style={s.table}>
          <View style={s.tRow}>
            <Text style={[s.th, { width: COL.sl }]}>Sl. No.</Text>
            <Text style={[s.th, { width: COL.desc }]}>Material Description and Specification</Text>
            <Text style={[s.th, { width: COL.qty }]}>Qty</Text>
            <Text style={[s.th, { width: COL.rate }]}>Rate</Text>
            <Text style={[s.thLast, { width: COL.amt }]}>Amount</Text>
          </View>
          {items.map((item, idx) => {
            return (
              <View key={item.id || idx} style={s.tRowBordered} wrap={false}>
                <Text style={[s.tdCenter, { width: COL.sl }]}>{idx + 1}</Text>
                <View style={[s.td, { width: COL.desc }]}>
                  <Text style={s.desc}>{item.productName}</Text>
                </View>
                <Text style={[s.tdCenter, { width: COL.qty }]}>
                  {item.quantity} {item.productUnit}
                </Text>
                <Text style={[s.tdRight, { width: COL.rate }]}>{formatINR(item.unitPrice)}</Text>
                <Text style={[s.tdRightLast, { width: COL.amt }]}>{formatINR(item.totalPrice)}</Text>
              </View>
            );
          })}
          {/* Total row */}
          <View style={s.tRowBordered}>
            <Text style={[s.totalLabel, { width: '85%' }]}>Total</Text>
            <Text style={[s.totalAmt, { width: COL.amt }]}>{formatINR(order?.totalAmount)}</Text>
          </View>
        </View>

        <Text style={s.note}>
          Note: Test reports / inspection certificates shall be provided along with the invoice at the time of delivery.
        </Text>

        {/* Terms */}
        <Text style={s.termsTitle}>Terms & Conditions:</Text>
        <Text style={s.termsLine}>GST: Extra @18% or as applicable.</Text>
        <Text style={s.termsLine}>Payment: Mutually agreeable terms.</Text>
        <Text style={s.termsLine}>Delivery: As mutually agreed from the date of PO.</Text>
        <Text style={s.termsLine}>Packing: Standard packing to avoid transit damage.</Text>
        <Text style={s.termsLine}>Inspection: As per RAPS QA / Customer QA standard.</Text>
        <Text style={s.termsLine}>Please mention our PO number in the invoice copy.</Text>
        <Text style={s.termsLine}>For all other terms and conditions refer annexure attached.</Text>
        <Text style={s.termsLine}>Jurisdiction: Any disputes shall be subject to the jurisdiction of Vijayawada.</Text>

        <Text style={s.closing}>Thanking you,</Text>
        <Text style={s.closing}>Yours sincerely,</Text>
        <Text style={s.closing}>For Ramesh's Aerospace Products & Services Pvt. Ltd.,</Text>
        <Text style={s.signBlock}>
          ({order?.createdBy?.name || 'Authorised Signatory'})
        </Text>

        <Text style={s.footer} fixed>
          Generated by RAPS ERP · PO {order?.orderNumber}
        </Text>
      </Page>
    </Document>
  );
}
