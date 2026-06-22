// Post-processes a generated .pptx to add motion that pptxgenjs can't:
//   • a gentle slide transition on every slide
//   • bullets that reveal one-by-one on click (build by paragraph)
//   • (early grades) the image + title fade/zoom in when the slide opens
//
// PowerPoint animation lives in <p:transition> and <p:timing> nodes inside each
// slideN.xml. We find the shape ids pptxgenjs assigned, then splice the XML in
// just before </p:sld> (schema order: cSld, clrMapOvr, transition, timing).
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');

// Identify shapes on a slide: the bullets box (text shape with the most
// paragraphs), the title (first/short text shape), and the picture.
function findShapes(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const sps = doc.getElementsByTagName('p:sp');
  let bulletsId = null, bulletsMax = 1, titleId = null;
  for (let i = 0; i < sps.length; i++) {
    const sp = sps[i];
    const idEl = sp.getElementsByTagName('p:cNvPr')[0];
    if (!idEl) continue;
    const id = idEl.getAttribute('id');
    const pCount = sp.getElementsByTagName('a:p').length;
    if (pCount > bulletsMax) { bulletsMax = pCount; bulletsId = id; }
    if (titleId === null) titleId = id; // first text shape ≈ title
  }
  // Concept-diagram slices to fill in sequentially (objectName lc-anim-fill-<i>).
  const fills = [];
  for (let i = 0; i < sps.length; i++) {
    const idEl = sps[i].getElementsByTagName('p:cNvPr')[0];
    if (!idEl) continue;
    const mm = (idEl.getAttribute('name') || '').match(/lc-anim-fill-(\d+)/);
    if (mm) fills.push({ spid: idEl.getAttribute('id'), idx: parseInt(mm[1], 10) });
  }
  fills.sort((a, b) => a.idx - b.idx);

  const pics = doc.getElementsByTagName('p:pic');
  let picId = null;
  if (pics.length) { const idEl = pics[0].getElementsByTagName('p:cNvPr')[0]; if (idEl) picId = idEl.getAttribute('id'); }
  return { bulletsId, titleId, picId, fills };
}

// Auto-playing entrance (after the previous step) — used to fill diagram slices.
function fillEntrance(cId, spid, delay) {
  return `<p:par><p:cTn id="${cId}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>`
    + `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${cId + 1}" dur="400"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
    + `<p:set><p:cBhvr><p:cTn id="${cId + 2}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
    + `</p:childTnLst></p:cTn></p:par>`;
}

// One automatic (with-slide) fade/zoom entrance effect block.
function autoEntrance(cId, spid, filter) {
  return `<p:par><p:cTn id="${cId}" presetID="${filter === 'zoom' ? 23 : 10}" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
    + `<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn id="${cId + 1}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
    + `<p:set><p:cBhvr><p:cTn id="${cId + 2}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
    + `</p:childTnLst></p:cTn></p:par>`;
}

// One on-click fade entrance for the bullets shape (build-by-paragraph makes it
// step one bullet per click).
function clickBullets(cId, spid) {
  return `<p:par><p:cTn id="${cId}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>`
    + `<p:par><p:cTn id="${cId + 1}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
    + `<p:par><p:cTn id="${cId + 2}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
    + `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${cId + 3}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`
    + `<p:set><p:cBhvr><p:cTn id="${cId + 4}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
    + `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
}

function buildTimingAndTransition(xml, { entrance }) {
  const { bulletsId, titleId, picId, fills } = findShapes(xml);
  const transition = `<p:transition spd="slow"><p:fade/></p:transition>`;
  if (!bulletsId && !fills.length && !(entrance && (picId || titleId))) return transition; // transition only

  let id = 20; // start ids high to avoid colliding with shape ids
  const autoBlocks = [];
  // Concept-diagram slices fill in one-by-one on slide load (all grades).
  fills.forEach(f => { autoBlocks.push(fillEntrance(id, f.spid, 350)); id += 3; });
  if (entrance && picId) { autoBlocks.push(autoEntrance(id, picId, 'zoom')); id += 3; }
  if (entrance && titleId && titleId !== bulletsId) { autoBlocks.push(autoEntrance(id, titleId, 'fade')); id += 3; }

  const clickBlocks = [];
  const bld = [];
  if (bulletsId) { clickBlocks.push(clickBullets(id, bulletsId)); id += 5; bld.push(`<p:bldP spid="${bulletsId}" grpId="0" build="p"/>`); }

  const mainSeqChildren = autoBlocks.join('') + clickBlocks.join('');
  const timing =
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>`
    + `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>`
    + mainSeqChildren
    + `</p:childTnLst></p:cTn>`
    + `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>`
    + `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>`
    + `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>`
    + (bld.length ? `<p:bldLst>${bld.join('')}</p:bldLst>` : '')
    + `</p:timing>`;

  return transition + timing;
}

// band: 'early' | 'middle' | 'senior'. Early grades get the full entrance set.
function animateBuffer(buffer, band) {
  const entrance = band === 'early';
  const zip = new PizZip(buffer);
  const files = zip.file(/ppt\/slides\/slide\d+\.xml$/);
  for (const f of files) {
    let xml = f.asText();
    if (xml.includes('<p:transition') || xml.includes('<p:timing')) continue; // already animated
    const inject = buildTimingAndTransition(xml, { entrance });
    xml = xml.replace('</p:sld>', inject + '</p:sld>');
    zip.file(f.name, xml);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { animateBuffer };
