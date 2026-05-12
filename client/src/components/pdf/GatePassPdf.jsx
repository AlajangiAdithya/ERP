import { Document, Page, View, Text } from '@react-pdf/renderer';
import { styles, formatDate, formatDateTime, CompanyHeader, AuditTrail } from './shared';

const STATUS_LABEL = {
  DRAFT: 'Draft',
  PENDING_STORE: 'Pending Store Incharge',
  PENDING_ACCOUNTS: 'Pending Accounts (Final Approval)',
  PENDING_APPROVAL: 'Pending Accounts (Final Approval)',
  APPROVED: 'Approved',
  RETURNED: 'Returned',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  OPEN: 'Open',
};

const PASS_TYPE_LABEL = {
  RETURNABLE: 'Returnable',
  NON_RETURNABLE: 'Non-Returnable',
  DELIVERY_CHALLAN: 'Delivery Challan',
};

const TABLE_ROWS = 14;

const COLS = [
  { key: 'sno',         label: 'S.no',         width: '4%' },
  { key: 'description', label: 'Name of components', width: '14%' },
  { key: 'quantity',    label: 'Qty',          width: '5%' },
  { key: 'unit',        label: 'UOM',          width: '5%' },
  { key: 'dispatchedTo',label: 'Dispatched to',width: '10%' },
  { key: 'itemPurpose', label: 'Purpose',      width: '10%' },
  { key: 'probableReturnDate', label: 'Probable Date of Return', width: '9%' },
  { key: 'itemPassType',label: 'Gate pass type',width: '8%' },
  { key: 'gatePassDetails', label: 'Gate pass details', width: '10%' },
  { key: 'transportation', label: 'Transportation', width: '8%' },
  { key: 'contactPersonDetails', label: 'Remarks / Contact', width: '17%' },
];

const cellVal = (it, key, idx) => {
  if (!it) return '';
  if (key === 'sno') return String(idx + 1);
  if (key === 'probableReturnDate') return it.probableReturnDate ? formatDate(it.probableReturnDate) : '';
  if (key === 'itemPassType') return it.itemPassType ? PASS_TYPE_LABEL[it.itemPassType] : '';
  if (key === 'contactPersonDetails') return it.contactPersonDetails || it.remarks || '';
  return it[key] != null ? String(it[key]) : '';
};

export default function GatePassPdf({ data }) {
  const g = data || {};
  const items = g.items || [];
  const padded = [...items, ...Array(Math.max(0, TABLE_ROWS - items.length)).fill(null)];

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <CompanyHeader docType="GATE PASS REQUEST FORM" docNumber={g.passNumber} />

        <View style={styles.header}>
          <Text style={styles.title}>GATE PASS REQUEST FORM</Text>
          <Text style={styles.subtitle}>Doc. No.: RAMS/GPR/01</Text>
        </View>

        {/* Header meta row: Site, Request No, Date */}
        <View style={styles.table}>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '10%' }]}><Text>SITE</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{g.siteName || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '15%' }]}><Text>REQUEST No.</Text></View>
            <View style={[styles.cell, { width: '25%' }]}><Text>{g.passNumber || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '8%' }]}><Text>DATE</Text></View>
            <View style={[styles.cell, { width: '12%' }]}><Text>{formatDate(g.date)}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.cellLabel, { width: '10%' }]}><Text>STATUS</Text></View>
            <View style={[styles.cell, { width: '30%' }]}><Text>{STATUS_LABEL[g.status] || g.status || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '12%' }]}><Text>DRIVER</Text></View>
            <View style={[styles.cell, { width: '20%' }]}><Text>{g.driverName || '—'}</Text></View>
            <View style={[styles.cellLabel, { width: '12%' }]}><Text>VEHICLE No.</Text></View>
            <View style={[styles.cell, { width: '16%' }]}><Text>{g.vehicleNo || '—'}</Text></View>
          </View>
        </View>

        {/* Components table — 14 rows like the paper form */}
        <View style={styles.table}>
          <View style={styles.row}>
            {COLS.map((c) => (
              <View key={c.key} style={[styles.cellHeader, { width: c.width }]}>
                <Text>{c.label}</Text>
              </View>
            ))}
          </View>
          {padded.map((it, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              {COLS.map((c) => (
                <View key={c.key} style={[styles.cell, { width: c.width, minHeight: 16 }]}>
                  <Text>{cellVal(it, c.key, idx)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {g.remarks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Remarks</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{g.remarks}</Text></View>
          </View>
        )}

        {g.rejectedReason && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: '#b91c1c' }]}>Rejected — Reason</Text>
            <View style={[styles.cell, { padding: 6 }]}><Text>{g.rejectedReason}</Text></View>
          </View>
        )}

        <AuditTrail entries={[
          { label: 'Site Incharge', value: g.siteIncharge?.name ? `${g.siteIncharge.name} • ${formatDateTime(g.siteInchargeAt)}` : null },
          { label: 'Store Incharge', value: g.storeIncharge?.name ? `${g.storeIncharge.name} • ${formatDateTime(g.storeInchargeAt)}` : null },
          { label: 'Accounts (Final Approval)', value: g.accountsApprover?.name ? `${g.accountsApprover.name} • ${formatDateTime(g.accountsAt)}` : null },
          { label: 'Returned', value: g.returnedBy ? `${g.returnedBy} • ${formatDateTime(g.actualReturnDate)}` : null },
        ]} />

        {/* Footer signatures matching paper form */}
        <View style={[styles.sigRow, { marginTop: 16 }]}>
          <View style={[styles.sigBox, { width: '22%' }]}>
            <Text>SITE INCHARGE</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>
              {g.siteIncharge?.name || ''}
            </Text>
          </View>
          <View style={[styles.sigBox, { width: '22%' }]}>
            <Text>STORE INCHARGE</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>
              {g.storeIncharge?.name || ''}
            </Text>
          </View>
          <View style={[styles.sigBox, { width: '22%' }]}>
            <Text>ACCOUNTS PERSONNEL</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>
              {g.accountsApprover?.name || ''}
            </Text>
          </View>
          <View style={[styles.sigBox, { width: '22%' }]}>
            <Text>APPROVAL</Text>
            <Text style={{ fontSize: 7, color: '#555', marginTop: 2 }}>
              {g.finalApprover?.name || ''}
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Generated {formatDateTime(new Date())}  •  RAPS ERP  •  {g.passNumber || ''}
        </Text>
      </Page>
    </Document>
  );
}
