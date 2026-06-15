import { Document, Page, View, Text } from '@react-pdf/renderer';
import { formatDate } from './shared';
import { Cell, IirTitleBlock, BORDER, RequestFormPage } from './InwardInspectionRequestPdf';

// Inward Inspection Report — Form no.: RAPS/IIR Rev 01 (Dt: 01/09/2024), page 2.
// The default export binds page 1 (the request form) + page 2 (this report) into
// the complete two-page IIR document. `row` is the decorated register row.
const fmtQty = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

function Box({ checked }) {
  return (
    <View style={{ width: 9, height: 9, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}>
      {checked ? <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', lineHeight: 1 }}>X</Text> : null}
    </View>
  );
}
function CheckItem({ label, checked }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
      <Text style={{ fontSize: 8, marginRight: 3 }}>{label}</Text>
      <Box checked={checked} />
    </View>
  );
}

export function ReportPage({ row }) {
  const r = row || {};
  const rep = r.qcReport || {};
  const ion = r.qcRequest?.ionNoDate || '';
  const cat = rep.materialCategory || '';
  const docs = Array.isArray(rep.documentTypes) ? rep.documentTypes : [];
  const sealed = (rep.packingCondition || '').toLowerCase() === 'sealed';
  const broken = (rep.packingCondition || '').toLowerCase() === 'broken';

  const Line = ({ children, bold }) => (
    <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4 }}>
      <Text style={[{ fontSize: 8 }, bold && { fontFamily: 'Helvetica-Bold' }]}>{children}</Text>
    </View>
  );
  const KV = ({ label, value }) => (
    <View style={{ flexDirection: 'row' }}>
      <Cell w="45%" noTop>{label}</Cell>
      <Cell w="55%" noTop noLeft>: {value || ''}</Cell>
    </View>
  );

  const qtys = [
    ['Quantity as per PR', rep.qtyAsPerPR],
    ['Quantity ordered', rep.qtyOrdered != null ? rep.qtyOrdered : r.orderedQty],
    ['Quantity Received', r.qtyReceived],
    ['Quantity Accepted', r.qtyAccepted],
    ['Quantity Rejected', r.qtyRejected],
  ];

  return (
    <Page size="A4" style={{ padding: 24, fontFamily: 'Helvetica', color: '#111' }}>
      <IirTitleBlock docTypeLines={'INWARD INSPECTION\nREPORT'} />

      <Line bold>Inspection ION No. & Date: {ion}</Line>
      <Line bold>Inspection report no. & Date : {[r.qcReportNo, rep.reportDate ? formatDate(rep.reportDate) : ''].filter(Boolean).join('   ·   ')}</Line>
      <Line>Material description and specification : {rep.materialDescription || r.itemDescription || ''}</Line>

      {/* Material category */}
      <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4 }}>
        <CheckItem label="Raw materials" checked={/raw/i.test(cat)} />
        <CheckItem label="Consumables" checked={/consumab/i.test(cat)} />
        <CheckItem label="Tooling & Fixtures" checked={/tool/i.test(cat)} />
        <CheckItem label="FIM" checked={/fim/i.test(cat)} />
      </View>

      {/* Documents verified */}
      <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4 }}>
        <CheckItem label="Test Report" checked={docs.includes('Test Report')} />
        <CheckItem label="COC" checked={docs.includes('COC')} />
        <CheckItem label="COA" checked={docs.includes('COA')} />
        <CheckItem label="3rd Party/Customer Clearance" checked={docs.some((d) => /3rd party/i.test(d))} />
      </View>

      {/* Dimensional inspection */}
      <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4 }}>
        <CheckItem label="Dimensional Inspection at Supplier Place" checked={!!rep.dimInspectionSupplier} />
        <CheckItem label="Dimensional Inspection at RAPS inward" checked={!!rep.dimInspectionRaps} />
      </View>

      <Line>Report reference no.: {rep.reportReferenceNo || ''}</Line>

      {/* Packing condition */}
      <View style={{ flexDirection: 'row', borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4, alignItems: 'center' }}>
        <Text style={{ fontSize: 8, marginRight: 3 }}>Packing condition - Sealed</Text>
        <Box checked={sealed} />
        <Text style={{ fontSize: 8, marginLeft: 10, marginRight: 3 }}>Broken</Text>
        <Box checked={broken} />
        <Text style={{ fontSize: 8, marginLeft: 6 }}>, if damages mention: {rep.packingDamageNotes || ''}</Text>
      </View>

      <KV label="Batch no./Identification" value={r.batchNo} />
      <KV label="Date of manufacturing" value={rep.dateOfManufacturing ? formatDate(rep.dateOfManufacturing) : ''} />
      <KV label="Date of Expiry" value={r.dateOfExpiry ? formatDate(r.dateOfExpiry) : ''} />
      <KV label="Check the condition of tapped holes, weld lugs (if applicable)" value={rep.tappedHolesCondition} />

      {/* Quantities */}
      <View style={{ flexDirection: 'row' }}>
        {qtys.map(([h], i) => <Cell key={i} w="20%" header bold center noTop noLeft={i > 0}>{h}</Cell>)}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {qtys.map(([, v], i) => <Cell key={i} w="20%" center minHeight={42} noTop noLeft={i > 0}>{fmtQty(v)}</Cell>)}
      </View>

      <Line bold>Reason for Rejection/Non confirmity: {rep.rejectionReason || ''}</Line>
      <Line bold>Remarks: {r.qcReportRemark || ''}</Line>

      {/* Sign-off */}
      <View style={{ flexDirection: 'row' }}>
        <Cell w="50%" header bold center noTop>Stores group</Cell>
        <Cell w="50%" header bold center noTop noLeft>Quality group</Cell>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: '50%', borderWidth: 1, borderTopWidth: 0, borderColor: BORDER, padding: 4, minHeight: 46 }}>
          <Text style={{ fontSize: 8 }}>{r.qcRequestedBy?.name || r.createdBy?.name || ''}</Text>
        </View>
        <View style={{ width: '50%', borderWidth: 1, borderTopWidth: 0, borderLeftWidth: 0, borderColor: BORDER, padding: 4, minHeight: 46 }}>
          <Text style={{ fontSize: 8 }}>{r.qcReviewer?.name || ''}{r.qcResult ? `   ·   ${r.qcResult}` : ''}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Cell w="50%" center noTop>MIR No. (Store to be filled): {r.mirNo || ''}</Cell>
        <Cell w="50%" noTop noLeft />
      </View>

      <Text style={{ position: 'absolute', bottom: 16, right: 24, fontSize: 8 }} fixed>Page 2 of 2</Text>
    </Page>
  );
}

export default function InwardInspectionReportPdf({ row }) {
  return (
    <Document>
      <RequestFormPage row={row} form={row?.qcRequest} />
      <ReportPage row={row} />
    </Document>
  );
}
