// SUPERADMIN-only audit launcher. Opens the regular app shell in a new tab
// with audit mode flipped on for that tab. The auditor sees a clean read-only
// view (no edit buttons by default) — Ctrl+Shift reveals controls.

import { ShieldCheck, ExternalLink } from 'lucide-react';

export default function AuditLauncher() {
  const launch = () => {
    // Pass a flag via the URL hash so the new tab can flip on audit mode
    // before any render. We avoid query strings so the URL still looks
    // identical to the regular admin app for the auditor.
    const win = window.open('/#audit=1', '_blank', 'noopener,noreferrer');
    if (!win) return;
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="text-purple-700" size={28} />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Audit</h1>
          <p className="text-sm text-gray-500">Opens a sandboxed copy of the admin app in a new tab.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-2xl">
        <h2 className="font-semibold text-gray-900 mb-2">How audit mode works</h2>
        <ul className="text-sm text-gray-700 space-y-1.5 list-disc list-inside mb-5">
          <li>The new tab looks exactly like the admin app — no banner, no special chrome.</li>
          <li>Edit / delete / upload buttons are hidden by default.</li>
          <li>Hold <kbd className="px-1.5 py-0.5 bg-gray-100 border rounded text-xs">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-gray-100 border rounded text-xs">Shift</kbd> to reveal them.</li>
          <li>Any edits, deletes, or uploads happen only in that tab — the server is never touched.</li>
          <li>Replace a PDF: open the upload control while Ctrl+Shift is held, pick the new file — only the blob URL changes locally.</li>
          <li>Triple-click the logo to wipe all in-tab changes back to clean state.</li>
          <li>A refresh also wipes the overlay.</li>
        </ul>

        <button
          onClick={launch}
          className="px-4 py-2 bg-purple-700 text-white rounded hover:bg-purple-800 flex items-center gap-2"
        >
          <ExternalLink size={16} /> Open audit tab
        </button>
      </div>
    </div>
  );
}
