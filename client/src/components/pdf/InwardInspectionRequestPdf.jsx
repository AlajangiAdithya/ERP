import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { LOGO_URL, formatDate } from './shared';

// Inward Inspection Request Form — Form no.: RAPS/IIR Rev 01 (Dt: 01/09/2024).
// Page 1 of the IIR document: filled by Purchase & Stores, then handed to QA/QC.
// `row` is the decorated MaterialInwardRegister row; `form` is the persisted
// qcRequest snapshot (the form values).
const DOC_TYPE_LABEL = {
  INVOICE: 'Invoice', CASH_PURCHASE: 'Cash Purchase',
  DELIVERY_CHALLAN: 'Delivery Challan', GATE_PASS: 'Gate Pass',
};
const fmtQty = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const BORDER = '#444';

// Single grid cell. Borders are drawn per-cell (no collapse in react-pdf), which
// reproduces the printed form's ruled look.
export function Cell({ w, header, section, bold, center, minHeight, noLeft, noTop, children }) {
  return (
    <View style={[
      { width: w, borderWidth: 1, borderColor: BORDER, padding: 4, justifyContent: 'center' },
      noLeft && { borderLeftWidth: 0 },
      noTop && { borderTopWidth: 0 },
      header && { backgroundColor: '#d8d8d8' },
      section && { backgroundColor: '#f0f0f0' },
      minHeight ? { minHeight } : null,
    ]}>
      <Text style={[
        { fontSize: 8 },
        (bold || header || section) && { fontFamily: 'Helvetica-Bold' },
        (center || section) && { textAlign: 'center' },
      ]}>{children != null && children !== '' ? children : ' '}</Text>
    </View>
  );
}

// The 3-cell RAPS title block shared by both IIR pages.
export function IirTitleBlock({ docTypeLines }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: '28%', borderWidth: 1, borderColor: BORDER, padding: 6, alignItems: 'center', justifyContent: 'center' }}>
        <Image src={LOGO_URL} style={{ width: 90, height: 28, objectFit: 'contain' }} />
      </View>
      <View style={{ width: '47%', borderWidth: 1, borderLeftWidth: 0, borderColor: BORDER, padding: 6, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{docTypeLines}</Text>
      </View>
      <View style={{ width: '25%', borderWidth: 1, borderLeftWidth: 0, borderColor: BORDER, padding: 6, justifyContent: 'center' }}>
        <Text style={{ fontSize: 8 }}>Form no.: RAPS/IIR Rev 01</Text>
        <Text style={{ fontSize: 8 }}>Dt: 01/09/2024</Text>
      </View>
    </View>
  );
}

const W = { sno: '8%', label: '34%', value: '58%', details: '92%' };

function DataRow({ sno, label, value }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <Cell w={W.sno} center>{sno}</Cell>
      <Cell w={W.label} noLeft>{label}</Cell>
      <Cell w={W.value} noLeft>: {value || ''}</Cell>
    </View>
  );
}

function SectionRow({ title }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <Cell w="100%" section>{title}</Cell>
    </View>
  );
}

// Page 1 of the IIR — the request form. Exported so the report PDF can bind it
// as page 1 of the complete two-page document.
export function RequestFormPage({ row, form }) {
  const r = row || {};
  const f = form || r.qcRequest || {};

  const orderedQtyText = r.orderedQty != null ? `${fmtQty(r.orderedQty)} ${r.uom || ''}`.trim() : '';
  const docInvoice = ['INVOICE', 'CASH_PURCHASE'].includes(r.docType) && r.docNumber
    ? `${r.docNumber} · ${formatDate(r.inwardDate)}` : '';
  const docDc = r.docType === 'DELIVERY_CHALLAN' ? (r.docNumber || '') : '';
  const docGp = r.docType === 'GATE_PASS' ? (r.docNumber || '') : '';
  const val = (key, fallback = '') => (f[key] != null && f[key] !== '' ? f[key] : fallback);

  return (
    <Page size="A4" style={{ padding: 24, fontFamily: 'Helvetica', color: '#111' }}>
      <IirTitleBlock docTypeLines={'INWARD INSPECTION\nREQUEST FORM'} />

      <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4 }}>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}>Inspection ION No. & Date: {val('ionNoDate')}</Text>
      </View>

      <View style={{ flexDirection: 'row' }}>
        <Cell w={W.sno} header bold center>S.no</Cell>
        <Cell w={W.details} header bold center noLeft>Details (To be filled by Purchase &amp; stores)</Cell>
      </View>

      <SectionRow title="Purchase Requisition details" />
      <DataRow sno="01" label="Purchase requisition no. & Date" value={val('prNoDate', r.prNumbers)} />
      <DataRow sno="02" label="Material description and Specification" value={val('materialDesc', r.itemDescription)} />
      <DataRow sno="03" label="Quantity as per PR" value={val('qtyAsPerPR')} />

      <SectionRow title="Enquiry & Budgetary quote details" />
      <DataRow sno="04" label="Supplier details" value={val('supplierDetails', r.supplierName)} />
      <DataRow sno="05" label="Budgetary quote details" value={val('budgetaryQuote')} />
      <DataRow sno="06" label="Supplier Assessment form" value={val('supplierAssessment')} />

      <SectionRow title="Purchase order details" />
      <DataRow sno="07" label="Purchase order no. & date" value={val('poNoDate', r.poNumber)} />
      <DataRow sno="08" label="Quantity ordered" value={val('qtyOrdered', orderedQtyText)} />
      <DataRow sno="09" label="Delivery Required by" value={val('deliveryRequiredBy')} />
      <DataRow sno="10" label="Scope of Work as per PO" value={val('scopeOfWork')} />

      <SectionRow title="Invoice & DC Details" />
      <DataRow sno="11" label="Invoice no. & date" value={val('invoiceNoDate', docInvoice)} />
      <DataRow sno="12" label="DC no. if any" value={val('dcNo', docDc)} />
      <DataRow sno="13" label="Gate pass no. (FIM/others)" value={val('gatePassNo', docGp)} />
      <DataRow sno="14" label="Gate pass type" value={val('gatePassType')} />
      <DataRow sno="15" label="Probable date of Return" value={val('probableReturnDate')} />
      <DataRow sno="16" label="Material receipt date @RAPS, Store" value={val('materialReceiptDate', formatDate(r.inwardDate))} />

      <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4 }}>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}>
          Requesting QA/QC Group to inspect the particulars mentioned above and inspect the material as per Material specification/Scope of PO
        </Text>
      </View>

      <Text style={{ position: 'absolute', bottom: 16, right: 24, fontSize: 8 }} fixed>Page 1 of 2</Text>
    </Page>
  );
}

export default function InwardInspectionRequestPdf({ row, form }) {
  return <Document><RequestFormPage row={row} form={form} /></Document>;
}
