// Fields lifted off a deck's own slides, word for word.
//
// A teacher who starts from their own PowerPoint has no pacing guide in the
// app: the deck record carries no objectives, so the LO and SC rows of their
// week-by-week plan came back blank. Decks nearly always open with an
// objectives slide, and that slide holds the school's own wording.
//
// Nothing here goes near the model. Learning objectives stay exactly as the
// pacing guide gives them and are never reworded — so these functions COPY, and
// when the slides don't state something the row stays blank rather than being
// filled with something invented.
const OBJECTIVE_SLIDE = /^\s*(learning\s+)?(objectives?|outcomes?|lo'?s?|walt|we are learning|aims?)\b/i;
const CRITERIA_SLIDE = /^\s*(success\s+criteria|sc|wilf|what i'?m looking for|i can)\b/i;

function slideLinesMatching(deck, re) {
  const out = [];
  for (const slide of ((deck && deck.slides) || [])) {
    if (!slide || slide.type === 'video') continue;
    if (!re.test(String(slide.title || ''))) continue;
    for (const bullet of (Array.isArray(slide.bullets) ? slide.bullets : [])) {
      const line = String(bullet || '').trim();
      if (line) out.push(line);
    }
  }
  return out.join('\n');
}

const objectivesFromDeck = deck => slideLinesMatching(deck, OBJECTIVE_SLIDE);
const criteriaFromDeck = deck => slideLinesMatching(deck, CRITERIA_SLIDE);

module.exports = { objectivesFromDeck, criteriaFromDeck, OBJECTIVE_SLIDE, CRITERIA_SLIDE };
