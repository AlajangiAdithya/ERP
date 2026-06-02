import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

// Closure-cycle invoice. No monetary amount — this is the doc Finance sends
// to the customer to start the 48h payment-confirmation window. Pair it with
// the QC Verification Certificate + closure docs as proof of completion.
export default function InvoicePdf({ data }) {
  const c = data || {};
  const wo = c.workOrder || {};
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="INVOICE" docNumber={c.invoiceNumber} />

        <View style={styles.header}>
          <Text style={styles.title}>INVOICE</Text>
          <Text style={styles.subtitle}>Doc. No.: RAPS/INV/01</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Invoice No.</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{c.invoiceNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Invoice Date</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{formatDate(c.invoiceDate)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Work Order</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{wo.workOrderNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Supply Order</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{wo.supplyOrderNo || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Closure Cycle</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>#{c.cycleNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Batch Qty</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{c.deliveryQty != null ? `${c.deliveryQty} ${wo.orderUnit || ''}` : '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Customer</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{wo.customerName || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Nomenclature</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{wo.nomenclature || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>QC Certificate</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{c.qcCertificateNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>SLA Deadline</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{formatDateTime(c.slaDeadlineAt)}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scope / Description</Text>
          <View style={[styles.cell, { padding: 8 }]}>
            <Text>
              {c.invoiceDescription
                || `Delivery batch of ${c.deliveryQty ?? '—'} ${wo.orderUnit || ''} against Work Order ${wo.workOrderNumber || ''} for ${wo.customerName || ''}. Closure documentation verified by QC and approved by Level-5 management.`}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Window</Text>
          <View style={[styles.cell, { padding: 8 }]}>
            <Text>
              This invoice is issued under the RAPS closure SLA. Customer is
              requested to confirm receipt of payment within 48 hours of issue
              to allow Accounts to close this delivery cycle. Monetary value is
              not included on this document — refer to the underlying Supply
              Order / contract for commercial terms.
            </Text>
          </View>
        </View>

        <AuditTrail entries={[
          { label: 'QC Verified',     value: c.qcVerifiedBy?.name ? `${c.qcVerifiedBy.name} • ${formatDateTime(c.qcVerifiedAt)}` : null },
          { label: 'Mgmt Approved',   value: c.mgmtApprovedBy?.name ? `${c.mgmtApprovedBy.name} • ${formatDateTime(c.mgmtApprovedAt)}` : null },
          { label: 'Invoice Sent',    value: c.invoiceSentBy?.name ? `${c.invoiceSentBy.name} • ${formatDateTime(c.invoiceSentAt)}` : null },
          { label: 'Payment Received', value: c.paymentReceivedBy?.name ? `${c.paymentReceivedBy.name} • ${formatDateTime(c.paymentReceivedAt)}` : null },
        ]} />

        <View style={[styles.sigRow, { marginTop: 24 }]}>
          <View style={styles.sigBox}>
            <Text>FINANCE</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{c.invoiceSentBy?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>FOR RAPS</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>CUSTOMER ACK.</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  {c.invoiceNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
