import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

const typeLabel = (t) => ({
  RETURNABLE: 'RETURNABLE GATE PASS',
  NON_RETURNABLE: 'NON-RETURNABLE GATE PASS (FIM)',
  DELIVERY_CHALLAN: 'DELIVERY CHALLAN',
}[t] || 'GATE PASS');

const typeForm = (t) => ({
  RETURNABLE: 'Form No: RAPS/GP/RET',
  NON_RETURNABLE: 'Form No: RAPS/GP/NRT',
  DELIVERY_CHALLAN: 'Form No: RAPS/DC',
}[t] || '');

const statusLabel = (s) => ({ OPEN: 'Open', RETURNED: 'Returned', CLOSED: 'Closed' }[s] || s);

export default function GatePassPdf({ data }) {
  const g = data || {};
  const isReturnable = g.passType === 'RETURNABLE';
  const items = g.items || [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType={typeLabel(g.passType)} docNumber={g.passNumber} />
        <View style={styles.header}>
          <Text style={styles.title}>{typeLabel(g.passType)}</Text>
          <Text style={styles.subtitle}>{typeForm(g.passType)}  Stores Department  RAPS</Text>
        </View>

        {/* Top meta grid */}
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Gate Pass No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.passNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(g.date)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Pass Type</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{typeLabel(g.passType)}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Status</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{statusLabel(g.status)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>{isReturnable ? 'Vendor' : 'Customer'}</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.partyName || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Contact</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.partyContact || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Vehicle No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.vehicleNo || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Invoice No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.invoiceNo || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>DC No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.dcNo || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Requisition No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.requisitionNo || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Issued To</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.issuedToName || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Department</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.issuedToDept || '—'}</Text></View>
          </View>
          {isReturnable && (
            <View style={styles.row}>
              <View style={[styles.cellLabel, { width: '20%' }]}><Text>Expected Return</Text></View>
              <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(g.expectedReturnDate)}</Text></View>
              <View style={[styles.cellLabel, { width: '20%' }]}><Text>Actual Return</Text></View>
              <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(g.actualReturnDate)}</Text></View>
            </View>
          )}
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Purpose</Text></View>
            <View style={[styles.cell, { width: '80%' }]}><Text>{g.purpose || '—'}</Text></View>
          </View>
        </View>

        {/* Items table */}
        <Text style={styles.sectionTitle}>Items</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '6%' }]}><Text>#</Text></View>
            <View style={[styles.cellHeader, { width: '52%' }]}><Text>Description</Text></View>
            <View style={[styles.cellHeader, { width: '14%' }]}><Text>Quantity</Text></View>
            <View style={[styles.cellHeader, { width: '10%' }]}><Text>UOM</Text></View>
            <View style={[styles.cellHeader, { width: '18%' }]}><Text>Remarks</Text></View>
          </View>
          {items.map((it, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: '6%' }]}><Text>{idx + 1}</Text></View>
              <View style={[styles.cell, { width: '52%' }]}><Text>{it.description || '—'}</Text></View>
              <View style={[styles.cell, { width: '14%' }]}><Text>{it.quantity != null ? it.quantity : '—'}</Text></View>
              <View style={[styles.cell, { width: '10%' }]}><Text>{it.unit || '—'}</Text></View>
              <View style={[styles.cell, { width: '18%' }]}><Text>{it.remarks || '—'}</Text></View>
            </View>
          ))}
        </View>

        {g.remarks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remarks</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{g.remarks}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Issued by', value: g.createdBy?.name ? `${g.createdBy.name} • ${formatDateTime(g.createdAt)}` : null },
          { label: 'Returned by', value: g.returnedBy?.name ? `${g.returnedBy.name} • ${formatDateTime(g.actualReturnDate)}` : null },
          { label: 'Closed by', value: g.closedBy?.name ? `${g.closedBy.name} • ${formatDateTime(g.closedAt)}` : null },
        ]} />

        <View style={styles.sigRow}>
          <View style={styles.sigBox}><Text>Requested By</Text></View>
          <View style={styles.sigBox}><Text>Stores Sign</Text></View>
          <View style={styles.sigBox}><Text>{isReturnable ? 'Returned / Receiver Sign' : 'Authorised Sign'}</Text></View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  RAPS ERP  {g.passNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
