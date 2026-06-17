import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { LOGO_URL, formatDate } from './shared';

// Store Stock Label — a printable sticker to stick on the received material.
// One sticker per inwarded batch, carrying the key traceability fields Stores
// asked for: product, qty, arrived date, invoice no, batch no, expiry, PO no,
// indenter. `batch` is a poBatch row whose `sourceQcInspection` holds the chain.
const BORDER = '#222';
const GRID = '#bbb';

function Field({ label, value, full }) {
  return (
    <View style={[
      { width: full ? '100%' : '50%', padding: 5, borderColor: GRID, borderBottomWidth: 1 },
      full ? {} : { borderRightWidth: 1 },
    ]}>
      <Text style={{ fontSize: 7, color: '#666', letterSpacing: 0.4 }}>{label}</Text>
      <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#111' }}>{value || '—'}</Text>
    </View>
  );
}

export function StickerPage({ product, batch }) {
  const b = batch || {};
  const insp = b.sourceQcInspection || {};
  const po = insp.purchaseOrder || {};
  const pr = po.purchaseRequest || {};
  const unit = product?.unit || '';
  const qty = b.quantity != null ? `${Number(b.quantity).toLocaleString('en-IN')} ${unit}`.trim() : '—';
  const batchNo = b.batchNo || insp.batchNo || '—';
  const expiry = insp.dateOfExpiry || b.dateOfExpiry || null;
  const invoiceNo = insp.invoiceNo || '—';
  const poNumber = po.orderNumber || '—';
  const indenter = pr.manager?.name || '—';

  return (
    <Page size="A6" style={{ padding: 14, fontFamily: 'Helvetica', color: '#111' }}>
      <View style={{ borderWidth: 2, borderColor: BORDER, padding: 10, height: '100%' }}>
        {/* Brand row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 6, marginBottom: 8 }}>
          <Image src={LOGO_URL} style={{ width: 72, height: 22, objectFit: 'contain' }} />
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0a2540' }}>STORE STOCK LABEL</Text>
        </View>

        {/* Product name */}
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 7, color: '#666' }}>PRODUCT</Text>
          <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111' }}>{product?.name || '—'}</Text>
          {(product?.materialCode || product?.sku) && (
            <Text style={{ fontSize: 8, color: '#666' }}>{product.materialCode || product.sku}</Text>
          )}
        </View>

        {/* Traceability grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: GRID, borderBottomWidth: 0 }}>
          <Field label="QUANTITY" value={qty} />
          <Field label="BATCH NO." value={batchNo} />
          <Field label="ARRIVED DATE" value={formatDate(b.receivedDate)} />
          <Field label="EXPIRY DATE" value={expiry ? formatDate(expiry) : '—'} />
          <Field label="INVOICE NO." value={invoiceNo} />
          <Field label="PO NUMBER" value={poNumber} />
          <Field label="INDENTER" value={indenter} full />
        </View>

        <Text style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 6, color: '#999' }}>
          {insp.inspectionNumber ? `Ref: ${insp.inspectionNumber}` : ''}
        </Text>
      </View>
    </Page>
  );
}

export default function ProductStickerPdf({ product, batches }) {
  const list = Array.isArray(batches) ? batches : (batches ? [batches] : []);
  return (
    <Document>
      {list.length
        ? list.map((b) => <StickerPage key={b.id} product={product} batch={b} />)
        : <StickerPage product={product} batch={{}} />}
    </Document>
  );
}
