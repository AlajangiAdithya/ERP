import { Document, Page, View, Text } from '@react-pdf/renderer';
import { formatDate } from './shared';

// Store Stock Label — content-only, paper-saving. No logo, no decorative
// border: just the traceability table. Several stickers pack onto one A4 sheet
// (each block stays whole, never split across a page) so printing wastes no
// paper. One block per inwarded batch; `sourceQcInspection` holds the chain.
const LINE = '#999';
const cell = { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: LINE, paddingVertical: 3, paddingHorizontal: 5, justifyContent: 'center' };

function KV({ w, label, value, big }) {
  return (
    <View style={[cell, { width: w }]}>
      <Text style={{ fontSize: 6.5, color: '#666', letterSpacing: 0.3 }}>{label}</Text>
      <Text style={{ fontSize: big ? 13 : 9.5, fontFamily: 'Helvetica-Bold', color: '#111' }}>{value || '—'}</Text>
    </View>
  );
}

function StickerBlock({ product, batch }) {
  const b = batch || {};
  const insp = b.sourceQcInspection || {};
  const po = insp.purchaseOrder || {};
  const pr = po.purchaseRequest || {};
  const unit = product?.unit || '';
  const qty = b.quantity != null ? `${Number(b.quantity).toLocaleString('en-IN')} ${unit}`.trim() : '—';
  const expiry = insp.dateOfExpiry || b.dateOfExpiry || null;
  const name = `${product?.name || '—'}${(product?.materialCode || product?.sku) ? `   ·   ${product.materialCode || product.sku}` : ''}`;

  return (
    <View wrap={false} style={{ borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: LINE, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row' }}>
        <KV w="100%" label="PRODUCT" value={name} big />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <KV w="25%" label="QUANTITY" value={qty} />
        <KV w="25%" label="BATCH NO." value={b.batchNo || insp.batchNo || '—'} />
        <KV w="25%" label="ARRIVED DATE" value={formatDate(b.receivedDate)} />
        <KV w="25%" label="EXPIRY DATE" value={expiry ? formatDate(expiry) : '—'} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <KV w="25%" label="INVOICE NO." value={insp.invoiceNo || '—'} />
        <KV w="25%" label="MIR NO." value={po.mirNo || insp.mirNo || '—'} />
        <KV w="25%" label="PO NUMBER" value={po.orderNumber || '—'} />
        <KV w="25%" label="INDENTER" value={pr.manager?.name || '—'} />
      </View>
    </View>
  );
}

export default function ProductStickerPdf({ product, batches }) {
  const list = Array.isArray(batches) ? batches : (batches ? [batches] : []);
  const items = list.length ? list : [{}];
  return (
    <Document>
      <Page size="A4" style={{ padding: 24, fontFamily: 'Helvetica', color: '#111' }}>
        {items.map((b, i) => <StickerBlock key={b.id || i} product={product} batch={b} />)}
      </Page>
    </Document>
  );
}
