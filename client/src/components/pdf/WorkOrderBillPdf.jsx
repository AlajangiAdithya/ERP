import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, formatCurrency, CompanyHeader, AuditTrail } from './shared';

export default function WorkOrderBillPdf({ data }) {
  const b = data || {};
  const wo = b.workOrder || {};
  const items = Array.isArray(b.lineItems) ? b.lineItems : [];
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="TAX INVOICE / BILL" docNumber={b.billNumber} />

        <View style={styles.header}>
          <Text style={styles.title}>BILL</Text>
          <Text style={styles.subtitle}>Doc. No.: RAPS/BILL/01</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Bill No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{b.billNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Bill Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(b.billDate)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Work Order</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{wo.workOrderNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Supply Order</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{wo.supplyOrderNo || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>Customer</Text></View>
            <View style={[styles.cell, { width: '80%' }]}><Text>{wo.customerName || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>PDC Date</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatDate(b.pdcDate)}</Text></View>
            <View style={[styles.cellLabel, { width: '20%' }]}><Text>BG No.</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{b.bankGuaranteeNo || '—'}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Line Items</Text>
          <View style={styles.table}>
            <View style={styles.row}>
              <View style={[styles.cellHeader, { width: '6%' }]}><Text>S.no</Text></View>
              <View style={[styles.cellHeader, { width: '54%' }]}><Text>Description</Text></View>
              <View style={[styles.cellHeader, { width: '10%' }]}><Text>Qty</Text></View>
              <View style={[styles.cellHeader, { width: '15%' }]}><Text>Rate</Text></View>
              <View style={[styles.cellHeader, { width: '15%' }]}><Text>Amount</Text></View>
            </View>
            {items.length ? items.map((it, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <View style={[styles.cell, { width: '6%' }]}><Text>{i + 1}</Text></View>
                <View style={[styles.cell, { width: '54%' }]}><Text>{it.description || ''}</Text></View>
                <View style={[styles.cell, { width: '10%' }]}><Text>{it.qty || it.quantity || ''}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{formatCurrency(it.rate)}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{formatCurrency(it.amount)}</Text></View>
              </View>
            )) : (
              <View style={styles.row}>
                <View style={[styles.cell, { width: '100%', padding: 6 }]}>
                  <Text>No line items.</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cell, { width: '70%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}><Text>Subtotal</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatCurrency(b.subtotal)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cell, { width: '70%', textAlign: 'right', fontFamily: 'Helvetica-Bold' }]}><Text>GST</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{formatCurrency(b.gstAmount)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cell, { width: '70%', textAlign: 'right', fontFamily: 'Helvetica-Bold', backgroundColor: '#f0f0f0' }]}><Text>Total</Text></View>
            <View style={[styles.cell, { width: '30%', fontFamily: 'Helvetica-Bold', backgroundColor: '#f0f0f0' }]}><Text>{formatCurrency(b.total)}</Text></View>
          </View>
        </View>

        {b.remarks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remarks</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{b.remarks}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Bill Created', value: b.createdBy?.name ? `${b.createdBy.name} • ${formatDateTime(b.createdAt)}` : null },
          { label: 'QC Verified', value: wo.qcVerifiedBy?.name ? `${wo.qcVerifiedBy.name} • ${formatDateTime(wo.qcVerifiedAt)}` : null },
          { label: 'Mgmt Approved', value: wo.mgmtApprovedBy?.name ? `${wo.mgmtApprovedBy.name} • ${formatDateTime(wo.mgmtApprovedAt)}` : null },
        ]} />

        <View style={[styles.sigRow, { marginTop: 24 }]}>
          <View style={styles.sigBox}>
            <Text>PREPARED BY</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{b.createdBy?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>FINANCE HEAD</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>FOR RAPS</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  {b.billNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
