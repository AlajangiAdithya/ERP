// Client-side size guard for file inputs. The server has its own multer limit
// (see server/src/middleware/upload.js); this just gives the user immediate
// feedback before a slow upload starts. Default 10 MB matches the server's
// SIZE_PDF default. Returns true if file passes, false if rejected.
export const checkFileSize = (file, maxBytes = 10 * 1024 * 1024) => {
  if (!file) return true;
  if (file.size <= maxBytes) return true;
  const mb = (maxBytes / (1024 * 1024)).toFixed(0);
  alert(`File "${file.name}" is too large. Max ${mb} MB allowed.`);
  return false;
};
