// Objectives and success criteria taken off a teacher's own slides.
//
// The rule these exist to respect: learning objectives are the school's words,
// copied from the pacing guide, and are never reworded. A teacher who imports
// their own deck has no pacing guide in the app, so the only place their
// wording exists is the slides — and it must arrive unchanged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { objectivesFromDeck, criteriaFromDeck } = require('../deck-fields.js');

const DECK = {
  slides: [
    { title: 'Using the Mouse', bullets: ['A mouse moves the pointer.'] },
    { title: 'Learning Objectives', bullets: [
      'LO1. Identify the left and right mouse buttons.',
      'LO2. Click, double-click and drag accurately.',
    ] },
    { title: 'Success Criteria', bullets: ['I can double-click to open a folder.'] },
    { title: 'Watch this', type: 'video', bullets: ['Objectives: something in a video slide'] },
  ],
};

test('objectives come back exactly as the slide states them', () => {
  assert.equal(objectivesFromDeck(DECK),
    'LO1. Identify the left and right mouse buttons.\nLO2. Click, double-click and drag accurately.');
});

test('success criteria are lifted too, and kept separate from objectives', () => {
  assert.equal(criteriaFromDeck(DECK), 'I can double-click to open a folder.');
  assert.doesNotMatch(objectivesFromDeck(DECK), /double-click to open/);
});

test('video slides are never a source', () => {
  assert.doesNotMatch(objectivesFromDeck(DECK), /something in a video slide/);
});

test('the many ways schools title an objectives slide are recognised', () => {
  for (const title of ['Objectives', 'LOs', 'WALT', 'We are learning', 'Learning outcomes', 'Aims']) {
    assert.equal(objectivesFromDeck({ slides: [{ title, bullets: ['x'] }] }), 'x', `missed "${title}"`);
  }
  for (const title of ['Success Criteria', 'WILF', 'I can', 'SC']) {
    assert.equal(criteriaFromDeck({ slides: [{ title, bullets: ['y'] }] }), 'y', `missed "${title}"`);
  }
});

test('a deck with no objectives slide yields nothing, rather than something invented', () => {
  const deck = { slides: [{ title: 'Using the Mouse', bullets: ['A mouse moves the pointer.'] }] };
  assert.equal(objectivesFromDeck(deck), '');
  assert.equal(criteriaFromDeck(deck), '');
  assert.equal(objectivesFromDeck({}), '');
  assert.equal(objectivesFromDeck(null), '');
});

test('a slide that merely mentions objectives mid-title is not treated as one', () => {
  // The match is anchored, so "Reviewing our objectives from last week" — a
  // recap slide — does not become the LO row.
  assert.equal(objectivesFromDeck({ slides: [{ title: 'Reviewing our objectives', bullets: ['x'] }] }), '');
});
