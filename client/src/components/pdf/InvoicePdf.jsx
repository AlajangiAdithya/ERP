import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

// Per-lot invoice. No monetary amount — this is the doc Finance attaches to
// the material going to the customer. Pair it with the QC Verification
// Certificate + lot report as proof of completion.
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
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Lot No.</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>#{c.cycleNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Lot Qty</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{c.deliveryQty != null ? `${c.deliveryQty} ${wo.orderUnit || ''}` : '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Delivery Challan No.</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{c.deliveryChallanNumber || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Customer</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{wo.customerName || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>QC Certificate</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{c.qcCertificateNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Goods-Ack Deadline</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{formatDateTime(c.slaDeadlineAt)}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Materials in this Lot</Text>
          <View style={styles.table}>
            <View style={styles.row}>
              <View style={[styles.cellHeader, { width: '8%' }]}><Text>S.No</Text></View>
              <View style={[styles.cellHeader, { width: '62%' }]}><Text>Description</Text></View>
              <View style={[styles.cellHeader, { width: '15%' }]}><Text>Quantity</Text></View>
              <View style={[styles.cellHeader, { width: '15%' }]}><Text>UOM</Text></View>
            </View>
            {(c.items || []).length ? c.items.map((ci, i) => (
              <View key={ci.id || i} style={styles.row} wrap={false}>
                <View style={[styles.cell, { width: '8%' }]}><Text>{ci.item?.lineNo ?? i + 1}</Text></View>
                <View style={[styles.cell, { width: '62%' }]}><Text>{ci.item?.description || '—'}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{ci.deliveryQty}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{ci.item?.uom || ''}</Text></View>
              </View>
            )) : (
              <View style={styles.row}>
                <View style={[styles.cell, { width: '100%', padding: 6 }]}>
                  <Text>Lot qty: {c.deliveryQty != null ? `${c.deliveryQty} ${wo.orderUnit || ''}` : '—'}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scope / Description</Text>
          <View style={[styles.cell, { padding: 8 }]}>
            <Text>
              {c.invoiceDescription
                || `Delivery lot of ${c.deliveryQty ?? '—'} ${wo.orderUnit || ''} against Work Order ${wo.workOrderNumber || ''} for ${wo.customerName || ''}. Lot report verified by QC.`}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Goods Acknowledgement</Text>
          <View style={[styles.cell, { padding: 8 }]}>
            <Text>
              This invoice and the delivery challan travel with the material.
              Customer is requested to sign the goods-received acknowledgement
              and hand it back to the driver within 48 hours of dispatch.
              Monetary value is not included on this document — refer to the
              underlying Supply Order / contract for commercial terms.
            </Text>
          </View>
        </View>

        <AuditTrail entries={[
          { label: 'QC Verified',      value: c.qcVerifiedBy?.name ? `${c.qcVerifiedBy.name} • ${formatDateTime(c.qcVerifiedAt)}` : null },
          { label: 'Invoice Sent',     value: c.invoiceSentBy?.name ? `${c.invoiceSentBy.name} • ${formatDateTime(c.invoiceSentAt)}` : null },
          { label: 'DC Sent',          value: c.dcSentBy?.name ? `${c.dcSentBy.name} • ${formatDateTime(c.dcSentAt)}` : null },
          { label: 'Goods Ack',        value: c.deliveryAckBy?.name ? `${c.deliveryAckBy.name} • ${formatDateTime(c.deliveryAckAt)}` : null },
          { label: 'Payment Received', value: c.paymentReceivedBy?.name ? `${c.paymentReceivedBy.name} • ${formatDateTime(c.paymentReceivedAt)}` : null },
        ]} />

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  {c.invoiceNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
