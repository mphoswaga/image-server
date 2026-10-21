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
const OBJECTIVE_SLIDE = /^\s*((?:learning|lesson)\s+)?(objectives?|outcomes?|lo'?s?|walt|we are learning|aims?)\b/i;
const CRITERIA_SLIDE = /^\s*(success\s+criteria|sc|wilf|what i'?m looking for|i can)\b/i;

function slideLinesMatching(deck, re) {
  const out = [];
  for (const slide of ((deck && deck.slides) || [])) {
    if (!slide || slide.type === 'video') continue;
    // PowerPoint text boxes are stored in drawing order, not necessarily title order.
    // Recognise explicit labels anywhere, and stop before the other field or a task.
    let collecting = false;
    const lines = [slide.title, ...(Array.isArray(slide.bullets) ? slide.bullets : [])]
      .flatMap(value => String(value || '').split(/\r?\n/)).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(re);
      if (match) {
        const rest = line.slice(match[0].length).trim();
        // Only headings or explicitly labelled inline values are fields.
        if (!rest || /^[:–—-]/.test(rest)) {
          collecting = true;
          const value = rest.replace(/^[:–—-]\s*/, '').trim();
          if (value) out.push(value);
          continue;
        }
      }
      if ((re !== OBJECTIVE_SLIDE && OBJECTIVE_SLIDE.test(line)) || (re !== CRITERIA_SLIDE && CRITERIA_SLIDE.test(line))
        || /^(starter|activity|task|plenary|resources|homework|reflection|instructions|lesson agenda)\b/i.test(line)) {
        collecting = false;
        continue;
      }
      if (collecting) out.push(line);
    }
  }
  return [...new Set(out)].join('\n');
}

const objectivesFromDeck = deck => slideLinesMatching(deck, OBJECTIVE_SLIDE);
const criteriaFromDeck = deck => slideLinesMatching(deck, CRITERIA_SLIDE);

module.exports = { objectivesFromDeck, criteriaFromDeck, OBJECTIVE_SLIDE, CRITERIA_SLIDE };
