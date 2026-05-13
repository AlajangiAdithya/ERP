import { useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { Download } from 'lucide-react';

export default function DownloadPdfButton({ document, fileName, label = 'Download PDF', className = '' }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await pdf(document).toBlob();
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = fileName;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert(`Failed to generate PDF: ${err?.message || 'Unknown error'}`);
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
      <Download size={14} /> {busy ? 'Preparing…' : label}
    </button>
  );
}
