// 30 slide theme/layout presets.
//
// Layout variants:
//   classic  – image right (or left alternating), bullets opposite
//   split    – half-bleed photo (full-height) on one side, content the other
//   banner   – coloured full-width header bar; title in white; content below
//   minimal  – clean title + underline accent; image small bottom-right
//   dark     – classic structure with dark bg + light text
//
// Extra flags:
//   multicolor – rainbow bullet colours + cycling pastel slide backgrounds
//                (designed for young learners; any layout works with it)

const PRESETS = [
  // ── Classic ──────────────────────────────────────────────────────────────
  { id: 'ocean-classic',   name: 'Ocean',      group: 'Classic', bg: 'FFFFFF', primary: '1F4E79', accent: '2E75B6', soft: 'E8F1FA', text: '2D2D2D', font: 'Arial', layout: 'classic', dark: false, multicolor: false },
  { id: 'forest-classic',  name: 'Forest',     group: 'Classic', bg: 'FFFFFF', primary: '1A5632', accent: '2E8B57', soft: 'E4F0E9', text: '2D2D2D', font: 'Arial', layout: 'classic', dark: false, multicolor: false },
  { id: 'coral-classic',   name: 'Coral',      group: 'Classic', bg: 'FFFFFF', primary: '8B2635', accent: 'C05070', soft: 'FAE8EC', text: '2D2D2D', font: 'Arial', layout: 'classic', dark: false, multicolor: false },
  { id: 'amethyst-classic',name: 'Amethyst',   group: 'Classic', bg: 'FFFFFF', primary: '4A1770', accent: '7E3FC2', soft: 'F3E8FF', text: '2D2D2D', font: 'Arial', layout: 'classic', dark: false, multicolor: false },
  { id: 'golden-classic',  name: 'Golden',     group: 'Classic', bg: 'FFFFFF', primary: '7A4100', accent: 'D4870F', soft: 'FEF3E2', text: '2D2D2D', font: 'Arial', layout: 'classic', dark: false, multicolor: false },

  // ── Split ─────────────────────────────────────────────────────────────────
  { id: 'teal-split',      name: 'Teal',       group: 'Split',   bg: 'FFFFFF', primary: '0D5C5C', accent: '1B9E9E', soft: 'E0F7F7', text: '2D3748', font: 'Arial', layout: 'split',   dark: false, multicolor: false },
  { id: 'cobalt-split',    name: 'Cobalt',     group: 'Split',   bg: 'FFFFFF', primary: '0A2D6B', accent: '1565C0', soft: 'E3EEF8', text: '2D2D2D', font: 'Arial', layout: 'split',   dark: false, multicolor: false },
  { id: 'rose-split',      name: 'Rose',       group: 'Split',   bg: 'FFFFFF', primary: '7A1A4A', accent: 'B5336A', soft: 'FCE4EC', text: '2D2D2D', font: 'Arial', layout: 'split',   dark: false, multicolor: false },
  { id: 'slate-split',     name: 'Slate',      group: 'Split',   bg: 'F8FAFB', primary: '2C3E50', accent: '4A6FA5', soft: 'EAF0F8', text: '2D2D2D', font: 'Arial', layout: 'split',   dark: false, multicolor: false },
  { id: 'sage-split',      name: 'Sage',       group: 'Split',   bg: 'F9FBFA', primary: '2D5A3D', accent: '3D8B5E', soft: 'E6F4ED', text: '2D3A30', font: 'Arial', layout: 'split',   dark: false, multicolor: false },

  // ── Banner ────────────────────────────────────────────────────────────────
  { id: 'navy-banner',     name: 'Navy',       group: 'Banner',  bg: 'FFFFFF', primary: '16213E', accent: '1A73E8', soft: 'E8EEF8', text: '2D2D2D', font: 'Arial', layout: 'banner',  dark: false, multicolor: false },
  { id: 'emerald-banner',  name: 'Emerald',    group: 'Banner',  bg: 'FFFFFF', primary: '064E3B', accent: '059669', soft: 'D1FAE5', text: '2D2D2D', font: 'Arial', layout: 'banner',  dark: false, multicolor: false },
  { id: 'maroon-banner',   name: 'Maroon',     group: 'Banner',  bg: 'FFFFFF', primary: '6B1A1A', accent: 'B71C1C', soft: 'FEE2E2', text: '2D2D2D', font: 'Arial', layout: 'banner',  dark: false, multicolor: false },
  { id: 'indigo-banner',   name: 'Indigo',     group: 'Banner',  bg: 'FFFFFF', primary: '1E1B4B', accent: '4338CA', soft: 'EDE9FE', text: '2D2D2D', font: 'Arial', layout: 'banner',  dark: false, multicolor: false },
  { id: 'amber-banner',    name: 'Amber',      group: 'Banner',  bg: 'FFFDF5', primary: '78350F', accent: 'D97706', soft: 'FEF3C7', text: '2D2D2D', font: 'Arial', layout: 'banner',  dark: false, multicolor: false },

  // ── Dark ──────────────────────────────────────────────────────────────────
  { id: 'midnight-dark',   name: 'Midnight',   group: 'Dark',    bg: '0F172A', primary: 'E2E8F0', accent: '60A5FA', soft: '1E293B', text: 'CBD5E1', font: 'Arial', layout: 'classic', dark: true,  multicolor: false },
  { id: 'deepforest-dark', name: 'Deep Forest',group: 'Dark',    bg: '071A0E', primary: 'D1FAE5', accent: '34D399', soft: '0D2618', text: 'A7F3D0', font: 'Arial', layout: 'classic', dark: true,  multicolor: false },
  { id: 'plum-dark',       name: 'Plum',       group: 'Dark',    bg: '1E0A2B', primary: 'F3E8FF', accent: 'C084FC', soft: '2D1042', text: 'DDD6FE', font: 'Arial', layout: 'classic', dark: true,  multicolor: false },

  // ── Minimal ───────────────────────────────────────────────────────────────
  { id: 'chalk-minimal',   name: 'Chalk',      group: 'Minimal', bg: 'F5F5F0', primary: '1A1A2E', accent: '4A4A8A', soft: 'E8E8E4', text: '2D2D2D', font: 'Arial', layout: 'minimal', dark: false, multicolor: false },
  { id: 'paper-minimal',   name: 'Paper',      group: 'Minimal', bg: 'FEFCE8', primary: '1C1917', accent: 'CA8A04', soft: 'FEF9C3', text: '1C1917', font: 'Arial', layout: 'minimal', dark: false, multicolor: false },

  // ── Full-bleed ────────────────────────────────────────────────────────────
  { id: 'dusk-fullbleed',   name: 'Dusk',    group: 'Full-bleed',  bg: '1A1A2E', primary: 'FFFFFF', accent: '60A5FA', soft: '1E293B', text: 'E2E8F0', font: 'Arial', layout: 'fullbleed', dark: true,  multicolor: false },
  { id: 'ember-fullbleed',  name: 'Ember',   group: 'Full-bleed',  bg: '1C0A00', primary: 'FFFFFF', accent: 'FB923C', soft: '2C1A00', text: 'FED7AA', font: 'Arial', layout: 'fullbleed', dark: true,  multicolor: false },

  // ── Two-column ────────────────────────────────────────────────────────────
  { id: 'carbon-twocol',    name: 'Carbon',  group: 'Two-column',  bg: 'F8F9FA', primary: '111827', accent: '374151', soft: 'E5E7EB', text: '374151', font: 'Arial', layout: 'twocol',    dark: false, multicolor: false },
  { id: 'azure-twocol',     name: 'Azure',   group: 'Two-column',  bg: 'FFFFFF', primary: '1F4E79', accent: '2E75B6', soft: 'E8F1FA', text: '2D2D2D', font: 'Arial', layout: 'twocol',    dark: false, multicolor: false },

  // ── Sidebar ───────────────────────────────────────────────────────────────
  { id: 'ruby-sidebar',     name: 'Ruby',    group: 'Sidebar',     bg: 'FFFFFF', primary: '9B1C1C', accent: 'E53E3E', soft: 'FFF5F5', text: '2D2D2D', font: 'Arial', layout: 'sidebar',   dark: false, multicolor: false },
  { id: 'admiral-sidebar',  name: 'Admiral', group: 'Sidebar',     bg: 'FFFFFF', primary: '1E3A5F', accent: '2B6CB0', soft: 'EBF8FF', text: '2D2D2D', font: 'Arial', layout: 'sidebar',   dark: false, multicolor: false },

  // ── Splash ────────────────────────────────────────────────────────────────
  { id: 'violet-splash',    name: 'Violet',  group: 'Splash',      bg: 'FAF5FF', primary: '5B21B6', accent: '7C3AED', soft: 'EDE9FE', text: '2D1F4A', font: 'Arial', layout: 'splash',    dark: false, multicolor: false },
  { id: 'pine-splash',      name: 'Pine',    group: 'Splash',      bg: 'F0FDF4', primary: '064E3B', accent: '059669', soft: 'D1FAE5', text: '022C22', font: 'Arial', layout: 'splash',    dark: false, multicolor: false },

  // ── Playful / young-learner (rainbow bullets + cycling pastel bgs) ─────────
  { id: 'sunshine-banner',    name: 'Sunshine',   group: 'Playful', bg: 'FFFBEB', primary: 'B45309', accent: 'FBBF24', soft: 'FEF3C7', text: '292524', font: 'Arial', layout: 'banner',  dark: false, multicolor: true },
  { id: 'strawberry-classic', name: 'Strawberry', group: 'Playful', bg: 'FFF1F2', primary: 'BE123C', accent: 'FB7185', soft: 'FFE4E6', text: '1C0A0A', font: 'Arial', layout: 'classic', dark: false, multicolor: true },
  { id: 'skyblue-split',      name: 'Sky Blue',   group: 'Playful', bg: 'F0F9FF', primary: '0284C7', accent: '38BDF8', soft: 'E0F2FE', text: '082F49', font: 'Arial', layout: 'split',   dark: false, multicolor: true },
  { id: 'limeburst-banner',   name: 'Lime Burst', group: 'Playful', bg: 'F7FEE7', primary: '3F6212', accent: '84CC16', soft: 'ECFCCB', text: '1A2E05', font: 'Arial', layout: 'banner',  dark: false, multicolor: true },
  { id: 'tangerine-classic',  name: 'Tangerine',  group: 'Playful', bg: 'FFF7ED', primary: 'C2410C', accent: 'FB923C', soft: 'FFEDD5', text: '431407', font: 'Arial', layout: 'classic', dark: false, multicolor: true },
  { id: 'bubblegum-banner',   name: 'Bubblegum',  group: 'Playful', bg: 'FDF4FF', primary: '7E22CE', accent: 'E879F9', soft: 'FAE8FF', text: '3B0764', font: 'Arial', layout: 'banner',  dark: false, multicolor: true },
  { id: 'lavender-split',     name: 'Lavender',   group: 'Playful', bg: 'F5F3FF', primary: '4338CA', accent: 'A78BFA', soft: 'EDE9FE', text: '1E1B4B', font: 'Arial', layout: 'split',   dark: false, multicolor: true },
  { id: 'mint-classic',       name: 'Mint',       group: 'Playful', bg: 'F0FDF4', primary: '15803D', accent: '4ADE80', soft: 'DCFCE7', text: '052E16', font: 'Arial', layout: 'classic', dark: false, multicolor: true },
  { id: 'poppy-banner',       name: 'Poppy',      group: 'Playful', bg: 'FFF1F2', primary: '9F1239', accent: 'FB7185', soft: 'FFE4E6', text: '4C0519', font: 'Arial', layout: 'banner',  dark: false, multicolor: true },
  { id: 'aqua-split',         name: 'Aqua',       group: 'Playful', bg: 'ECFEFF', primary: '0E7490', accent: '22D3EE', soft: 'CFFAFE', text: '083344', font: 'Arial', layout: 'split',   dark: false, multicolor: true },
];

const DEFAULT_PRESET_ID = 'ocean-classic';

function getPreset(id) {
  return PRESETS.find(p => p.id === id) || PRESETS[0];
}

module.exports = { PRESETS, DEFAULT_PRESET_ID, getPreset };
