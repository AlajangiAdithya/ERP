import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

const statusLabel = (s) => ({ SENT: 'Sent', WAITING: 'Waiting', COLLECTED: 'Collected' }[s] || s);

export default function IONPdf({ data }) {
  const n = data || {};
  const items = n.items || [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="INTER OFFICE NOTE" docNumber={n.ionNumber} />
        <View style={styles.header}>
          <Text style={styles.title}>WORK ORDER / INTER OFFICE NOTE</Text>
          <Text style={styles.subtitle}>Doc No: RAMS/ION/00   RAPS Internal</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>ION No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.ionNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(n.createdAt)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>User Ref No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.userReferenceNo || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Status</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{statusLabel(n.status)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Section</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.section || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Project Name</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.projectName || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Supply Order No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.supplyOrderNo || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Ref Doc / QA Plan</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.referenceDocQA || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Material Supply Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(n.materialSupplyDate)}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Required By Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(n.requiredByDate)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Sample Required</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.sampleRequired ? 'Yes' : 'No'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Report Generation</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.reportGeneration ? 'Yes' : 'No'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>External QA Witness</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.externalQAWitness || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>QC Contact</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{n.qcContactDetails || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Completed Date</Text></View>
            <View style={[styles.cell, { width: '80%' }]}><Text>{formatDate(n.completedDate)}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Job Items</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '5%' }]}><Text>S.No</Text></View>
            <View style={[styles.cellHeader, { width: '22%' }]}><Text>Job Identification</Text></View>
            <View style={[styles.cellHeader, { width: '19%' }]}><Text>Activity Required</Text></View>
            <View style={[styles.cellHeader, { width: '18%' }]}><Text>Material Composition</Text></View>
            <View style={[styles.cellHeader, { width: '18%' }]}><Text>Drawing No / QAP</Text></View>
            <View style={[styles.cellHeader, { width: '18%' }]}><Text>Specification</Text></View>
          </View>
          {items.map((it, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: '5%' }]}><Text>{idx + 1}</Text></View>
              <View style={[styles.cell, { width: '22%' }]}><Text>{it.jobIdentification || '—'}</Text></View>
              <View style={[styles.cell, { width: '19%' }]}><Text>{it.activityRequired || '—'}</Text></View>
              <View style={[styles.cell, { width: '18%' }]}><Text>{it.materialComposition || '—'}</Text></View>
              <View style={[styles.cell, { width: '18%' }]}><Text>{it.drawingNo || '—'}</Text></View>
              <View style={[styles.cell, { width: '18%' }]}><Text>{it.specification || '—'}</Text></View>
            </View>
          ))}
        </View>

        {n.otherInformation && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Other Information</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{n.otherInformation}</Text></View>
          </View>
        )}

        {n.remarks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remarks</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{n.remarks}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Raised by', value: n.raisedBy?.name ? `${n.raisedBy.name} • ${formatDateTime(n.createdAt)}` : null },
          { label: 'Lab response', value: n.respondedBy?.name ? `${n.respondedBy.name} • ${formatDateTime(n.respondedAt)}` : null },
          { label: 'Collected by', value: n.collectedBy?.name ? `${n.collectedBy.name} • ${formatDateTime(n.collectedAt)}` : null },
        ]} />

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}   RAPS ERP   {n.ionNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
