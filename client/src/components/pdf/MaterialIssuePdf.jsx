import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

// MIV = Material Issue Voucher (items being issued from stores to a department).
// Distinct from InwardPdf, which is the Material *Inward* Voucher.
export default function MaterialIssuePdf({ data }) {
  const r = data || {};
  const items = r.items || [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="MATERIAL ISSUE VOUCHER" docNumber={r.issueNo || r.requestNumber} />
        <View style={styles.header}>
          <Text style={styles.title}>MATERIAL ISSUE VOUCHER (MIV)</Text>
          <Text style={styles.subtitle}>Form No: RAPS/MIV/ISSUE  Stores Department</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Issue No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{r.issueNo || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Issue Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(r.issueDate)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>MIV Request No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{r.requestNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Request Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(r.createdAt)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Reference No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{r.referenceNo || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>MIR No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{r.mirNo || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Requested By</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{r.manager?.name || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Unit / Dept.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}>
              <Text>{r.unit?.name ? `${r.unit.name}${r.unit.code ? ` (${r.unit.code})` : ''}` : '—'}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Status</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{r.status || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Cleared On</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDateTime(r.clearedAt)}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Materials Issued</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '6%' }]}><Text>#</Text></View>
            <View style={[styles.cellHeader, { width: '34%' }]}><Text>Material</Text></View>
            <View style={[styles.cellHeader, { width: '20%' }]}><Text>Purpose</Text></View>
            <View style={[styles.cellHeader, { width: '11%' }]}><Text>Requested</Text></View>
            <View style={[styles.cellHeader, { width: '11%' }]}><Text>Issued</Text></View>
            <View style={[styles.cellHeader, { width: '8%' }]}><Text>UOM</Text></View>
            <View style={[styles.cellHeader, { width: '10%' }]}><Text>Batch No.</Text></View>
          </View>
          {items.map((it, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: '6%' }]}><Text>{idx + 1}</Text></View>
              <View style={[styles.cell, { width: '34%' }]}><Text>{it.product?.name || '—'}</Text></View>
              <View style={[styles.cell, { width: '20%' }]}><Text>{it.purpose || '—'}</Text></View>
              <View style={[styles.cell, { width: '11%' }]}><Text>{it.quantity != null ? it.quantity : '—'}</Text></View>
              <View style={[styles.cell, { width: '11%' }]}><Text>{it.qtyIssued != null ? it.qtyIssued : '—'}</Text></View>
              <View style={[styles.cell, { width: '8%' }]}><Text>{it.product?.unit || '—'}</Text></View>
              <View style={[styles.cell, { width: '10%' }]}><Text>{it.materialBatchNo || '—'}</Text></View>
            </View>
          ))}
        </View>

        {r.remarks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remarks</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{r.remarks}</Text></View>
          </View>
        )}

        {r.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Requester Notes</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{r.notes}</Text></View>
          </View>
        )}

        {r.clearanceNotes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clearance Notes</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{r.clearanceNotes}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Requested by', value: r.manager?.name ? `${r.manager.name} • ${formatDateTime(r.createdAt)}` : null },
          { label: 'Cleared / Issued', value: r.issueNo ? `${r.issueNo} • ${formatDateTime(r.clearedAt || r.issueDate)}` : null },
          { label: 'Collected', value: r.collectedAt ? formatDateTime(r.collectedAt) : null },
        ]} />

        <View style={styles.sigRow}>
          <View style={styles.sigBox}><Text>Requested By (Manager)</Text></View>
          <View style={styles.sigBox}><Text>Issued By (Stores)</Text></View>
          <View style={styles.sigBox}><Text>Received By</Text></View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  RAPS ERP  MIV {r.issueNo || r.requestNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
