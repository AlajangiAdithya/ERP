import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Eye } from 'lucide-react';

// Generates the PDF on demand and opens it in a new browser tab so the user
// can read it in their built-in PDF viewer (or download from there if they
// really want to). No forced file download — viewing is enough.
export default function DownloadPdfButton({ document, fileName, label = 'View PDF', className = '' }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await pdf(document).toBlob();
      const url = URL.createObjectURL(blob);
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
