// Browser-only audit overlay (Way 2).
//
// Activated only inside the new tab opened from the SUPERADMIN menu — never
// reaches the server. The overlay does three things:
//
//   1. Intercepts all non-GET axios calls and synthesises a 200 response.
//      Mutations stay client-side; the server is never touched.
//   2. Stores per-row overrides keyed by `${path}:${rowId}` so list payloads
//      can be patched on the fly to reflect "edits" the auditor made.
//   3. Provides hooks for the UI: useAuditMode() returns whether the overlay
//      is live, and useAuditEditsVisible() returns whether Ctrl+Shift is held
//      so the auditor can reveal the edit buttons that are hidden by default.
//
// Reset: triple-click the logo (handled in MainLayout) → calls reset() to wipe
// in-memory state. A full page refresh also wipes everything since nothing is
// persisted.

import { useEffect, useState } from 'react';
import api from '../../api/axios';

const STORAGE_KEY = '__raps_audit_mode__';
const isAuditTab = () => sessionStorage.getItem(STORAGE_KEY) === '1';

// In-memory overrides — { 'GET:/api/users': { id: { fieldOverride… } } }
const overrides = new Map();
// Pending creates — { 'GET:/api/users': [ {fakeRow…} ] }
const creates = new Map();
// Deleted IDs — { 'GET:/api/users': Set<id> }
const deletes = new Map();
// Blob URLs for PDFs that were "replaced" — { originalUrl: blobUrl }
const pdfReplacements = new Map();

const setOverride = (listPath, id, patch) => {
  const cur = overrides.get(listPath) || {};
  cur[id] = { ...(cur[id] || {}), ...patch };
  overrides.set(listPath, cur);
};

const addCreate = (listPath, row) => {
  const cur = creates.get(listPath) || [];
  creates.set(listPath, [...cur, row]);
};

const addDelete = (listPath, id) => {
  const cur = deletes.get(listPath) || new Set();
  cur.add(id);
  deletes.set(listPath, cur);
};

// Apply overrides to a GET response payload. Lists usually look like
// { rows: [...] } or just [...]. Detail responses are flat objects with an id.
const applyOverrides = (path, data) => {
  if (!data) return data;
  const key = `GET:${path.split('?')[0]}`;

  // Array → patch each row
  if (Array.isArray(data)) {
    const ov = overrides.get(key) || {};
    const del = deletes.get(key) || new Set();
    const cr = creates.get(key) || [];
    return [
      ...data.filter((r) => !del.has(r?.id)).map((r) => (r?.id && ov[r.id] ? { ...r, ...ov[r.id] } : r)),
      ...cr,
    ];
  }

  // Single object with id → patch directly
  if (data.id) {
    const ov = (overrides.get(key) || {})[data.id];
    return ov ? { ...data, ...ov } : data;
  }

  // Pagination-shaped { rows: [...], total } / { logs }, etc.
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (Array.isArray(out[k])) {
      out[k] = applyOverrides(`${path}#${k}`, out[k]);
    }
  }
  return out;
};

let installed = false;

export function installAuditInterceptors() {
  if (installed || !isAuditTab()) return;
  installed = true;

  // Mark the document so the CSS rules in index.css can hide every element
  // tagged with data-mutates="true" until the auditor holds Ctrl+Shift.
  if (typeof document !== 'undefined') {
    document.body.classList.add('audit-mode');
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey) document.body.classList.add('audit-edits-on');
    });
    window.addEventListener('keyup', () => {
      document.body.classList.remove('audit-edits-on');
    });
    window.addEventListener('blur', () => {
      document.body.classList.remove('audit-edits-on');
    });
  }

  // Intercept mutations — synthesise 200 with the same payload that was sent.
  api.interceptors.request.use(async (config) => {
    const method = (config.method || 'get').toLowerCase();
    if (method === 'get') return config;

    // Derive the corresponding GET list key from the URL.
    // Examples:
    //   PUT /users/:id        → list GET:/users
    //   POST /users           → list GET:/users (append)
    //   DELETE /users/:id     → list GET:/users (filter)
    //   PUT /suppliers/:id/compliance → list GET:/suppliers (patch)
    const url = config.url || '';
    const parts = url.replace(/^\/+/, '').split('?')[0].split('/');
    const resource = parts[0];
    const listKey = `GET:/${resource}`;

    if (method === 'delete' && parts.length >= 2) {
      addDelete(listKey, parts[1]);
    } else if ((method === 'put' || method === 'patch') && parts.length >= 2) {
      const body = typeof config.data === 'string' ? safeParse(config.data) : (config.data || {});
      setOverride(listKey, parts[1], body);
    } else if (method === 'post') {
      const body = typeof config.data === 'string' ? safeParse(config.data) : (config.data || {});
      // Fake an id so the row renders consistently
      addCreate(listKey, { id: `audit-${Date.now()}`, ...body, createdAt: new Date().toISOString() });
    }

    // Short-circuit the request — throw a marker error that the response
    // interceptor below converts into a synthetic 200.
    const err = new Error('__AUDIT_SHORTCIRCUIT__');
    err.__auditConfig = config;
    err.__auditBody = config.data;
    throw err;
  });

  api.interceptors.response.use(
    (response) => {
      // Apply overrides on GET responses so the UI reflects "edits"
      const method = (response.config?.method || 'get').toLowerCase();
      if (method === 'get' && response.data) {
        response.data = applyOverrides(response.config.url, response.data);
      }
      return response;
    },
    (error) => {
      if (error?.message === '__AUDIT_SHORTCIRCUIT__') {
        const cfg = error.__auditConfig;
        const body = typeof error.__auditBody === 'string' ? safeParse(error.__auditBody) : (error.__auditBody || {});
        return Promise.resolve({
          data: { ok: true, ...body, id: body?.id || `audit-${Date.now()}` },
          status: 200,
          statusText: 'OK (audit)',
          headers: {},
          config: cfg,
          request: {},
        });
      }
      return Promise.reject(error);
    }
  );
}

const safeParse = (s) => { try { return JSON.parse(s); } catch { return {}; } };

// ── Public hooks ────────────────────────────────────────────────────────

export function enterAuditMode() {
  sessionStorage.setItem(STORAGE_KEY, '1');
}

export function isInAuditMode() {
  return isAuditTab();
}

export function resetAudit() {
  overrides.clear();
  creates.clear();
  deletes.clear();
  for (const url of pdfReplacements.values()) {
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  }
  pdfReplacements.clear();
  // Force a re-render of any list view by reloading the route
  window.location.reload();
}

export function replacePdf(originalUrl, file) {
  const blobUrl = URL.createObjectURL(file);
  pdfReplacements.set(originalUrl, blobUrl);
  return blobUrl;
}

export function getReplacedPdf(originalUrl) {
  return pdfReplacements.get(originalUrl) || originalUrl;
}

export function useAuditMode() {
  const [on] = useState(() => isAuditTab());
  return on;
}

// Reveals hidden edit buttons while Ctrl+Shift is held down. Used by list
// pages to conditionally render edit/delete/upload controls in audit mode.
export function useAuditEditsVisible() {
  const audit = useAuditMode();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!audit) return;
    const onKey = (e) => {
      setVisible(e.ctrlKey && e.shiftKey);
    };
    const onBlur = () => setVisible(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [audit]);
  return visible;
}
