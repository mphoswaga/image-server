// 20 slide theme/layout presets. Each preset sets the full colour palette
// and a layout variant that changes how content slides are structured.
//
// Layout variants:
//   classic  – image right (or left alternating), bullets opposite  [current default]
//   split    – half-bleed photo (full-height) on one side, content the other
//   banner   – coloured full-width header bar; title in white; content below
//   minimal  – clean title + underline accent; bullets centred; small image bottom-right
//   dark     – same structure as classic but with dark bg + light text

const PRESETS = [
  // ── Group 1: Classic layout, light backgrounds ───────────────────────────
  { id: 'ocean-classic',   name: 'Ocean',          bg: 'FFFFFF', primary: '1F4E79', accent: '2E75B6', soft: 'E8F1FA', text: '2D2D2D', font: 'Arial',    layout: 'classic', dark: false },
  { id: 'forest-classic',  name: 'Forest',         bg: 'FFFFFF', primary: '1A5632', accent: '2E8B57', soft: 'E4F0E9', text: '2D2D2D', font: 'Arial',    layout: 'classic', dark: false },
  { id: 'coral-classic',   name: 'Coral',          bg: 'FFFFFF', primary: '8B2635', accent: 'C05070', soft: 'FAE8EC', text: '2D2D2D', font: 'Arial',    layout: 'classic', dark: false },
  { id: 'amethyst-classic',name: 'Amethyst',       bg: 'FFFFFF', primary: '4A1770', accent: '7E3FC2', soft: 'F3E8FF', text: '2D2D2D', font: 'Arial',    layout: 'classic', dark: false },
  { id: 'golden-classic',  name: 'Golden',         bg: 'FFFFFF', primary: '7A4100', accent: 'D4870F', soft: 'FEF3E2', text: '2D2D2D', font: 'Arial',    layout: 'classic', dark: false },

  // ── Group 2: Split layout (half-bleed photo) ─────────────────────────────
  { id: 'teal-split',      name: 'Teal',           bg: 'FFFFFF', primary: '0D5C5C', accent: '1B9E9E', soft: 'E0F7F7', text: '2D3748', font: 'Arial',    layout: 'split',   dark: false },
  { id: 'cobalt-split',    name: 'Cobalt',         bg: 'FFFFFF', primary: '0A2D6B', accent: '1565C0', soft: 'E3EEF8', text: '2D2D2D', font: 'Arial',    layout: 'split',   dark: false },
  { id: 'rose-split',      name: 'Rose',           bg: 'FFFFFF', primary: '7A1A4A', accent: 'B5336A', soft: 'FCE4EC', text: '2D2D2D', font: 'Arial',    layout: 'split',   dark: false },
  { id: 'slate-split',     name: 'Slate',          bg: 'F8FAFB', primary: '2C3E50', accent: '4A6FA5', soft: 'EAF0F8', text: '2D2D2D', font: 'Arial',    layout: 'split',   dark: false },
  { id: 'sage-split',      name: 'Sage',           bg: 'F9FBFA', primary: '2D5A3D', accent: '3D8B5E', soft: 'E6F4ED', text: '2D3A30', font: 'Arial',    layout: 'split',   dark: false },

  // ── Group 3: Banner layout (coloured full-width top bar) ─────────────────
  { id: 'navy-banner',     name: 'Navy',           bg: 'FFFFFF', primary: '16213E', accent: '1A73E8', soft: 'E8EEF8', text: '2D2D2D', font: 'Arial',    layout: 'banner',  dark: false },
  { id: 'emerald-banner',  name: 'Emerald',        bg: 'FFFFFF', primary: '064E3B', accent: '059669', soft: 'D1FAE5', text: '2D2D2D', font: 'Arial',    layout: 'banner',  dark: false },
  { id: 'maroon-banner',   name: 'Maroon',         bg: 'FFFFFF', primary: '6B1A1A', accent: 'B71C1C', soft: 'FEE2E2', text: '2D2D2D', font: 'Arial',    layout: 'banner',  dark: false },
  { id: 'indigo-banner',   name: 'Indigo',         bg: 'FFFFFF', primary: '1E1B4B', accent: '4338CA', soft: 'EDE9FE', text: '2D2D2D', font: 'Arial',    layout: 'banner',  dark: false },
  { id: 'amber-banner',    name: 'Amber',          bg: 'FFFDF5', primary: '78350F', accent: 'D97706', soft: 'FEF3C7', text: '2D2D2D', font: 'Arial',    layout: 'banner',  dark: false },

  // ── Group 4: Dark backgrounds ─────────────────────────────────────────────
  { id: 'midnight-dark',   name: 'Midnight',       bg: '0F172A', primary: 'E2E8F0', accent: '60A5FA', soft: '1E293B', text: 'CBD5E1', font: 'Arial',    layout: 'classic', dark: true  },
  { id: 'deepforest-dark', name: 'Deep Forest',    bg: '071A0E', primary: 'D1FAE5', accent: '34D399', soft: '0D2618', text: 'A7F3D0', font: 'Arial',    layout: 'classic', dark: true  },
  { id: 'plum-dark',       name: 'Plum',           bg: '1E0A2B', primary: 'F3E8FF', accent: 'C084FC', soft: '2D1042', text: 'DDD6FE', font: 'Arial',    layout: 'classic', dark: true  },

  // ── Group 5: Minimal layout (clean type + accent underline) ──────────────
  { id: 'chalk-minimal',   name: 'Chalk',          bg: 'F5F5F0', primary: '1A1A2E', accent: '4A4A8A', soft: 'E8E8E4', text: '2D2D2D', font: 'Arial',    layout: 'minimal', dark: false },
  { id: 'paper-minimal',   name: 'Paper',          bg: 'FEFCE8', primary: '1C1917', accent: 'CA8A04', soft: 'FEF9C3', text: '1C1917', font: 'Arial',    layout: 'minimal', dark: false },
];

const DEFAULT_PRESET_ID = 'ocean-classic';

function getPreset(id) {
  return PRESETS.find(p => p.id === id) || PRESETS[0];
}

module.exports = { PRESETS, DEFAULT_PRESET_ID, getPreset };
