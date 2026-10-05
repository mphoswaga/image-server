const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const { paginateSlides } = require('./generate');
const { gradeProfile } = require('./grade');
const { getPreset } = require('./slide-presets');
const normal = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
function readXml(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`PowerPoint export is missing ${name}.`);
  return new DOMParser().parseFromString(file.asText(), 'application/xml');
}
function textIn(doc) {
  return normal(Array.from(doc.getElementsByTagName('a:t')).map(n => n.textContent).join(' '));
}
function requiredText(slide) {
  if (slide.type==='objectives') return [String(slide.title || 'Learning objectives').toUpperCase(),...(slide.bullets || [])];
  if (slide.table?.rows?.length) return [slide.title, ...slide.table.headers, ...slide.table.rows.flat(), slide.table.caption, ...(slide.bullets || [])];
  if (slide.worked?.steps?.length) return [slide.title, slide.worked.task, ...slide.worked.steps];
  if (slide.shortcuts?.length) return [slide.title, slide.example, ...slide.shortcuts.flatMap(s => [s.action, s.keys])];
  if (slide.visual?.type === 'diagram') return [slide.title]; // Diagram labels are embedded in SVG; visual review checks them.
  if (['steps','cycle','numberline'].includes(slide.visual?.type)) return [slide.title, slide.example, ...(slide.visual.type === 'numberline' ? [] : slide.visual.items)];
  return [slide.title, slide.subtitle, ...(slide.bullets || []), slide.example];
}
// Check the actual delivered ZIP after animation, including native table cells
// and notes. This is a structural/content gate, not a claim of visual rendering.
function validateAlignedExport(buffer, deck) {
  if (!deck.slides.some(s => s.alignment || s.lessonReview)) return;
  const pages = paginateSlides(deck.slides, gradeProfile(deck.grade).theme, getPreset(deck.presetId));
  const zip = new PizZip(buffer);
  const count = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  if (count !== pages.length) throw new Error('PowerPoint export changed the expected slide count.');
  for (let i = 0; i < pages.length; i++) {
    const slide = pages[i], doc = readXml(zip, `ppt/slides/slide${i+1}.xml`), text = textIn(doc);
    for (const value of requiredText(slide).filter(Boolean)) {
      if (!text.includes(normal(value))) throw new Error(`Slide ${i+1} lost teaching content during export. Please regenerate that slide before downloading.`);
    }
    if (slide.table?.rows?.length && !doc.getElementsByTagName('a:tbl').length) throw new Error(`Slide ${i+1} lost its editable table.`);
    if (slide.speakerNotes) {
      const notes = textIn(readXml(zip, `ppt/notesSlides/notesSlide${i+1}.xml`));
      if (!notes.includes(normal(slide.speakerNotes))) throw new Error(`Slide ${i+1} lost its teacher notes.`);
    }
  }
}
module.exports = { validateAlignedExport };
