// Single source of truth for LessonScope credit prices. The server enforces
// these through the wallet lifecycle (reserve → capture/release); the UI reads
// them via GET /api/credit-prices to show a cost badge next to each generation
// button. Keeping prices in ONE place means the badge a teacher sees and the
// amount the wallet reserves can never drift apart.
//
// Prices come from the EducScope wallet handoff. LessonScope never subtracts
// credits itself — it only names an `action`, and wallet.js reserves this many.

// action key → credits. Any action not listed here is free.
const PRICES = {
  'lesson-pack-full': 3,   // full lesson pack (worksheet + exit ticket + quiz)
  'slide-deck': 1,         // slide deck only  (POST /api/generate)
  'import-plan': 1,        // import a lesson plan → slides
  'pack-item': 1,          // worksheet / exit ticket / quiz on its own
  'game': 1,               // classroom game only
  'diagram': 1,            // AI diagram for a slide
  'ai-image': 2,           // AI image for a slide
};

// Human labels for the UI badge / history (keep in sync with PRICES).
const LABELS = {
  'lesson-pack-full': 'Full lesson pack',
  'slide-deck': 'Slide deck',
  'import-plan': 'Import plan → slides',
  'pack-item': 'Worksheet / quiz / exit ticket',
  'game': 'Classroom game',
  'diagram': 'AI diagram',
  'ai-image': 'AI image',
};

// Explicitly-free actions, documented so the UI can label them "Free" rather
// than leave them ambiguous.
const FREE = {
  'import-slides': 'Parsing an existing file is free',
  'lesson-plan': 'Included in the pack — free during beta',
  'slide-regenerate': 'Free within fair-use (3 regenerations per lesson)',
  'auto-grade': 'Free (grading is batched)',
  'parse-pacing-guide': 'Free',
  'query-rewrite': 'Free',
  'caption': 'Free',
};

// Fair-use: regenerating one slide is free the first FREE_REGENS times per
// lesson; after that another small batch costs REGEN_BATCH_COST credits.
const FREE_REGENS = (() => { const v = parseInt(process.env.FREE_REGENS_PER_LESSON, 10); return Number.isFinite(v) && v >= 0 ? v : 3; })();
const REGEN_BATCH_COST = 1;

function priceFor(action) { return PRICES[action] || 0; }
function isFree(action) { return !PRICES[action]; }
function label(action) { return LABELS[action] || action; }

// The shape GET /api/credit-prices returns — everything the UI needs to render
// badges without hardcoding numbers.
function publicTable() {
  return {
    prices: PRICES,
    labels: LABELS,
    free: FREE,
    fairUse: { freeRegensPerLesson: FREE_REGENS, regenBatchCost: REGEN_BATCH_COST },
  };
}

module.exports = { PRICES, LABELS, FREE, FREE_REGENS, REGEN_BATCH_COST, priceFor, isFree, label, publicTable };
