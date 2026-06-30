import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

// MIV = Material Inward Voucher
export default function InwardPdf({ data }) {
  const {
    mivNumber,
    date,
    supplierName,
    orderNumber,
    prNumber,
    customName,
    batchNumber,
    lotNumber,
    lotArrivedQty,
    receivedBy,
    notes,
    items = [],
  } = data || {};

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="MATERIAL INWARD VOUCHER" docNumber={mivNumber} />
        <View style={styles.header}>
          <Text style={styles.title}>MATERIAL INWARD VOUCHER (MIV)</Text>
          <Text style={styles.subtitle}>Form No: RAPS/MIV  Stores Department</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>MIV No.</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{mivNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Date</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{formatDate(date)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Supplier</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{supplierName || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>PO No.</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{orderNumber || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>PR No.</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{prNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Order Name</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{customName || '—'}</Text></View>
          </View>
          {(batchNumber || lotNumber != null) && (
            <View style={styles.row}>
              <View style={[styles.cellLabel, { width: '18%' }]}><Text>Batch No.</Text></View>
              <View style={[styles.cell, { width: '32%' }]}><Text>{batchNumber || '—'}</Text></View>
              <View style={[styles.cellLabel, { width: '18%' }]}><Text>Lot / Arrived</Text></View>
              <View style={[styles.cell, { width: '32%' }]}>
                <Text>{lotNumber != null ? `Lot ${lotNumber}` : '—'}{lotArrivedQty != null ? ` · ${lotArrivedQty}` : ''}</Text>
              </View>
            </View>
          )}
          {receivedBy && (
            <View style={styles.row}>
              <View style={[styles.cellLabel, { width: '18%' }]}><Text>Received By</Text></View>
              <View style={[styles.cell, { width: '82%' }]}><Text>{receivedBy}</Text></View>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Materials Received</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '6%' }]}><Text>#</Text></View>
            <View style={[styles.cellHeader, { width: '42%' }]}><Text>Material</Text></View>
            <View style={[styles.cellHeader, { width: '14%' }]}><Text>Ordered</Text></View>
            <View style={[styles.cellHeader, { width: '14%' }]}><Text>Received</Text></View>
            <View style={[styles.cellHeader, { width: '10%' }]}><Text>UOM</Text></View>
            <View style={[styles.cellHeader, { width: '14%' }]}><Text>Batch</Text></View>
          </View>
          {items.map((it, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: '6%' }]}><Text>{idx + 1}</Text></View>
              <View style={[styles.cell, { width: '42%' }]}><Text>{it.productName || '—'}</Text></View>
              <View style={[styles.cell, { width: '14%' }]}><Text>{it.orderedQty != null ? it.orderedQty : '—'}</Text></View>
              <View style={[styles.cell, { width: '14%' }]}><Text>{it.receivedQty != null ? it.receivedQty : '—'}</Text></View>
              <View style={[styles.cell, { width: '10%' }]}><Text>{it.productUnit || '—'}</Text></View>
              <View style={[styles.cell, { width: '14%' }]}><Text>{it.batchNumber || '—'}</Text></View>
            </View>
          ))}
        </View>

        {notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{notes}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Received by', value: receivedBy ? `${receivedBy} • ${formatDateTime(date)}` : null },
          { label: 'PO Reference', value: orderNumber || null },
          { label: 'PR Reference', value: prNumber || null },
        ]} />

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  RAPS ERP  MIV {mivNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
