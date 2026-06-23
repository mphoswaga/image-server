// Lesson-plan template store. A teacher can save MULTIPLE named templates
// (detailed, observation, weekly, intervention, substitute, …) and pick which
// to use per lesson. Each template = a parsed-to-text record plus the original
// file (so we can refill it later, preserving exact layout).
//
// Storage (per user, under DATA_DIR so it survives redeploys):
//   users/<id>/templates/<templateId>.json            ← record
//   users/<id>/templates/<templateId>-original.<ext>  ← original file
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');
const { DATA_DIR, writeFileAtomic, writeJsonAtomic } = require('./storage');

const userDir = userId => path.join(DATA_DIR, 'users', String(userId));
const templatesDir = userId => path.join(userDir(userId), 'templates');
const recPath = (userId, id) => path.join(templatesDir(userId), `${id}.json`);
const origPath = (userId, id, ext) => path.join(templatesDir(userId), `${id}-original${ext}`);
// Legacy single-template paths (pre-packs) — migrated on first access.
const legacyRecPath = userId => path.join(userDir(userId), 'template.json');
const legacyOrigBase = userId => path.join(userDir(userId), 'template-original');

const SUPPORTED = ['.docx', '.pdf', '.xlsx', '.xls', '.txt', '.md', '.csv'];
const TYPES = ['detailed', 'observation', 'weekly', 'intervention', 'substitute', 'custom'];

const nameFromFilename = f => String(f || '').replace(/\.[^.]+$/, '').trim();

async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames.map(name => `# ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n\n');
  }
  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf8');
  }
  throw new Error(`Unsupported file type "${ext || 'unknown'}". Use Word (.docx), PDF, Excel (.xlsx), or text.`);
}

// One-time migration: fold a pre-packs single template into the collection.
// Guarded by the templates/ dir existing, so it runs at most once per user.
function ensureMigrated(userId) {
  const dir = templatesDir(userId);
  if (fs.existsSync(dir)) return;
  const lp = legacyRecPath(userId);
  if (!fs.existsSync(lp)) return;
  let old;
  try { old = JSON.parse(fs.readFileSync(lp, 'utf8')); } catch { return; }
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const ext = old.ext || '';
  let hasOriginal = false;
  if (ext) {
    const op = legacyOrigBase(userId) + ext;
    if (fs.existsSync(op)) { writeFileAtomic(origPath(userId, id, ext), fs.readFileSync(op)); hasOriginal = true; }
  }
  writeJsonAtomic(recPath(userId, id), {
    id, name: nameFromFilename(old.filename) || 'My template', type: 'detailed',
    filename: old.filename, ext, text: old.text || '',
    hasOriginal: hasOriginal || !!old.hasOriginal, uploadedAt: old.uploadedAt || new Date().toISOString(),
  });
}

// All templates for a user, newest first.
function listTemplates(userId) {
  ensureMigrated(userId);
  const dir = templatesDir(userId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

function getTemplate(userId, id) {
  ensureMigrated(userId);
  const p = recPath(userId, id);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Save a NEW template; returns its record (with generated id).
function saveTemplate(userId, { name, type, filename, text, buffer }) {
  ensureMigrated(userId);
  const dir = templatesDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const ext = path.extname(filename || '').toLowerCase();
  if (buffer) writeFileAtomic(origPath(userId, id, ext), buffer);
  const rec = {
    id,
    name: (name || '').trim() || nameFromFilename(filename) || 'Untitled template',
    type: TYPES.includes(type) ? type : 'custom',
    filename, ext, uploadedAt: new Date().toISOString(),
    text: (text || '').trim(), hasOriginal: !!buffer,
  };
  writeJsonAtomic(recPath(userId, id), rec);
  return rec;
}

function renameTemplate(userId, id, { name, type }) {
  const rec = getTemplate(userId, id);
  if (!rec) return null;
  if (name != null && String(name).trim()) rec.name = String(name).trim();
  if (type != null && TYPES.includes(type)) rec.type = type;
  writeJsonAtomic(recPath(userId, id), rec);
  return rec;
}

function deleteTemplate(userId, id) {
  const rec = getTemplate(userId, id);
  if (!rec) return false;
  try { fs.unlinkSync(recPath(userId, id)); } catch {}
  if (rec.ext) { try { fs.unlinkSync(origPath(userId, id, rec.ext)); } catch {} }
  return true;
}

// Returns { buffer, ext, filename } of a template's stored original file, or null.
function loadOriginalById(userId, id) {
  const rec = getTemplate(userId, id);
  if (!rec || !rec.ext) return null;
  const p = origPath(userId, id, rec.ext);
  if (!fs.existsSync(p)) return null;
  return { buffer: fs.readFileSync(p), ext: rec.ext, filename: rec.filename };
}

// Backward-compatible helpers: "the default template" = most recently saved.
function loadTemplate(userId) { return listTemplates(userId)[0] || null; }
function loadOriginal(userId) { const t = loadTemplate(userId); return t ? loadOriginalById(userId, t.id) : null; }

module.exports = {
  extractText, SUPPORTED, TYPES,
  listTemplates, getTemplate, saveTemplate, renameTemplate, deleteTemplate, loadOriginalById,
  loadTemplate, loadOriginal,
};
