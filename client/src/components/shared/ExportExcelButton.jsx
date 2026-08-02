import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import api from '../../api/axios';
import Button from '../ui/Button';
import { saveBlobResponse, blobErrorMessage } from '../../utils/download';

/**
 * "Export Excel" button for any endpoint that streams an .xlsx back.
 *
 * The server decides the contents and the filename — this only carries the
 * caller's current filters across so the download always matches the list the
 * user is looking at, never the whole table.
 *
 * Props:
 *  - endpoint: API path that returns the workbook (e.g. '/purchase-requests/export')
 *  - params:   query params to forward (status / date range from the page filters)
 *  - fileName: fallback name if the response carries no Content-Disposition
 *  - label:    button text (default "Export Excel")
 */
export default function ExportExcelButton({
  endpoint,
  params = {},
  fileName = 'export.xlsx',
  label = 'Export Excel',
  variant = 'secondary',
  size = 'md',
  disabled = false,
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.get(endpoint, { params, responseType: 'blob' });
      saveBlobResponse(res, fileName);
    } catch (err) {
      alert(await blobErrorMessage(err, 'Could not generate the Excel file. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={run} loading={busy} disabled={disabled}>
      {!busy && <FileSpreadsheet size={16} />}
      {busy ? 'Preparing…' : label}
    </Button>
  );
}
