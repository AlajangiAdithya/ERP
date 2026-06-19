import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import { Eye } from 'lucide-react';

// Generates the PDF on demand and opens it in a new browser tab so the user
// can read it in their built-in PDF viewer (or download from there if they
// really want to). No forced file download — viewing is enough.
//
// `appendPdfs` (optional) — list of public file URLs to merge AFTER the main
// document (used by the PR view to append per-item confidential spec files
// without exposing them as a column inside the PR table itself). PDFs are
// concatenated page-for-page; JPG/PNG specs are embedded each on their own page.
export default function DownloadPdfButton({ document, fileName, label = 'View PDF', className = '', appendPdfs = null }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await pdf(document).toBlob();
      const attachments = Array.isArray(appendPdfs) ? appendPdfs.filter(Boolean) : [];
      let finalBlob = blob;

      if (attachments.length > 0) {
        // Merge the @react-pdf output with each spec PDF using pdf-lib. Failed
        // fetches are skipped silently — a missing attachment shouldn't block
        // the main PR from opening.
        try {
          const mainBytes = await blob.arrayBuffer();
          const merged = await PDFDocument.load(mainBytes);
          for (const url of attachments) {
            try {
              const resp = await fetch(url);
              if (!resp.ok) continue;
              const bytes = await resp.arrayBuffer();
              const ct = (resp.headers.get('content-type') || '').toLowerCase();
              const isJpg = ct.includes('jpeg') || ct.includes('jpg') || /\.jpe?g(\?|$)/i.test(url);
              const isPng = ct.includes('png') || /\.png(\?|$)/i.test(url);
              if (isJpg || isPng) {
                // Image spec (scan/photo) — embed it on its own full page sized
                // to the image so nothing is cropped.
                const img = isJpg ? await merged.embedJpg(bytes) : await merged.embedPng(bytes);
                const page = merged.addPage([img.width, img.height]);
                page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
              } else {
                const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
                const pages = await merged.copyPages(src, src.getPageIndices());
                pages.forEach((p) => merged.addPage(p));
              }
            } catch (mergeErr) {
              console.warn('Skipped attachment', url, mergeErr);
            }
          }
          const mergedBytes = await merged.save();
          finalBlob = new Blob([mergedBytes], { type: 'application/pdf' });
        } catch (mergeErr) {
          console.warn('PDF merge failed — opening main document only', mergeErr);
          finalBlob = blob;
        }
      }

      const url = URL.createObjectURL(finalBlob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert(`Failed to open PDF: ${err?.message || 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-navy-700 hover:bg-navy-800 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md transition-colors ${className}`}
    >
      <Eye size={14} /> {busy ? 'Opening…' : label}
    </button>
  );
}
