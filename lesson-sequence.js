'use strict';

function sequenceDetails(sequence) {
  const lessonCount = Math.min(5, Math.max(2, parseInt(sequence && sequence.lessonCount, 10) || 3));
  const periodMinutes = Math.min(180, Math.max(5, parseInt(sequence && sequence.periodMinutes, 10) || 35));
  return { lessonCount, periodMinutes };
}

function groupSectionsByLesson(sections, sequence) {
  const { lessonCount } = sequenceDetails(sequence);
  const groups = Array.from({ length: lessonCount }, () => []);

  for (const section of (Array.isArray(sections) ? sections : [])) {
    const lesson = parseInt(section && section.lesson, 10);
    if (lesson >= 1 && lesson <= lessonCount) groups[lesson - 1].push(section);
  }

  const missing = groups
    .map((group, index) => (group.length ? null : index + 1))
    .filter(Boolean);
  if (missing.length) {
    throw new Error(`The lesson sequence was incomplete (missing lesson${missing.length > 1 ? 's' : ''} ${missing.join(', ')}). Please generate it again.`);
  }
  return groups;
}

function assertLessonFields(groups, outline) {
  const required = (Array.isArray(outline) ? outline : []).filter(field => field && field.authored !== false);
  const norm = value => String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  (Array.isArray(groups) ? groups : []).forEach((sections, lessonIndex) => {
    const taken = new Set();
    const missing = [];
    for (const field of required) {
      const want = norm(field.label);
      let match = sections.findIndex((section, index) => !taken.has(index) && norm(section && section.heading) === want);
      if (match < 0) {
        match = sections.findIndex((section, index) => {
          if (taken.has(index)) return false;
          const got = norm(section && section.heading);
          return got && want && (got.includes(want) || want.includes(got));
        });
      }
      if (match < 0) missing.push(field.label);
      else taken.add(match);
    }
    if (missing.length) {
      throw new Error(`Lesson ${lessonIndex + 1} was missing school field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Please generate it again.`);
    }
  });
}

function combineOrderedLessons(orderedLessons, outline, sequence) {
  const { lessonCount, periodMinutes } = sequenceDetails(sequence);
  const fields = Array.isArray(outline) ? outline : [];
  const lessons = Array.isArray(orderedLessons) ? orderedLessons : [];
  const shared = new Set([
    'subject', 'unit', 'topic', 'periodAndLength', 'redThread',
    'objectives', 'successCriteria', 'postLessonReflection',
  ]);

  const combined = fields.map((field, fieldIndex) => {
    const first = (lessons[0] && lessons[0][fieldIndex]) || {
      heading: field.label,
      content: '',
      stageId: 'teach',
      fieldKey: field.key || null,
    };
    if (shared.has(field.key)) return first;

    const content = lessons.map((ordered, index) => {
      const section = ordered && ordered[fieldIndex];
      return [
        `Lesson ${index + 1} of ${lessonCount} (${periodMinutes} minutes)`,
        String(section && section.content || '').trim(),
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    return { ...first, content };
  });

  // Preserve anything the model returned outside the school's known rows.
  // These remain visible to the teacher, while only fieldKey rows are filed.
  lessons.forEach((ordered, lessonIndex) => {
    for (const section of (ordered || []).slice(fields.length)) {
      if (!String(section && section.content || '').trim()) continue;
      combined.push({
        ...section,
        content: `Lesson ${lessonIndex + 1} of ${lessonCount} (${periodMinutes} minutes)\n${String(section.content).trim()}`,
      });
    }
  });

  return combined;
}

module.exports = { sequenceDetails, groupSectionsByLesson, assertLessonFields, combineOrderedLessons };
