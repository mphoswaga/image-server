// Keep every original workbook part intact; patch only numeric mark cells.
// Re-serializing a workbook can change structures expected by school importers.
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const path = require('node:path').posix;

function patchWorkbookMarks(buffer, edits) {
  const zip = new PizZip(buffer);
  const parse = name => new DOMParser().parseFromString(zip.file(name).asText(), 'application/xml');
  const rels = Array.from(parse('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship'));
  const sheets = Array.from(parse('xl/workbook.xml').getElementsByTagName('sheet'));
  for (const [name, cells] of edits) {
    const sheet = sheets.find(s => s.getAttribute('name') === name);
    const rel = rels.find(r => r.getAttribute('Id') === sheet?.getAttribute('r:id'));
    if (!rel || rel.getAttribute('TargetMode') === 'External') throw new Error('Cannot locate the template worksheet.');
    const target = rel.getAttribute('Target');
    const entry = target.startsWith('/') ? target.slice(1) : path.normalize(path.join('xl', target));
    let xml = zip.file(entry).asText();
    for (const [address, mark] of cells) {
      const pattern = new RegExp(`<((?:[\\w]+:)?c)\\b([^>]*\\br=["']${address}["'][^>]*)(?:/>|>([\\s\\S]*?)<\\/\\1>)`);
      let found = false;
      xml = xml.replace(pattern, (whole, tag, attrs, body = '') => {
        found = true;
        const prefix = tag.includes(':') ? tag.split(':')[0] + ':' : '';
        attrs = attrs.replace(/\s+t=["'][^"']*["']/g, '').replace(/\/$/, '');
        body = body.replace(/<(?:\w+:)?(?:v|f|is)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?(?:v|f|is)>)/g, '');
        return `<${tag}${attrs}><${prefix}v>${mark}</${prefix}v>${body}</${tag}>`;
      });
      if (!found) {
        const rowNumber = address.match(/\d+$/)[0];
        const rowPattern = new RegExp(`<((?:[\\w]+:)?row)\\b([^>]*\\br=["']${rowNumber}["'][^>]*)>([\\s\\S]*?)<\\/\\1>`);
        xml = xml.replace(rowPattern, (whole, tag, attrs, body) => {
          found = true;
          const prefix = tag.includes(':') ? tag.split(':')[0] + ':' : '';
          const newCell = `<${prefix}c r="${address}"><${prefix}v>${mark}</${prefix}v></${prefix}c>`;
          const col = value => value.replace(/\d+/g, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
          const next = [...body.matchAll(/<(?:\w+:)?c\b[^>]*\br=["']([A-Z]+\d+)["']/g)].find(m => col(m[1]) > col(address));
          const at = next ? next.index : body.length;
          return `<${tag}${attrs}>${body.slice(0, at)}${newCell}${body.slice(at)}</${tag}>`;
        });
      }
      if (!found) throw new Error(`Cannot find template row for ${address}.`);
    }
    zip.file(entry, xml);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { patchWorkbookMarks };
