// Single source of truth for LessonScope credit prices. The server enforces
// these through the wallet lifecycle (reserve → capture/release); the UI reads
// them via GET /api/credit-prices to show a cost badge next to each generation
// button. Keeping prices in ONE place means the badge a teacher sees and the
// amount the wallet reserves can never drift apart.
//
// Prices come from the EducScope wallet handoff. LessonScope never subtracts
// credits itself — it only names an `action`, and wallet.js reserves this many.

// Canonical action names (EducScope wallet contract, shared across apps).
// action key → credits. Any action not listed here is free.
const PRICES = {
  'lessonscope.generate_lesson_pack': 3,    // full lesson pack (worksheet + exit ticket + quiz)
  'lessonscope.generate_slide_deck': 1,     // slide deck only  (POST /api/generate)
  'lessonscope.import_plan_to_slides': 1,   // import a lesson plan → slides
  'lessonscope.generate_pack_item': 1,      // worksheet / exit ticket / quiz on its own
  'lessonscope.generate_game': 1,           // classroom game only
  'lessonscope.generate_diagram': 2,        // AI diagram for a slide
  'lessonscope.generate_ai_image': 3,       // AI image for a slide
  // lessonscope.regenerate_slide is priced by fair-use (see FREE_REGENS), not here.
};

// Human labels for the UI badge / history (keep in sync with PRICES).
const LABELS = {
  'lessonscope.generate_lesson_pack': 'Full lesson pack',
  'lessonscope.generate_slide_deck': 'Slide deck',
  'lessonscope.import_plan_to_slides': 'Import plan → slides',
  'lessonscope.generate_pack_item': 'Worksheet / quiz / exit ticket',
  'lessonscope.generate_game': 'Classroom game',
  'lessonscope.generate_diagram': 'AI diagram',
  'lessonscope.generate_ai_image': 'AI image',
  'lessonscope.regenerate_slide': 'Regenerate slide',
};

// Explicitly-free actions, documented so the UI can label them "Free" rather
// than leave them ambiguous.
const FREE = {
  'lessonscope.regenerate_slide': 'Free within fair-use (3 regenerations per lesson)',
  'lessonscope.import_slides': 'Parsing an existing file is free',
  'lessonscope.generate_lesson_plan': 'Included in the pack — free during beta',
  'lessonscope.auto_grade': 'Free (grading is batched)',
  'lessonscope.parse_pacing_guide': 'Free',
  'lessonscope.rewrite_image_query': 'Free',
  'lessonscope.caption_image': 'Free',
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
