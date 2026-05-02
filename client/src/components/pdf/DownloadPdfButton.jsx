import { PDFDownloadLink } from '@react-pdf/renderer';
import { Download } from 'lucide-react';

export default function DownloadPdfButton({ document, fileName, label = 'Download PDF', className = '' }) {
  return (
    <PDFDownloadLink
      document={document}
      fileName={fileName}
      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-navy-700 hover:bg-navy-800 text-white rounded-md transition-colors ${className}`}
    >
      {({ loading }) => (
        <>
          <Download size={14} /> {loading ? 'Preparing…' : label}
        </>
      )}
    </PDFDownloadLink>
  );
}
