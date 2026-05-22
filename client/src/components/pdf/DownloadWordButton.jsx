import { useState } from 'react';
import { FileText } from 'lucide-react';

// Renders an HTML document as a .doc file using the MS Word HTML wrapper.
// Word opens HTML-with-Word-XML namespace files natively as editable documents.
function buildWordDoc(html, title = 'Document') {
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page WordSection1 { size: A4; margin: 2cm; }
  div.WordSection1 { page: WordSection1; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #111; }
  h1, h2, h3 { color: #0a2540; margin: 0 0 6pt 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1pt solid #222; padding: 4pt; font-size: 10pt; vertical-align: top; }
  th { background: #eee; font-weight: bold; text-align: center; }
  .right { text-align: right; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 9pt; }
  .totalRow td { font-weight: bold; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6pt; }
  .stamp { text-align: right; font-size: 9pt; font-weight: bold; }
  hr { border: 0; border-top: 1pt solid #222; margin: 6pt 0; }
</style>
</head>
<body>
<div class='WordSection1'>
${html}
</div>
</body>
</html>`;
}

export default function DownloadWordButton({ html, fileName, label = 'Download Word', title }) {
  const [busy, setBusy] = useState(false);

  const handleClick = () => {
    if (busy) return;
    setBusy(true);
    try {
      const doc = buildWordDoc(html, title || fileName);
      const blob = new Blob(['\ufeff', doc], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = fileName.endsWith('.doc') ? fileName : `${fileName}.doc`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Word generation failed:', err);
      alert(`Failed to generate Word doc: ${err?.message || 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md transition-colors"
    >
      <FileText size={14} /> {busy ? 'Preparing…' : label}
    </button>
  );
}
