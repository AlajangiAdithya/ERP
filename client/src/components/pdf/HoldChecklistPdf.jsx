import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

export default function HoldChecklistPdf({ data }) {
  const h = data || {};
  const wo = h.workOrder || {};
  const items = Array.isArray(h.missingItems) ? h.missingItems : [];
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="CLOSURE HOLD — MISSING ITEMS CHECKLIST" docNumber={wo.workOrderNumber} />

        <View style={styles.header}>
          <Text style={styles.title}>HOLD CHECKLIST</Text>
          <Text style={styles.subtitle}>Issued by Finance to the executing Unit</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Work Order</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{wo.workOrderNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Raised On</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{formatDate(h.raisedAt)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Customer</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{wo.customerName || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Raised By</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{h.raisedBy?.name || '—'}</Text></View>
          </View>
        </View>

        {h.reason && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reason</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{h.reason}</Text></View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Missing / Pending Items</Text>
          <View style={styles.table}>
            <View style={styles.row}>
              <View style={[styles.cellHeader, { width: '8%' }]}><Text>#</Text></View>
              <View style={[styles.cellHeader, { width: '32%' }]}><Text>Doc / Item Type</Text></View>
              <View style={[styles.cellHeader, { width: '60%' }]}><Text>Note</Text></View>
            </View>
            {items.length ? items.map((it, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <View style={[styles.cell, { width: '8%' }]}><Text>{i + 1}</Text></View>
                <View style={[styles.cell, { width: '32%' }]}><Text>{it.docType || ''}</Text></View>
                <View style={[styles.cell, { width: '60%' }]}><Text>{it.note || ''}</Text></View>
              </View>
            )) : (
              <View style={styles.row}>
                <View style={[styles.cell, { width: '100%', padding: 6 }]}>
                  <Text>No items recorded.</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <AuditTrail entries={[
          { label: 'Raised By Finance', value: h.raisedBy?.name ? `${h.raisedBy.name} • ${formatDateTime(h.raisedAt)}` : null },
          { label: 'Resolved By Unit', value: h.resolvedBy?.name ? `${h.resolvedBy.name} • ${formatDateTime(h.resolvedAt)}` : null },
        ]} />

        <View style={[styles.sigRow, { marginTop: 24 }]}>
          <View style={styles.sigBox}>
            <Text>FINANCE</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{h.raisedBy?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>UNIT INCHARGE</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{h.resolvedBy?.name || ''}</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  Hold for {wo.workOrderNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
