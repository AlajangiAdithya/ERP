import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

const FIELD_COL_WIDTH = 110;
const MATS_PER_PAGE = 5;
// Landscape A4 = 842pt wide; minus the 24pt page padding on both sides + the
// fixed Field column, the remaining width is split equally across the 5
// material slots so the table always looks the same regardless of how many
// items the manager actually filled in.
const PAGE_INNER_WIDTH = 842 - 48;
const MATERIAL_COL_WIDTH = (PAGE_INNER_WIDTH - FIELD_COL_WIDTH) / MATS_PER_PAGE;

// Split items into pages of exactly MATS_PER_PAGE slots. Pads the final page
// with `null` entries so empty cells still render — keeps the table grid
// consistent (e.g. 8 materials → page 1 fills all 5, page 2 shows 3 filled + 2 empty).
function chunkIntoPages(items) {
  if (!items || items.length === 0) return [[null, null, null, null, null]];
  const pages = [];
  for (let i = 0; i < items.length; i += MATS_PER_PAGE) {
    const slice = items.slice(i, i + MATS_PER_PAGE);
    while (slice.length < MATS_PER_PAGE) slice.push(null);
    pages.push(slice);
  }
  return pages;
}

export default function PRPdf({ request }) {
  const items = request?.items || [];
  const pages = chunkIntoPages(items);

  const MaterialsTable = ({ pageItems, pageIndex }) => {
    const row = (label, getValue) => (
      <View style={styles.row} wrap={false}>
        <View style={[styles.cellLabel, { width: FIELD_COL_WIDTH }]}><Text>{label}</Text></View>
        {pageItems.map((it, idx) => (
          <View key={idx} style={[styles.cell, { width: MATERIAL_COL_WIDTH }]}>
            <Text>{it ? (getValue(it) || '—') : ''}</Text>
          </View>
        ))}
      </View>
    );

    return (
      <View style={styles.table}>
        <View style={styles.row}>
          <View style={[styles.cellHeader, { width: FIELD_COL_WIDTH }]}><Text>Field</Text></View>
          {pageItems.map((it, idx) => {
            const globalIndex = pageIndex * MATS_PER_PAGE + idx + 1;
            return (
              <View key={idx} style={[styles.cellHeader, { width: MATERIAL_COL_WIDTH }]}>
                <Text>{it ? `Material-${globalIndex}` : ''}</Text>
              </View>
            );
          })}
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
    );
  };

  const HeaderBlock = () => (
    <>
      <CompanyHeader />
      <View style={styles.header}>
        <Text style={styles.title}>PURCHASE REQUISITION FORM</Text>
        <Text style={styles.subtitle}>Form No: RAPS/PRF  Rev. 02  Date: 31/08/2024</Text>
      </View>

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
          <View style={[styles.cellLabel, { width: '15%' }]}><Text>Status</Text></View>
          <View style={[styles.cell, { width: '85%' }]}><Text>{request?.status || '—'}</Text></View>
        </View>
      </View>
    </>
  );

  return (
    <Document>
      {pages.map((pageItems, pageIndex) => {
        const isLast = pageIndex === pages.length - 1;
        return (
          <Page key={pageIndex} size="A4" orientation="landscape" style={styles.page}>
            <HeaderBlock />

            <Text style={styles.sectionTitle}>
              Material Details {pages.length > 1 ? `(Page ${pageIndex + 1} of ${pages.length})` : ''}
            </Text>
            <MaterialsTable pageItems={pageItems} pageIndex={pageIndex} />

            {isLast && (
              <>
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
              </>
            )}

            <Text style={styles.footer} fixed>
              Generated {formatDateTime(new Date())}  RAPS ERP  PR {request?.requestNumber}  Page {pageIndex + 1} of {pages.length}
            </Text>
          </Page>
        );
      })}
    </Document>
  );
}
