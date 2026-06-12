import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

export default function QCVerificationCertificatePdf({ data }) {
  const w = data || {};
  const docs = (w.closureDocs || []).filter((d) => d.stage === 'UNIT_DOCS_PENDING');
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <CompanyHeader docType="QC VERIFICATION CERTIFICATE" docNumber={w.qcCertificateNumber} />

        <View style={styles.header}>
          <Text style={styles.title}>QC VERIFICATION CERTIFICATE</Text>
          <Text style={styles.subtitle}>Doc. No.: RAPS/QC/CERT/01</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Certificate No.</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{w.qcCertificateNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Date</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{formatDate(w.qcVerifiedAt)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Work Order No.</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{w.workOrderNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Supply Order</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{w.supplyOrderNo || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Customer</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{w.customerName || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Lot Qty</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{w.orderQuantity} {w.orderUnit || ''}</Text></View>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>PDC Date</Text></View>
            <View style={[styles.cell, { width: '28%' }]}><Text>{formatDate(w.pdcDate)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>Inspection Agency</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{w.inspectionAgency || '—'}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '22%' }]}><Text>QAP No.</Text></View>
            <View style={[styles.cell, { width: '78%' }]}><Text>{w.qapNo || '—'}</Text></View>
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
            {(w.items || []).length ? w.items.map((it, i) => (
              <View key={i} style={styles.row} wrap={false}>
                <View style={[styles.cell, { width: '8%' }]}><Text>{i + 1}</Text></View>
                <View style={[styles.cell, { width: '62%' }]}><Text>{it.description || '—'}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{it.deliveryQty}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{it.uom || ''}</Text></View>
              </View>
            )) : (
              <View style={styles.row}>
                <View style={[styles.cell, { width: '100%', padding: 6 }]}>
                  <Text>Lot qty: {w.orderQuantity} {w.orderUnit || ''}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Declaration</Text>
          <View style={[styles.cell, { padding: 8 }]}>
            <Text>
              This is to certify that the work executed under Work Order
              {' '}{w.workOrderNumber || ''}{' '}for{' '}{w.customerName || ''}{' '}
              has been verified against the supplied closure documentation
              (work-completion report, test reports, dispatch checklist and
              supporting evidence). The work is found to be in compliance with
              the applicable QAP / inspection-agency requirements.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Documents Reviewed</Text>
          <View style={styles.table}>
            <View style={styles.row}>
              <View style={[styles.cellHeader, { width: '6%' }]}><Text>#</Text></View>
              <View style={[styles.cellHeader, { width: '30%' }]}><Text>Doc Type</Text></View>
              <View style={[styles.cellHeader, { width: '34%' }]}><Text>File</Text></View>
              <View style={[styles.cellHeader, { width: '15%' }]}><Text>Uploaded By</Text></View>
              <View style={[styles.cellHeader, { width: '15%' }]}><Text>Uploaded At</Text></View>
            </View>
            {docs.length ? docs.map((d, i) => (
              <View key={d.id || i} style={styles.row} wrap={false}>
                <View style={[styles.cell, { width: '6%' }]}><Text>{i + 1}</Text></View>
                <View style={[styles.cell, { width: '30%' }]}><Text>{d.docType}</Text></View>
                <View style={[styles.cell, { width: '34%' }]}><Text>{d.fileName || '—'}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{d.uploadedBy?.name || '—'}</Text></View>
                <View style={[styles.cell, { width: '15%' }]}><Text>{formatDate(d.uploadedAt)}</Text></View>
              </View>
            )) : (
              <View style={styles.row}>
                <View style={[styles.cell, { width: '100%', padding: 6 }]}>
                  <Text>No documents recorded.</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <AuditTrail entries={[
          { label: 'Unit Submission', value: w.unitDocsSubmittedBy?.name ? `${w.unitDocsSubmittedBy.name} • ${formatDateTime(w.unitDocsSubmittedAt)}` : null },
          { label: 'QC Verified', value: w.qcVerifiedBy?.name ? `${w.qcVerifiedBy.name} • ${formatDateTime(w.qcVerifiedAt)}` : null },
        ]} />

        <View style={[styles.sigRow, { marginTop: 24 }]}>
          <View style={styles.sigBox}>
            <Text>UNIT INCHARGE</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{w.unitDocsSubmittedBy?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>QC VERIFIER</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>{w.qcVerifiedBy?.name || ''}</Text>
          </View>
          <View style={styles.sigBox}>
            <Text>QC HEAD</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  {w.qcCertificateNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
