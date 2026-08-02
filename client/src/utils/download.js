// Browser-side file download helpers for API endpoints that stream a file back
// (Excel exports, generated documents) instead of JSON.

// Pulls the server's filename out of Content-Disposition. Handles both the plain
// `filename="x.xlsx"` form and the RFC 5987 `filename*=UTF-8''x.xlsx` form.
export function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;\n]+)/i.exec(disposition);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1]); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";\n]+)"?/i.exec(disposition);
  return plain?.[1] || fallback;
}

// Saves an axios blob response to disk. The object URL is revoked on the next
// tick — revoking it synchronously cancels the download in Safari/iOS.
export function saveBlobResponse(response, fallbackName) {
  const name = filenameFromDisposition(response?.headers?.['content-disposition'], fallbackName);
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

// A failed download still arrives as a Blob (responseType: 'blob' applies to error
// responses too), so the server's JSON error message has to be read back out of it
// before it can be shown to the user.
export async function blobErrorMessage(error, fallback = 'Download failed') {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed?.error) return parsed.error;
    } catch { /* not JSON — fall through to the generic message */ }
  }
  return data?.error || error?.message || fallback;
}
