// Lesson-plan template store: parse an uploaded Word/PDF/Excel/text file into
// plain text, and persist it so the teacher only uploads once.
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

const DATA_DIR = path.join(__dirname, 'data');
const userDir = userId => path.join(DATA_DIR, 'users', String(userId));
const templatePath = userId => path.join(userDir(userId), 'template.json');
const originalBase = userId => path.join(userDir(userId), 'template-original'); // + ext

const SUPPORTED = ['.docx', '.pdf', '.xlsx', '.xls', '.txt', '.md', '.csv'];

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

function saveTemplate(userId, { filename, text, buffer }) {
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(filename || '').toLowerCase();
  // Persist the original file so we can fill it later, preserving exact layout.
  if (buffer) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('template-original')) fs.unlinkSync(path.join(dir, f));
    }
    fs.writeFileSync(originalBase(userId) + ext, buffer);
  }
  const record = { filename, ext, uploadedAt: new Date().toISOString(), text: text.trim(), hasOriginal: !!buffer };
  fs.writeFileSync(templatePath(userId), JSON.stringify(record, null, 2));
  return record;
}

function loadTemplate(userId) {
  const p = templatePath(userId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

// Returns { buffer, ext, filename } of the stored original file, or null.
function loadOriginal(userId) {
  const rec = loadTemplate(userId);
  if (!rec || !rec.ext) return null;
  const p = originalBase(userId) + rec.ext;
  if (!fs.existsSync(p)) return null;
  return { buffer: fs.readFileSync(p), ext: rec.ext, filename: rec.filename };
}

module.exports = { extractText, saveTemplate, loadTemplate, loadOriginal, SUPPORTED };
