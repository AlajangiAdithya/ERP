import { formatDate } from './shared';

const escapeHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Indian-style amount: 23,20,000-00
const formatINR = (n) => {
  const num = Number(n || 0);
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  return `${rupees.toLocaleString('en-IN')}-${String(paise).padStart(2, '0')}`;
};

export function buildPOWordHtml(order) {
  const items = order?.items || [];
  const pr = order?.purchaseRequest;
  const quotation = order?.quotation;

  const supplierName = order?.supplierName || quotation?.supplierName || '—';
  const supplierAddress = quotation?.supplierAddress || '';
  const supplierContact = quotation?.supplierContact || '';
  const addressLines = supplierAddress
    ? supplierAddress.split(/\r?\n|,\s*/).map(x => x.trim()).filter(Boolean)
    : [];

  // Subject: prefer customName, else first 3 product names
  const subjectMaterials = items.slice(0, 3).map(i => i.productName).filter(Boolean).join(', ');
  const subjectMore = items.length > 3 ? `, +${items.length - 3} more` : '';
  const totalQtyText = items
    .map(i => `${i.quantity}-${i.productUnit || ''}`)
    .join(', ');
  const subject = order?.customName
    ? `Purchase Order for supply of ${order.customName}`
    : `Purchase Order for supply of ${subjectMaterials}${subjectMore} ${totalQtyText ? `- ${totalQtyText}` : ''}`.trim();

  // Determine the most common unit for the "Rate Per X" column header
  const unitCounts = items.reduce((acc, i) => {
    const u = (i.productUnit || 'unit').toLowerCase();
    acc[u] = (acc[u] || 0) + 1;
    return acc;
  }, {});
  const dominantUnit = Object.entries(unitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unit';

  const itemsRows = items.map((it, idx) => `
    <tr>
      <td class='center' style='width:7%;'>${idx + 1}</td>
      <td style='width:48%;'>${escapeHtml(it.productName || '')}</td>
      <td class='center' style='width:15%;'>${escapeHtml(`${it.quantity} ${it.productUnit || ''}`)}</td>
      <td class='right' style='width:15%;'>${formatINR(it.unitPrice)}</td>
      <td class='right' style='width:15%;'>${formatINR(it.totalPrice)}</td>
    </tr>
  `).join('');

  return `
    <!-- Form no. block — top right (no letterhead) -->
    <table style='border:0; margin-bottom:6pt;'>
      <tr style='border:0;'>
        <td style='border:0; text-align:right;' colspan='2'>
          <span style='font-size:9pt;'>Form no.: RAPS/PO Rev 01</span>
        </td>
      </tr>
      <tr style='border:0;'>
        <td style='border:0; text-align:right;' colspan='2'>
          <span style='font-size:9pt;'>Dt: 05/06/2024</span>
        </td>
      </tr>
    </table>

    <!-- Ref + Date row -->
    <table style='border:0; margin-bottom:6pt;'>
      <tr style='border:0;'>
        <td style='border:0; font-weight:bold;'>Ref: ${escapeHtml(order?.orderNumber || '—')}</td>
        <td style='border:0; font-weight:bold; text-align:right;'>Date: ${escapeHtml(formatDate(order?.createdAt))}</td>
      </tr>
      <tr style='border:0;'>
        <td style='border:0; font-weight:bold;' colspan='2'>PR No: ${escapeHtml(pr?.requestNumber || '—')} &nbsp; Dt: ${escapeHtml(formatDate(pr?.createdAt))}</td>
      </tr>
    </table>

    <!-- To block -->
    <p style='margin:0 0 2pt 0;'>To</p>
    <p style='margin:0; font-weight:bold;'>M/s ${escapeHtml(supplierName)}</p>
    ${addressLines.map(l => `<p style='margin:0;'>${escapeHtml(l)}</p>`).join('')}
    ${supplierContact ? `<p style='margin:2pt 0 0 0;'>Kind Attn: ${escapeHtml(supplierContact)}</p>` : ''}

    <p style='margin-top:10pt;'>Dear Sir,</p>
    <p style='font-weight:bold;'>Subject: ${escapeHtml(subject)}.</p>
    ${quotation?.quotationNumber ? `<p>Ref: Your Quotation No: ${escapeHtml(quotation.quotationNumber)} Dt: ${escapeHtml(formatDate(quotation.createdAt))}</p>` : ''}

    <p>With reference to the above, we are pleased to place an order on you for the supply of following item${items.length > 1 ? 's' : ''}.</p>

    <!-- Items table -->
    <table>
      <thead>
        <tr>
          <th style='width:7%;'>Sl. No</th>
          <th style='width:48%;'>Material Description and Specification</th>
          <th style='width:15%;'>Qty</th>
          <th style='width:15%;'>Rate Per ${escapeHtml(dominantUnit)}</th>
          <th style='width:15%;'>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
        <tr class='totalRow'>
          <td colspan='4' class='right'><b>Total</b></td>
          <td class='right'><b>${formatINR(order?.totalAmount)}</b></td>
        </tr>
      </tbody>
    </table>

    <p style='margin-top:6pt;'><i>Note: Test reports shall be provided along with the invoice at the time of delivery.</i></p>

    <p><b>Terms &amp; Conditions:</b></p>
    <p style='margin:0;'>GST: Extra @18% or as applicable.</p>
    <p style='margin:0;'>Payment: Mutually agreeable terms.</p>
    <p style='margin:0;'>Delivery: As mutually agreed from the date of PO.</p>
    <p style='margin:0;'>Packing: Standard packing to avoid transit damage.</p>
    <p style='margin:0;'>Inspection: As per RAPS QA / Customer QA standard.</p>
    <p style='margin:0;'>Please mention our PO number in invoice copy.</p>
    <p style='margin:0;'>For all other terms and conditions refer annexure attached.</p>
    <p style='margin:0;'>Jurisdiction: Any disputes shall be subject to the jurisdiction of Vijayawada.</p>

    <p style='margin-top:18pt;'>Thanking you,</p>
    <p style='margin:0;'>Yours sincerely,</p>
    <p style='margin:0;'>For Ramesh's Aerospace Products &amp; Services Pvt. Ltd.,</p>

    <p style='margin-top:36pt;'>(${escapeHtml(order?.createdBy?.name || 'Authorised Signatory')})</p>
  `;
}
