// Single source of truth for LessonScope credit prices. The server enforces
// these through the wallet lifecycle (reserve → capture/release); the UI reads
// them via GET /api/credit-prices to show a cost badge next to each generation
// button. Keeping prices in ONE place means the badge a teacher sees and the
// amount the wallet reserves can never drift apart.
//
// Prices come from the EducScope wallet handoff. LessonScope never subtracts
// credits itself — it only names an `action`, and wallet.js reserves this many.

// Canonical action names (EducScope wallet contract, shared across apps).
// action key → credits.
//
// An action must appear in EITHER this map or FREE below. priceFor() throws on
// anything else, so a new AI feature cannot reach production quietly costing
// nothing — being free has to be a decision someone wrote down.
const PRICES = {
  // Five documents (worksheet, exit ticket, quiz, homework, differentiated) —
  // a discount on buying them singly, but no longer the same price as one deck.
  'lessonscope.generate_lesson_pack': 4,
  'lessonscope.generate_slide_deck': 3,     // slide deck only  (POST /api/generate)
  'lessonscope.import_plan_to_slides': 3,   // import a lesson plan → slides (same work as a deck)
  'lessonscope.generate_pack_item': 1,      // worksheet / exit ticket / quiz on its own
  'lessonscope.generate_game': 1,           // classroom game only
  // Images and diagrams are the only actions where the AI cost is material: an
  // image costs ~$0.04, roughly 15x a whole deck. At the old prices they ran at
  // ~6x markup against 96x for a deck — the thinnest margin in the catalogue and
  // the reason a farmed account was worth farming. Repricing also improves the
  // subscription model's conservative cost basis (see docs/monetization-roadmap.md).
  'lessonscope.generate_diagram': 3,        // AI diagram for a slide
  'lessonscope.generate_ai_image': 5,       // AI image for a slide
  // A lesson plan is a standalone deliverable — a full structured generation the
  // teacher can download as .docx without ever making slides — so it is priced
  // like one. Was free "during beta" while nothing charged for it, which left it
  // the largest unbilled AI call in the app. Override with LESSON_PLAN_CREDITS.
  'lessonscope.generate_lesson_plan': (() => {
    const v = parseInt(process.env.LESSON_PLAN_CREDITS, 10);
    return Number.isFinite(v) && v >= 0 ? v : 2;
  })(),
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
  'lessonscope.generate_lesson_plan': 'Lesson plan',
  'lessonscope.regenerate_slide': 'Regenerate slide',
};

// Explicitly-free actions. Every entry is a deliberate choice with a reason, not
// an oversight — an AI action that is missing from BOTH maps is a bug, and
// priceFor() throws rather than silently treating it as free.
const FREE = {
  'lessonscope.regenerate_slide': 'Free within fair-use (3 regenerations per lesson)',
  // Getting the plan to match a school's format usually takes a pass or two,
  // and that iteration happens before any deck exists. Charging per attempt
  // would tax the part of the flow teachers are most likely to repeat.
  'lessonscope.regenerate_lesson_plan': 'Free within fair-use (3 rewrites per lesson)',
  'lessonscope.import_slides': 'Parsing an existing file is free',
  // Student-triggered on submit, not teacher-triggered. Billing a teacher per
  // student answer would scale their cost with class size rather than with what
  // they chose to generate; the assignment being graded was already paid for.
  'lessonscope.auto_grade': 'Free — the assignment it grades was already paid for',
  // One upload, reused across a whole term of lessons. Charging here taxes
  // getting started, and every lesson it then feeds is charged normally.
  'lessonscope.parse_pacing_guide': 'Free — a one-off upload that later generations pay for',
  'lessonscope.parse_unit': 'Free — a one-off upload that later generations pay for',
  'lessonscope.parse_planning_framework': 'Free — reviewed once and reused across paid lesson generations',
  // Bundled: runs inside a paid generation, never on its own.
  'lessonscope.rewrite_image_query': 'Free — part of a generation you already paid for',
  // Swapping a picture on a deck the teacher already paid to generate. Note this
  // one is not cheap: it rewrites the query AND vision-captions each fetched
  // image, so it is several AI calls per search.
  'lessonscope.image_search': 'Free — picking a picture for a deck you already paid for',
  // Admin-only, and admins are exempt from billing anyway.
  'lessonscope.caption_image': 'Free — admin library maintenance',
  // The guided assistant advises on the lesson currently being built. It does
  // not generate paid artefacts or change teacher work on its own; existing
  // generation buttons keep their normal prices and wallet lifecycle.
  'lessonscope.assistant_advice': 'Included — guided curriculum-planning advice',
};

// Fair-use: regenerating one slide is free the first FREE_REGENS times per
// lesson; after that another small batch costs REGEN_BATCH_COST credits.
const FREE_REGENS = (() => { const v = parseInt(process.env.FREE_REGENS_PER_LESSON, 10); return Number.isFinite(v) && v >= 0 ? v : 3; })();
const REGEN_BATCH_COST = 1;

// Every action must be catalogued as priced or deliberately free. Anything else
// is a new feature that forgot to decide, and we refuse to guess — guessing
// means it ships free and nobody notices until the bill arrives.
function assertKnown(action) {
  if (!(action in PRICES) && !(action in FREE)) {
    throw new Error(
      `Unknown credit action "${action}". Add it to PRICES (with a cost) or FREE ` +
      `(with the reason it's free) in credit-prices.js before using it.`
    );
  }
  return action;
}

function priceFor(action) { assertKnown(action); return PRICES[action] || 0; }
function isFree(action) { assertKnown(action); return !PRICES[action]; }
function label(action) { return LABELS[action] || FREE[action] || action; }

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

module.exports = { PRICES, LABELS, FREE, FREE_REGENS, REGEN_BATCH_COST, assertKnown, priceFor, isFree, label, publicTable };
