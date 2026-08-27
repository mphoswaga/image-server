const path = require('path');

const MAGIC = {
  pdf: buffer => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  zip: buffer => buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50,
  ole: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  png: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpeg: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  webp: buffer => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
};

const RULES = {
  '.pdf': ['pdf'],
  '.docx': ['zip'],
  '.pptx': ['zip'],
  '.xlsx': ['zip'],
  '.doc': ['ole'],
  '.ppt': ['ole'],
  '.xls': ['ole'],
  '.png': ['png'],
  '.jpg': ['jpeg'],
  '.jpeg': ['jpeg'],
  '.webp': ['webp'],
  '.csv': ['text'],
  '.txt': ['text'],
  '.md': ['text'],
};

const GROUPS = {
  template: new Set(['.doc', '.docx', '.ppt', '.pptx', '.pdf', '.xls', '.xlsx', '.txt', '.md']),
  planning: new Set(['.xls', '.xlsx']),
  source: new Set(['.docx', '.pptx', '.pdf', '.xls', '.xlsx', '.csv', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp']),
  slides: new Set(['.ppt', '.pptx']),
  roster: new Set(['.csv', '.xls', '.xlsx']),
};

function textLike(buffer) {
  if (!buffer.length) return false;
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  }
  return controls / sample.length < 0.02;
}

function zipExpansion(buffer) {
  let files = 0;
  let uncompressedBytes = 0;
  for (let offset = 0; offset + 46 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    files += 1;
    uncompressedBytes += buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return { files, uncompressedBytes };
}

function validateUpload(file, group, options = {}) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new Error('Choose a file to upload.');
  const filename = String(file.originalname || 'upload');
  const ext = path.extname(filename).toLowerCase();
  const allowed = GROUPS[group];
  if (!allowed || !allowed.has(ext)) throw new Error(`The file type ${ext || '(none)'} is not supported here.`);
  if (!file.buffer.length) throw new Error('The uploaded file is empty.');
  const maxBytes = Math.max(1024, options.maxBytes || 15 * 1024 * 1024);
  if (file.buffer.length > maxBytes) throw new Error(`The uploaded file is larger than ${Math.ceil(maxBytes / 1024 / 1024)} MB.`);

  const kinds = RULES[ext] || [];
  const valid = kinds.some(kind => kind === 'text' ? textLike(file.buffer) : MAGIC[kind](file.buffer));
  if (!valid) throw new Error(`The contents of ${filename} do not match its file type.`);

  if (kinds.includes('zip')) {
    const expansion = zipExpansion(file.buffer);
    const maxFiles = options.maxArchiveFiles || 5000;
    const maxExpandedBytes = options.maxExpandedBytes || 80 * 1024 * 1024;
    if (!expansion.files) throw new Error('The uploaded Office file is incomplete or damaged.');
    if (expansion.files > maxFiles || expansion.uncompressedBytes > maxExpandedBytes) {
      throw new Error('The uploaded Office file expands beyond the safe processing limit.');
    }
  }
  return { filename, ext, size: file.buffer.length };
}

function requireUploads(group, options) {
  return (req, res, next) => {
    try {
      const files = req.files || (req.file ? [req.file] : []);
      const maxTotalBytes = options?.maxTotalBytes || 30 * 1024 * 1024;
      const totalBytes = files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0);
      if (totalBytes > maxTotalBytes) {
        throw new Error(`The combined upload is larger than ${Math.ceil(maxTotalBytes / 1024 / 1024)} MB.`);
      }
      for (const file of files) validateUpload(file, group, options);
      next();
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

module.exports = { GROUPS, requireUploads, validateUpload, zipExpansion };
