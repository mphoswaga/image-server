// Keep every original workbook part intact; patch only numeric mark cells.
// Re-serializing a workbook can change structures expected by school importers.
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const path = require('node:path').posix;

function parseStrict(xml) {
  return new DOMParser({ onError(level, message) { throw new Error(`Invalid school workbook XML: ${message}`); } })
    .parseFromString(xml, 'application/xml');
}

function patchWorkbookMarks(buffer, edits) {
  const zip = new PizZip(buffer);
  const parse = name => parseStrict(zip.file(name).asText());
  const rels = Array.from(parse('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship'));
  const sheets = Array.from(parse('xl/workbook.xml').getElementsByTagName('sheet'));
  for (const [name, cells] of edits) {
    const sheet = sheets.find(s => s.getAttribute('name') === name);
    const rel = rels.find(r => r.getAttribute('Id') === sheet?.getAttribute('r:id'));
    if (!rel || rel.getAttribute('TargetMode') === 'External') throw new Error('Cannot locate the template worksheet.');
    const target = rel.getAttribute('Target');
    const entry = target.startsWith('/') ? target.slice(1) : path.normalize(path.join('xl', target));
    let xml = zip.file(entry).asText();
    parseStrict(xml);
    for (const [address, mark] of cells) {
      if (!/^[A-Z]+[1-9]\d*$/.test(address) || !Number.isFinite(mark)) throw new Error('Invalid school mark cell.');
      // The lazy attribute match must stop before the slash of a self-closing
      // cell. Otherwise it can consume the following cell or even the next row.
      const pattern = new RegExp(`<((?:[\\w]+:)?c)\\b([^>]*\\br=["']${address}["'][^>]*?)(?:/>|>([\\s\\S]*?)<\\/\\1>)`);
      let found = false;
      xml = xml.replace(pattern, (whole, tag, attrs, body = '') => {
        found = true;
        const prefix = tag.includes(':') ? tag.split(':')[0] + ':' : '';
        attrs = attrs.replace(/\s+t=["'][^"']*["']/g, '').replace(/\/$/, '');
        body = body.replace(/<(?:\w+:)?(?:v|f|is)\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?(?:v|f|is)>)/g, '');
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
    const verified = parseStrict(xml);
    const savedCells = Array.from(verified.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c'));
    for (const [address, mark] of cells) {
      const matches = savedCells.filter(cell => cell.getAttribute('r') === address);
      const cell = matches[0];
      const values = cell ? Array.from(cell.childNodes).filter(child => child.localName === 'v') : [];
      if (matches.length !== 1 || cell.parentNode.localName !== 'row' || values.length !== 1 || Number(values[0].textContent) !== mark) {
        throw new Error(`Could not verify the exported school mark at ${address}.`);
      }
    }
    zip.file(entry, xml);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { patchWorkbookMarks };
