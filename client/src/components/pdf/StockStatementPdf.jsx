import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDateTime, formatDate, CompanyHeader, formatNotes } from './shared';

export default function StockStatementPdf({ movements = [], filters = {} }) {
  const { fromDate, toDate, typeFilter } = filters;

  const totalIn = movements.filter(m => m.type === 'IN').reduce((s, m) => s + (m.quantity || 0), 0);
  const totalOut = movements.filter(m => m.type === 'OUT').reduce((s, m) => s + (m.quantity || 0), 0);

  return (
    <Document>
      <Page size="A4" style={styles.page} orientation="landscape">
        <CompanyHeader docType="STOCK MOVEMENT REGISTER" />
        <View style={styles.header}>
          <Text style={styles.title}>STOCK MOVEMENT REGISTER</Text>
          <Text style={styles.subtitle}>
            {fromDate || toDate ? `Period: ${fromDate ? formatDate(fromDate) : '—'} to ${toDate ? formatDate(toDate) : '—'}` : 'All records'}
            {typeFilter ? `  Type: ${typeFilter}` : ''}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '13%' }]}><Text>Date</Text></View>
            <View style={[styles.cellHeader, { width: '22%' }]}><Text>Product</Text></View>
            <View style={[styles.cellHeader, { width: '10%' }]}><Text>SKU</Text></View>
            <View style={[styles.cellHeader, { width: '8%' }]}><Text>Type</Text></View>
            <View style={[styles.cellHeader, { width: '7%' }]}><Text>Qty</Text></View>
            <View style={[styles.cellHeader, { width: '6%' }]}><Text>UOM</Text></View>
            <View style={[styles.cellHeader, { width: '14%' }]}><Text>Batch</Text></View>
            <View style={[styles.cellHeader, { width: '9%' }]}><Text>Ref Type</Text></View>
            <View style={[styles.cellHeader, { width: '11%' }]}><Text>Notes</Text></View>
          </View>
          {movements.length === 0 ? (
            <View style={styles.row}>
              <View style={[styles.cell, { width: '100%', textAlign: 'center', padding: 8 }]}>
                <Text>No movements found for the selected filters</Text>
              </View>
            </View>
          ) : movements.map((m, idx) => (
            <View key={m.id || idx} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: '13%' }]}><Text>{formatDateTime(m.createdAt)}</Text></View>
              <View style={[styles.cell, { width: '22%' }]}><Text>{m.product?.name || '—'}</Text></View>
              <View style={[styles.cell, { width: '10%' }]}><Text>{m.product?.sku || '—'}</Text></View>
              <View style={[styles.cell, { width: '8%' }]}><Text>{m.type}</Text></View>
              <View style={[styles.cell, { width: '7%' }]}><Text>{m.quantity}</Text></View>
              <View style={[styles.cell, { width: '6%' }]}><Text>{m.product?.unit || '—'}</Text></View>
              <View style={[styles.cell, { width: '14%' }]}><Text>{m.batchNumber || '—'}</Text></View>
              <View style={[styles.cell, { width: '9%' }]}><Text>{m.referenceType || '—'}</Text></View>
              <View style={[styles.cell, { width: '11%' }]}><Text>{formatNotes(m.notes).slice(0, 80)}</Text></View>
            </View>
          ))}
        </View>

        {movements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <View style={styles.table}>
              <View style={styles.row}>
                <View style={[styles.cellLabel, { width: '25%' }]}><Text>Total IN (quantity)</Text></View>
                <View style={[styles.cell, { width: '25%' }]}><Text>{totalIn}</Text></View>
                <View style={[styles.cellLabel, { width: '25%' }]}><Text>Total OUT (quantity)</Text></View>
                <View style={[styles.cell, { width: '25%' }]}><Text>{totalOut}</Text></View>
              </View>
              <View style={styles.row}>
                <View style={[styles.cellLabel, { width: '25%' }]}><Text>Net movements</Text></View>
                <View style={[styles.cell, { width: '75%' }]}><Text>{movements.length} records</Text></View>
              </View>
            </View>
          </View>
        )}

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  RAPS ERP Stock Statement
        </Text>
      </Page>
    </Document>
  );
}
