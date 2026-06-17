import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { LOGO_URL, formatDate } from './shared';

// Store Stock Label — a printable A5 (landscape) sticker to stick on the
// received material. One sticker per inwarded batch, carrying the key
// traceability fields Stores asked for: product, qty, arrived date, invoice no,
// MIR no, batch no, expiry, PO no, indenter. `batch` is a poBatch row whose
// `sourceQcInspection` holds the resolved PR → PO → lot chain.
const BORDER = '#222';
const GRID = '#bbb';

export function StickerPage({ product, batch }) {
  const b = batch || {};
  const insp = b.sourceQcInspection || {};
  const po = insp.purchaseOrder || {};
  const pr = po.purchaseRequest || {};
  const unit = product?.unit || '';

  const qty = b.quantity != null ? `${Number(b.quantity).toLocaleString('en-IN')} ${unit}`.trim() : '—';
  const expiry = insp.dateOfExpiry || b.dateOfExpiry || null;
  const rows = [
    ['QUANTITY', qty],
    ['BATCH NO.', b.batchNo || insp.batchNo || '—'],
    ['ARRIVED DATE', formatDate(b.receivedDate)],
    ['EXPIRY DATE', expiry ? formatDate(expiry) : '—'],
    ['INVOICE NO.', insp.invoiceNo || '—'],
    ['MIR NO.', po.mirNo || insp.mirNo || '—'],
    ['PO NUMBER', po.orderNumber || '—'],
    ['INDENTER', pr.manager?.name || '—'],
  ];

  return (
    <Page size="A5" orientation="landscape" style={{ padding: 18, fontFamily: 'Helvetica', color: '#111' }}>
      <View style={{ borderWidth: 2, borderColor: BORDER, padding: 14, height: '100%' }}>
        {/* Brand row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 8, marginBottom: 10 }}>
          <Image src={LOGO_URL} style={{ width: 96, height: 30, objectFit: 'contain' }} />
          <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#0a2540', letterSpacing: 1 }}>STORE STOCK LABEL</Text>
        </View>

        {/* Product name */}
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 8, color: '#666' }}>PRODUCT</Text>
          <Text style={{ fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#111' }}>{product?.name || '—'}</Text>
          {(product?.materialCode || product?.sku) && (
            <Text style={{ fontSize: 9, color: '#666' }}>{product.materialCode || product.sku}</Text>
          )}
        </View>

        {/* Traceability grid — 2 columns × 4 rows */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderLeftWidth: 1, borderColor: GRID }}>
          {rows.map(([label, value]) => (
            <View key={label} style={{ width: '50%', padding: 9, borderRightWidth: 1, borderBottomWidth: 1, borderColor: GRID }}>
              <Text style={{ fontSize: 8, color: '#666', letterSpacing: 0.4 }}>{label}</Text>
              <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#111' }}>{value || '—'}</Text>
            </View>
          ))}
        </View>

        <Text style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 7, color: '#999' }}>
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
