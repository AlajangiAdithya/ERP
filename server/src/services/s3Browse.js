// Thin wrapper around the AWS CLI for the SUPERADMIN backups browser.
// We shell out to `aws` instead of pulling in @aws-sdk so the server stays
// dependency-light — the EC2 box already has aws-cli installed for backup.sh.
//
// Bucket layout (matches deploy/backup.sh):
//   s3://{bucket}/{FYxx-yy}/weekly/{date}.tar.gz
//   s3://{bucket}/{FYxx-yy}/monthly/{year}-{month}.tar.gz
//   s3://{bucket}/{FYxx-yy}/quarterly/{year}-Q{n}.tar.gz
//   s3://{bucket}/{FYxx-yy}/half-yearly/{year}-H{n}.tar.gz
//   s3://{bucket}/{FYxx-yy}/yearly/{FYxx-yy}.tar.gz
//   s3://{bucket}/{FYxx-yy}/master/{date}-master.json

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const execFileAsync = promisify(execFile);

const REGION = process.env.AWS_REGION || 'ap-south-1';
const BUCKET = process.env.S3_BACKUP_BUCKET || process.env.S3_BUCKET || '';

const TIERS = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly', 'master'];

const aws = async (args) => {
  const { stdout } = await execFileAsync('aws', args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
};

// Parse `aws s3 ls --recursive` output. Each line is:
//   YYYY-MM-DD HH:MM:SS  <size>  <key>
const parseLsRecursive = (text) => {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    out.push({
      lastModified: `${m[1]}T${m[2]}Z`,
      size: parseInt(m[3], 10),
      key: m[4],
    });
  }
  return out;
};

// Build tree: { [fy]: { [tier]: [ { key, name, size, lastModified } ] } }
async function listBackupTree() {
  if (!BUCKET) throw new Error('S3_BACKUP_BUCKET env not set');

  let raw;
  try {
    raw = await aws(['s3', 'ls', `s3://${BUCKET}/`, '--recursive', '--region', REGION]);
  } catch (e) {
    if (/NoSuchBucket/.test(e.stderr || '')) return {};
    throw new Error(e.stderr?.trim() || e.message);
  }

  const tree = {};
  for (const obj of parseLsRecursive(raw)) {
    // key looks like "FY25-26/weekly/2026-05-24.tar.gz"
    const parts = obj.key.split('/');
    if (parts.length < 3) continue;
    const [fy, tier, ...rest] = parts;
    if (!TIERS.includes(tier)) continue;

    tree[fy] = tree[fy] || {};
    tree[fy][tier] = tree[fy][tier] || [];
    tree[fy][tier].push({
      key: obj.key,
      name: rest.join('/'),
      size: obj.size,
      lastModified: obj.lastModified,
    });
  }

  // newest first within each tier
  for (const fy of Object.keys(tree)) {
    for (const tier of Object.keys(tree[fy])) {
      tree[fy][tier].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    }
  }
  return tree;
}

// Generate a presigned URL (5 min) for direct download from the browser.
async function signBackupUrl(key) {
  if (!BUCKET) throw new Error('S3_BACKUP_BUCKET env not set');
  const out = await aws([
    's3', 'presign', `s3://${BUCKET}/${key}`,
    '--expires-in', '300',
    '--region', REGION,
  ]);
  return out.trim();
}

// Download a backup and return its metadata.json (for tar.gz bundles) or the
// raw JSON (for master snapshots). Bundles are streamed to a temp file then
// untarred just enough to extract metadata.json.
async function previewBackup(key) {
  if (!BUCKET) throw new Error('S3_BACKUP_BUCKET env not set');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raps-preview-'));
  const tmpFile = path.join(tmpDir, path.basename(key));

  try {
    await aws(['s3', 'cp', `s3://${BUCKET}/${key}`, tmpFile, '--region', REGION, '--only-show-errors']);

    // Master snapshots are plain JSON — read and return.
    if (key.endsWith('.json')) {
      const txt = fs.readFileSync(tmpFile, 'utf8');
      const json = JSON.parse(txt);
      return { kind: 'master', metadata: json };
    }

    // Bundle: extract metadata.json to stdout via tar.
    const { stdout } = await execFileAsync('tar', ['-xzOf', tmpFile, 'metadata.json'], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const metadata = JSON.parse(stdout);
    return { kind: 'bundle', metadata };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

module.exports = { listBackupTree, signBackupUrl, previewBackup };
