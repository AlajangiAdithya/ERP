import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, formatCurrency, CompanyHeader, AuditTrail } from './shared';

export default function POPdf({ order }) {
  const items = order?.items || [];
  const totalPaid = order?.totalPaid || 0;
  const remaining = (order?.totalAmount || 0) - totalPaid;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="PURCHASE ORDER" docNumber={order?.orderNumber} />
        <View style={styles.header}>
          <Text style={styles.title}>PURCHASE ORDER</Text>
          <Text style={styles.subtitle}>Form No: RAPS/PO  RAPS ERP</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Date</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{formatDate(order?.createdAt)}</Text></View>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Status</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{order?.status || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>PR No.</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{order?.purchaseRequest?.requestNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Indenter</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{order?.purchaseRequest?.manager?.name || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Unit</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{order?.purchaseRequest?.unit?.name || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>MIR No.</Text></View>
            <View style={[styles.cell, { width: '32%' }]}><Text>{order?.mirNo || '—'}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Supplier</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '18%' }]}><Text>Name</Text></View>
            <View style={[styles.cell, { width: '82%' }]}><Text>{order?.supplierName || '—'}</Text></View>
          </View>
          {order?.quotation?.supplierContact && (
            <View style={styles.row}>
              <View style={[styles.cellLabel, { width: '18%' }]}><Text>Contact</Text></View>
              <View style={[styles.cell, { width: '82%' }]}><Text>{order.quotation.supplierContact}</Text></View>
            </View>
          )}
          {order?.quotation?.supplierAddress && (
            <View style={styles.row}>
              <View style={[styles.cellLabel, { width: '18%' }]}><Text>Address</Text></View>
              <View style={[styles.cell, { width: '82%' }]}><Text>{order.quotation.supplierAddress}</Text></View>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Items</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: '6%' }]}><Text>#</Text></View>
            <View style={[styles.cellHeader, { width: '38%' }]}><Text>Product</Text></View>
            <View style={[styles.cellHeader, { width: '12%' }]}><Text>Qty</Text></View>
            <View style={[styles.cellHeader, { width: '10%' }]}><Text>UOM</Text></View>
            <View style={[styles.cellHeader, { width: '17%' }]}><Text>Unit Price</Text></View>
            <View style={[styles.cellHeader, { width: '17%' }]}><Text>Total</Text></View>
          </View>
          {items.map((item, idx) => (
            <View key={item.id || idx} style={styles.row} wrap={false}>
              <View style={[styles.cell, { width: '6%' }]}><Text>{idx + 1}</Text></View>
              <View style={[styles.cell, { width: '38%' }]}><Text>{item.productName}</Text></View>
              <View style={[styles.cell, { width: '12%' }]}><Text>{item.quantity}</Text></View>
              <View style={[styles.cell, { width: '10%' }]}><Text>{item.productUnit}</Text></View>
              <View style={[styles.cell, { width: '17%' }]}><Text>{formatCurrency(item.unitPrice)}</Text></View>
              <View style={[styles.cell, { width: '17%' }]}><Text>{formatCurrency(item.totalPrice)}</Text></View>
            </View>
          ))}
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '83%', textAlign: 'right' }]}><Text>Grand Total</Text></View>
            <View style={[styles.cellLabel, { width: '17%' }]}><Text>{formatCurrency(order?.totalAmount)}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Payment Summary</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '33%' }]}><Text>Advance Paid</Text></View>
            <View style={[styles.cellLabel, { width: '33%' }]}><Text>Total Paid</Text></View>
            <View style={[styles.cellLabel, { width: '34%' }]}><Text>Balance</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cell, { width: '33%' }]}><Text>{formatCurrency(order?.advancePaid)}</Text></View>
            <View style={[styles.cell, { width: '33%' }]}><Text>{formatCurrency(totalPaid)}</Text></View>
            <View style={[styles.cell, { width: '34%' }]}><Text>{formatCurrency(remaining)}</Text></View>
          </View>
        </View>

        <AuditTrail entries={[
          { label: 'PO created by', value: order?.createdBy?.name ? `${order.createdBy.name} • ${formatDateTime(order.createdAt)}` : null },
          { label: 'Quotation approved', value: order?.quotation?.selectedBy?.name ? `${order.quotation.selectedBy.name} • ${formatDateTime(order.quotation.selectedAt)}` : null },
          { label: 'Goods arrived', value: order?.goodsArrivedAt ? formatDateTime(order.goodsArrivedAt) : null },
        ]} />

        <View style={styles.sigRow}>
          <View style={styles.sigBox}><Text>Purchase Officer</Text></View>
          <View style={styles.sigBox}><Text>Admin / Approver</Text></View>
          <View style={styles.sigBox}><Text>Supplier Acknowledgement</Text></View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  RAPS ERP  PO {order?.orderNumber}
        </Text>
      </Page>
    </Document>
  );
}
