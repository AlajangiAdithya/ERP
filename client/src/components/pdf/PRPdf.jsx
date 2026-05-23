import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

const FIELD_COL_WIDTH = 110;

export default function PRPdf({ request }) {
  const items = request?.items || [];
  const materialCount = Math.max(items.length, 1);
  const materialColWidth = (540 - 48 - FIELD_COL_WIDTH) / materialCount; // page 595, minus padding

  const row = (label, getValue) => (
    <View style={styles.row} wrap={false}>
      <View style={[styles.cellLabel, { width: FIELD_COL_WIDTH }]}><Text>{label}</Text></View>
      {items.map((it, idx) => (
        <View key={idx} style={[styles.cell, { width: materialColWidth }]}>
          <Text>{getValue(it) || '—'}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <Document>
      <Page size="A4" style={styles.page} orientation={materialCount > 3 ? 'landscape' : 'portrait'}>
        <CompanyHeader docType="PURCHASE REQUISITION FORM" docNumber={request?.requestNumber} />
        <View style={styles.header}>
          <Text style={styles.title}>PURCHASE REQUISITION FORM</Text>
          <Text style={styles.subtitle}>Form No: RAPS/PRF  Rev. 02  Date: 31/08/2024</Text>
        </View>

        {/* Header fields */}
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>PR No.</Text></View>
            <View style={[styles.cell, { width: '35%' }]}><Text>{request?.requestNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>Date</Text></View>
            <View style={[styles.cell, { width: '35%' }]}><Text>{formatDate(request?.createdAt)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>Unit</Text></View>
            <View style={[styles.cell, { width: '35%' }]}><Text>{request?.unit?.name || request?.unit?.code || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>Indenter</Text></View>
            <View style={[styles.cell, { width: '35%' }]}><Text>{request?.manager?.name || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>PR No.</Text></View>
            <View style={[styles.cell, { width: '35%' }]}><Text>{request?.requestNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>Status</Text></View>
            <View style={[styles.cell, { width: '35%' }]}><Text>{request?.status || '—'}</Text></View>
          </View>
        </View>

        {/* Materials table: rows=fields, cols=materials */}
        <Text style={styles.sectionTitle}>Material Details</Text>
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellHeader, { width: FIELD_COL_WIDTH }]}><Text>Field</Text></View>
            {items.map((_, idx) => (
              <View key={idx} style={[styles.cellHeader, { width: materialColWidth }]}>
                <Text>Material-{idx + 1}</Text>
              </View>
            ))}
          </View>
          {row('Material Description', it => it.productName)}
          {row('Material Type', it => it.materialType)}
          {row('Material Specification', it => it.materialSpecification)}
          {row('Quantity', it => `${it.requestedQty || '—'}${it.adminApprovedQty != null ? ` (appr: ${it.adminApprovedQty})` : ''}`)}
          {row('UOM', it => it.productUnit)}
          {row('Drawing No.', it => it.drawingNo)}
          {row('QAP No.', it => it.qapNo)}
          {row('Required For', it => it.materialRequiredFor)}
          {row('Internal Work Order', it => it.internalWorkOrder)}
          {row('Purpose', it => it.purpose)}
          {row('Source of Supply', it => it.sourceOfSupply)}
          {row('Reports Required / Scope of Work', it => it.scopeOfWork)}
          {row('Inspection Type', it => it.inspectionType)}
          {row('Required By Date', it => formatDate(it.requiredByDate))}
          {row('Purchased Qty', it => it.purchasedQty || 0)}
          {row('Remarks', it => it.itemRemarks)}
        </View>

        {request?.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Manager's Notes</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{request.notes}</Text></View>
          </View>
        )}

        {request?.adminNotes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin Notes</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{request.adminNotes}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Created by', value: request?.manager?.name ? `${request.manager.name} • ${formatDateTime(request.createdAt)}` : null },
          { label: 'Admin approved', value: request?.adminApprovedBy?.name ? `${request.adminApprovedBy.name} • ${formatDateTime(request.adminApprovedAt)}` : null },
          { label: 'Store cleared', value: request?.storeManager?.name ? `${request.storeManager.name} • ${formatDateTime(request.clearedAt)}` : null },
          { label: 'Current status', value: request?.status || null },
        ]} />

        <View style={styles.sigRow}>
          <View style={styles.sigBox}><Text>Indenter</Text></View>
          <View style={styles.sigBox}><Text>Admin Approval</Text></View>
          <View style={styles.sigBox}><Text>Purchase Officer</Text></View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  RAPS ERP  PR {request?.requestNumber}
        </Text>
      </Page>
    </Document>
  );
}
