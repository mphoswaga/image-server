// Shared image-query rewriter used by both the picker and the generation flow.
// Static CLARIFY rules handle known ambiguous educational terms instantly (no cost).
// For anything unrecognised, GPT-4o-mini produces concrete visual keywords (~$0.0001).
// Results are cached in-memory so repeated queries never cost a second call.

const _cache = new Map();

const CLARIFY = [
  [/(output\s+devices?)/i,    'computer monitor printer speaker headphones $1'],
  [/(input\s+devices?)/i,     'keyboard mouse touchscreen microphone $1 computer'],
  [/(storage\s+devices?)/i,   'hard drive usb flash drive memory card $1 computer'],
  [/(processing\s+unit|cpu|processor)/i, 'computer cpu processor chip hardware'],
  [/(memory|ram\b)/i,         'computer ram memory chip hardware'],
  [/(network\b)/i,            'computer network internet school diagram'],
  [/(circuit\b)/i,            'electric circuit diagram school science'],
  [/(cell\b)/i,               'cell biology organism microscope diagram'],
  [/(ecosystem\b)/i,          'ecosystem food web nature animals plants diagram'],
  [/(algorithm\b)/i,          'algorithm flowchart programming steps diagram'],
  [/(fraction\b)/i,           'fraction math numbers halves thirds diagram'],
  [/(photosynthesis\b)/i,     'plant photosynthesis sunlight chlorophyll diagram'],
  [/(volcano\b)/i,            'volcano eruption lava diagram geography'],
  [/(water\s+cycle)/i,        'water cycle evaporation rain diagram school'],
  [/(parts?\s+of\s+(a\s+)?computer)/i, 'computer desktop monitor keyboard mouse complete setup'],
  [/\bcomputer\b/i,                    'desktop computer monitor keyboard mouse screen technology'],
  [/(iot|internet\s+of\s+things)(\s+devices?)?/i, 'smart home device sensor connected appliance'],
  [/(kiddle|safe\s*search|child.safe)[\w.\s]*/i,  'child student laptop computer internet browsing'],
  [/(advantages?\s+of\s+networks?)/i,  'school network computers connected sharing classroom'],
  [/(disadvantages?\s+of\s+networks?)/i, 'computer network problem security virus risk'],
  [/(types?\s+of\s+networks?)/i,       'LAN WAN network diagram computers connected'],
  [/(spell.?check)/i,         'computer screen word processor spell check autocorrect'],
  [/(document|word\s+process)/i, 'computer screen document typing word processor'],
  [/(spreadsheet|excel)/i,    'computer screen spreadsheet data table rows columns'],
  [/(presentation|slides?)/i, 'computer screen presentation slideshow projector'],
  [/(web\s+brows)/i,          'computer screen internet browser website online'],
  [/(email|e-mail)/i,         'computer screen email inbox message typing'],
  [/(file\s*manag|folder)/i,  'computer screen file folder documents organize'],
  [/(copy.?paste|cut.?paste)/i, 'computer keyboard shortcut copy paste edit'],
  [/(keyboard\s+shortcut)/i,  'computer keyboard shortcut keys ctrl function'],
  [/(poster|project)\s+creat/i, 'students classroom art project colorful crafts'],
  [/(review|revision|recap)\s+(what|lesson|our|the)/i, 'students classroom learning whiteboard teacher'],
  [/(starter|warm.?up|bell\s+ringer)/i, 'students classroom desks morning lesson activity'],
  [/(plenary|exit\s+ticket|closing)/i, 'teacher students classroom discussion summary'],
  [/(print)/i,                'printer computer printing paper document office'],
  [/(save\b)/i,               'computer screen save file document floppy disk icon'],
];

async function rewriteImageQuery(raw, { grade = '' } = {}) {
  let q = String(raw || '').trim();
  if (!q) return q;

  q = q.replace(/^(examples?\s+of\s+|types?\s+of\s+|what\s+(is|are)\s+|using\s+(the\s+)?|the\s+)/i, '').trim();

  let ruleMatched = false;
  for (const [pattern, replacement] of CLARIFY) {
    if (pattern.test(q)) {
      q = q.replace(pattern, replacement)
           .replace(/\s*(safely|quiz|lesson|activity|worksheet|review|starter|plenary|\.\w+)[\s\w]*$/i, '')
           .replace(/[?.!,;:]+$/, '').trim();
      ruleMatched = true;
      break;
    }
  }

  if (!ruleMatched && process.env.OPENAI_API_KEY) {
    const cacheKey = q.toLowerCase().trim();
    if (_cache.has(cacheKey)) {
      q = _cache.get(cacheKey);
    } else {
      try {
        const { client: aiClient } = require('./ai-client');
        const resp = await aiClient().chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 50,
          messages: [{
            role: 'user',
            content: `Convert this educational slide title into 4-6 specific visual keywords for stock photo search. Describe what the IMAGE should show — concrete objects, settings, actions. No abstract words. Space-separated, no punctuation.\n\nTitle: "${q}"`,
          }],
        });
        const rewritten = resp.choices[0]?.message?.content?.trim().replace(/["\n]/g, '');
        if (rewritten && rewritten.length > 3 && rewritten.length < 150) {
          _cache.set(cacheKey, rewritten);
          q = rewritten;
        }
      } catch { /* leave q unchanged */ }
    }
  }

  if (grade && grade !== 'middle school' && grade !== 'high school') {
    const gradeNum = grade.replace(/[^0-9]/g, '');
    if (gradeNum) q += ` grade ${gradeNum} students`;
  }
  if (!/education|school|classroom|student|diagram|learn/i.test(q)) q += ' education';
  return q.trim();
}

module.exports = { rewriteImageQuery };
