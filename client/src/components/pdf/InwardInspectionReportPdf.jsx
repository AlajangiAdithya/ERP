import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

// Inward Inspection Report (IIR) — the filled QC report, rendered read-only in
// the RAPS paper format so it can be viewed / printed after QC finishes review.
// `row` is the decorated MaterialInwardRegister row from /api/material-inward.
const DOC_TYPE_LABEL = {
  INVOICE: 'Invoice',
  CASH_PURCHASE: 'Cash Purchase',
  DELIVERY_CHALLAN: 'Delivery Challan',
  GATE_PASS: 'Gate Pass',
};
const RESULT_LABEL = { PASSED: 'PASSED', PARTIAL: 'PARTIAL (accept with deviation)', FAILED: 'REJECTED' };
const fmtQty = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

export default function InwardInspectionReportPdf({ row }) {
  const r = row || {};
  const rep = r.qcReport || {};
  const req = r.qcRequest || {};

  const L = ({ label, width }) => (
    <View style={[styles.cellLabel, { width }]}><Text>{label}</Text></View>
  );
  const C = ({ value, width }) => (
    <View style={[styles.cell, { width }]}><Text>{value == null || value === '' ? '—' : String(value)}</Text></View>
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="INWARD INSPECTION REPORT" docNumber={r.qcReportNo} docSubtitle="Doc. No.: RAPS/QC/IIR/01" />
        <View style={styles.header}>
          <Text style={styles.title}>INWARD INSPECTION REPORT (IIR)</Text>
          <Text style={styles.subtitle}>{r.mirNo || ''}{r.lotNo != null ? `   •   Lot ${r.lotNo}` : ''}</Text>
        </View>

        {/* Identification */}
        <View style={styles.table}>
          <View style={styles.row}>
            <L label="Report No." width="20%" /><C value={r.qcReportNo} width="30%" />
            <L label="Report Date" width="20%" /><C value={formatDate(rep.reportDate)} width="30%" />
          </View>
          <View style={styles.row}>
            <L label="MIR No." width="20%" /><C value={r.mirNo} width="30%" />
            <L label="Inward Date" width="20%" /><C value={formatDate(r.inwardDate)} width="30%" />
          </View>
          <View style={styles.row}>
            <L label="PO No." width="20%" /><C value={r.poNumber || 'Direct / Cash'} width="30%" />
            <L label="PR No(s)." width="20%" /><C value={r.prNumbers} width="30%" />
          </View>
          <View style={styles.row}>
            <L label="Supplier" width="20%" /><C value={r.supplierName} width="30%" />
            <L label="Issued To" width="20%" /><C value={r.issuedToLabel || r.issuedToDept} width="30%" />
          </View>
          <View style={styles.row}>
            <L label="Document" width="20%" /><C value={`${DOC_TYPE_LABEL[r.docType] || r.docType || '—'}${r.docNumber ? ` — ${r.docNumber}` : ''}`} width="30%" />
            <L label="Vehicle" width="20%" /><C value={r.vehicleDetails} width="30%" />
          </View>
          <View style={styles.row}>
            <L label="Lot No." width="20%" /><C value={r.lotNo != null ? `Lot ${r.lotNo}` : '—'} width="30%" />
            <L label="Inspection Location" width="20%" /><C value={rep.inspectionLocation} width="30%" />
          </View>
        </View>

        {/* Material */}
        <Text style={styles.sectionTitle}>Material</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <L label="Description" width="20%" /><C value={rep.materialDescription || r.itemDescription} width="55%" />
            <L label="Category" width="12%" /><C value={rep.materialCategory} width="13%" />
          </View>
          <View style={styles.row}>
            <L label="Batch No." width="20%" /><C value={r.batchNo} width="30%" />
            <L label="Date of Mfg." width="20%" /><C value={rep.dateOfManufacturing ? formatDate(rep.dateOfManufacturing) : '—'} width="30%" />
          </View>
          <View style={styles.row}>
            <L label="Date of Expiry" width="20%" /><C value={r.dateOfExpiry ? formatDate(r.dateOfExpiry) : '—'} width="30%" />
            <L label="Ref. No." width="20%" /><C value={rep.reportReferenceNo} width="30%" />
          </View>
        </View>

        {/* Inspection checks */}
        <Text style={styles.sectionTitle}>Inspection</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <L label="Packing Condition" width="20%" /><C value={rep.packingCondition} width="30%" />
            <L label="Packing / Damage Notes" width="25%" /><C value={rep.packingDamageNotes} width="25%" />
          </View>
          <View style={styles.row}>
            <L label="Tapped Holes / Weld Lugs" width="25%" /><C value={rep.tappedHolesCondition} width="75%" />
          </View>
          <View style={styles.row}>
            <L label="Documents Verified" width="25%" /><C value={(rep.documentTypes || []).join(', ')} width="75%" />
          </View>
        </View>

        {/* Quantities & result */}
        <Text style={styles.sectionTitle}>Quantity & Result</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '20%' }]}><Text>Qty as per PR</Text></View>
            <View style={[styles.cellHeader, { width: '20%' }]}><Text>Qty Ordered</Text></View>
            <View style={[styles.cellHeader, { width: '20%' }]}><Text>Qty Received</Text></View>
            <View style={[styles.cellHeader, { width: '20%' }]}><Text>Qty Accepted</Text></View>
            <View style={[styles.cellHeader, { width: '20%' }]}><Text>Qty Rejected</Text></View>
          </View>
          <View style={styles.row}>
            <C value={`${fmtQty(rep.qtyAsPerPR)} ${r.uom || ''}`} width="20%" />
            <C value={`${fmtQty(rep.qtyOrdered != null ? rep.qtyOrdered : r.orderedQty)} ${r.uom || ''}`} width="20%" />
            <C value={`${fmtQty(r.qtyReceived)} ${r.uom || ''}`} width="20%" />
            <C value={`${fmtQty(r.qtyAccepted)} ${r.uom || ''}`} width="20%" />
            <C value={`${fmtQty(r.qtyRejected)} ${r.uom || ''}`} width="20%" />
          </View>
          <View style={styles.row}>
            <L label="Result" width="20%" />
            <View style={[styles.cell, { width: '80%' }]}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{RESULT_LABEL[r.qcResult] || r.qcResult || '—'}</Text>
            </View>
          </View>
          {(r.qcResult === 'FAILED' || r.qcResult === 'PARTIAL') && (
            <View style={styles.row}>
              <L label="Reason for Rejection" width="20%" /><C value={rep.rejectionReason} width="80%" />
            </View>
          )}
        </View>

        {/* Remark */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Report Remark</Text>
          <View style={[styles.cell, { padding: 6, minHeight: 36 }]}><Text>{r.qcReportRemark || '—'}</Text></View>
        </View>

        {/* Stores request form (what Stores recorded on hand-off) */}
        {(req.packingCondition || req.storesRemark || (req.documentsEnclosed || []).length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Stores Inspection Request</Text>
            <View style={styles.table}>
              <View style={styles.row}>
                <L label="Packing on Receipt" width="22%" /><C value={req.packingCondition} width="28%" />
                <L label="Documents Enclosed" width="22%" /><C value={(req.documentsEnclosed || []).join(', ')} width="28%" />
              </View>
              {req.storesRemark && (
                <View style={styles.row}>
                  <L label="Stores Remark" width="22%" /><C value={req.storesRemark} width="78%" />
                </View>
              )}
            </View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Created By', value: r.createdBy?.name ? `${r.createdBy.name} • ${formatDateTime(r.createdAt)}` : null },
          { label: 'QC Requested', value: r.qcRequestedBy?.name ? `${r.qcRequestedBy.name} • ${formatDateTime(r.qcRequestedAt)}` : null },
          { label: 'QC Reviewed', value: r.qcReviewer?.name ? `${r.qcReviewer.name} • ${formatDateTime(r.qcFinishedAt)}` : null },
          { label: 'Inwarded', value: r.inwardedAt ? formatDateTime(r.inwardedAt) : null },
        ]} />

        <View style={styles.sigRow}>
          <View style={styles.sigBox}>
            <Text>RECEIVED BY (STORES)</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{r.qcRequestedBy?.name || r.createdBy?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>INSPECTED BY (QC)</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{r.qcReviewer?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}><Text>QC HEAD</Text></View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  {r.qcReportNo || r.mirNo || ''}
        </Text>
      </Page>
    </Document>
  );
}
