// Maps a free-text grade ("grade 2", "year 9", "kindergarten", "high school")
// to a profile that drives BOTH the written content (how much text, how deep)
// and the visual design (font sizes, colors, density) of the slides.

const PROFILES = {
  // Early grades: few words, very large text, bright colors, one idea per bullet.
  early: {
    band: 'early',
    label: 'early grades',
    content: {
      bullets: '2 to 3',
      wordsPerBullet: '3 to 6 words',
      notes: '1 to 2 short, simple sentences',
      depth: 'Use concrete, age-appropriate language and short sentences — one clear idea per bullet, no jargon. Pitch to the EXACT grade given; do not default to the youngest level.',
    },
    theme: {
      titleSize: 40,
      bulletSize: 26,
      paraSpaceAfter: 18,
      colorful: true, // each bullet a different bright color
      bulletPalette: ['D6336C', '1971C2', 'E8833A', '2F9E44', '7048E8'],
      accent: 'E8833A',
      bulletGlyph: '25CF', // big filled circle
      playful: true,                                              // playful design for little learners
      pastels: ['FFF4E6', 'E7F5EC', 'EDE9FB', 'FCEAF1', 'E6F2FB', 'FFF9DB'],
      bulletEmojis: ['⭐', '🌈', '🎈', '🍀', '🚀', '🐢', '🎨', '🔆'],
      rounding: true,
    },
  },
  // Middle grades: balanced — short phrases, medium text.
  middle: {
    band: 'middle',
    label: 'middle grades',
    content: {
      bullets: '3 to 4',
      wordsPerBullet: 'short phrases (up to ~10 words)',
      notes: '2 to 3 sentences',
      depth: 'Clear explanations pitched to the EXACT grade given; define new terms briefly; include some reasoning, not just facts.',
    },
    theme: {
      titleSize: 30,
      bulletSize: 19,
      paraSpaceAfter: 12,
      colorful: false,
      bulletPalette: ['333333'],
      accent: '2E75B6',
      bulletGlyph: '2022',
    },
  },
  // Senior grades: more text, deeper, denser, formal.
  senior: {
    band: 'senior',
    label: 'senior grades',
    content: {
      bullets: '4 to 6',
      wordsPerBullet: 'a phrase or short sentence each',
      notes: '3 to 4 sentences with extra detail',
      depth: 'Pitch to the EXACT grade/year given. Go deeper: include reasoning, correct terminology, and a concrete example or nuance on most slides — more advanced for higher grades.',
    },
    theme: {
      titleSize: 26,
      bulletSize: 15,
      paraSpaceAfter: 8,
      colorful: false,
      bulletPalette: ['333333'],
      accent: '1F4E79',
      bulletGlyph: '2022',
    },
  },
};

// Approximate student age for a grade — gives the LLM a precise calibration cue
// (so "grade 2" isn't treated the same as Reception/Grade R).
function ageFor(grade) {
  const g = String(grade || '').toLowerCase();
  if (/kinder|reception|grade r\b|pre-?k|nursery/.test(g)) return 5;
  const m = g.match(/\d+/);
  if (m) { const n = parseInt(m[0], 10); return /year/.test(g) ? n + 5 : n + 6; } // grade N ≈ N+6 yrs
  if (/high ?school|secondary/.test(g)) return 15;
  if (/college|university|tertiary/.test(g)) return 19;
  if (/middle/.test(g)) return 12;
  if (/elementary|primary|infant/.test(g)) return 8;
  return 11;
}

function gradeProfile(grade) {
  const g = String(grade || '').toLowerCase();

  // Keyword overrides first.
  if (/kinder|reception|pre-?k|grade r\b|nursery/.test(g)) return PROFILES.early;
  if (/high ?school|secondary|college|university|tertiary|senior/.test(g)) return PROFILES.senior;

  // Numeric grade/year, if present.
  const m = g.match(/\d+/);
  if (m) {
    const n = parseInt(m[0], 10);
    if (n <= 3) return PROFILES.early;
    if (n <= 7) return PROFILES.middle;
    return PROFILES.senior;
  }

  if (/middle/.test(g)) return PROFILES.middle;
  if (/elementary|primary|infant/.test(g)) return PROFILES.early;
  return PROFILES.middle; // sensible default
}

module.exports = { gradeProfile, ageFor };
