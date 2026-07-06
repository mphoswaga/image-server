// Test data seed — 2 classes (26 students each), 4 games, rich results
// Run: node seed-test-data.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, writeJsonAtomic } = require('./storage');

const TEACHER_ID = 'c84dbb94-90ce-418d-97b3-3f3cc79ae81a'; // Mpho (admin)

// ── helpers ──────────────────────────────────────────────────────────────────
const rnd  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[rnd(0, arr.length - 1)];
const uid  = () => crypto.randomUUID().slice(0, 8);

const ROOM_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function genRoomCode() {
  let c = '';
  const b = crypto.randomBytes(6);
  for (const x of b) c += ROOM_CHARS[x % ROOM_CHARS.length];
  return c;
}

// ── student name pools ────────────────────────────────────────────────────────
const FIRST = [
  'Amara','Zinhle','Lerato','Nandi','Thandi','Ayanda','Bongi','Nomsa',
  'Siphiwe','Lungelo','Themba','Sibusiso','Mandla','Nhlanhla','Mpho',
  'Kabelo','Tebogo','Lesego','Neo','Boitumelo','Palesa','Refilwe',
  'Zanele','Lindiwe','Nokwanda','Noxolo','Sanele','Musa','Jabulani','Sipho',
  'Akhona','Lwazi','Siyanda','Phiwayinkosi','Zakhele','Mthokozisi',
  'Ntombifuthi','Busisiwe','Gcinile','Khethiwe'
];
const LAST = [
  'Dlamini','Nkosi','Mokoena','Khumalo','Ndlovu','Sithole','Mahlangu',
  'Zulu','Mthembu','Molefe','Motsepe','Letsatsi','Mabunda','Cele',
  'Buthelezi','Mkhize','Mthethwa','Ngubane','Ngcobo','Shabalala'
];

function makeStudents(prefix, count) {
  const used = new Set();
  return Array.from({ length: count }, (_, i) => {
    let first, last, key;
    do { first = pick(FIRST); last = pick(LAST); key = first+last; } while (used.has(key));
    used.add(key);
    const n = String(i + 1).padStart(3, '0');
    return { id: `${prefix}-${n}`, name: `${first} ${last}` };
  });
}

// ── rosters ───────────────────────────────────────────────────────────────────
const ROSTERS_DIR = path.join(DATA_DIR, 'users', TEACHER_ID, 'rosters');
fs.mkdirSync(ROSTERS_DIR, { recursive: true });

const roster7a = { id: crypto.randomUUID(), name: 'Grade 7A', students: makeStudents('7A', 26), createdAt: new Date().toISOString() };
const roster7b = { id: crypto.randomUUID(), name: 'Grade 7B', students: makeStudents('7B', 26), createdAt: new Date().toISOString() };

writeJsonAtomic(path.join(ROSTERS_DIR, `${roster7a.id}.json`), roster7a);
writeJsonAtomic(path.join(ROSTERS_DIR, `${roster7b.id}.json`), roster7b);
console.log(`✔ Rosters: ${roster7a.name} (${roster7a.id}) | ${roster7b.name} (${roster7b.id})`);

// ── game templates ────────────────────────────────────────────────────────────
const GAMES_DIR = path.join(DATA_DIR, 'games');
const ROOMS_PATH = path.join(GAMES_DIR, '_rooms.json');
fs.mkdirSync(GAMES_DIR, { recursive: true });

function loadRooms() { try { return JSON.parse(fs.readFileSync(ROOMS_PATH,'utf8')); } catch { return {}; } }

// 4 games: 2 per roster (different subjects)
const gameTemplates = [
  {
    subject: 'maths', topic: 'Fractions', grade: 'Grade 7', rosterId: roster7a.id,
    questions: [
      { q: 'What is ½ + ¼?',       options: ['¾', '⅔', '1', '½'],       answer: 0 },
      { q: 'Simplify 6/8',          options: ['¾', '⅔', '½', '⅗'],       answer: 0 },
      { q: 'What is ¾ × 8?',        options: ['6', '4', '8', '3'],         answer: 0 },
      { q: '2⅓ as improper fraction?', options:['7/3','5/3','4/3','8/3'], answer: 0 },
      { q: 'Which is larger: ⅗ or ½?', options:['⅗','½','Equal','Cannot tell'], answer:0 },
      { q: '1 − ⅜ = ?',             options: ['⅝', '⅞', '½', '¾'],       answer: 0 },
      { q: '¼ ÷ ½ = ?',             options: ['½', '¼', '2', '⅛'],        answer: 0 },
      { q: 'Express 0.75 as fraction', options:['¾','¼','⅔','⅗'],        answer: 0 },
    ],
    summary: { overview: 'Fractions: addition, subtraction, multiplication, division and conversion.', concepts: ['Equivalent fractions','Mixed numbers','Operations on fractions'] }
  },
  {
    subject: 'science', topic: 'The Water Cycle', grade: 'Grade 7', rosterId: roster7a.id,
    questions: [
      { q: 'What is the process where water turns to vapour?', options:['Evaporation','Condensation','Precipitation','Runoff'], answer:0 },
      { q: 'Where does most evaporation occur?',              options:['Oceans','Rivers','Lakes','Groundwater'],               answer:0 },
      { q: 'What forms when water vapour cools?',             options:['Clouds','Rain','Ice','Dew'],                           answer:0 },
      { q: 'Rain, snow and hail are all forms of…?',          options:['Precipitation','Evaporation','Condensation','Runoff'], answer:0 },
      { q: 'Water soaking into the soil is called…?',         options:['Infiltration','Runoff','Transpiration','Percolation'], answer:0 },
      { q: 'Water released by plants is called…?',            options:['Transpiration','Evaporation','Condensation','Runoff'], answer:0 },
      { q: 'Which layer stores groundwater?',                 options:['Aquifer','Bedrock','Topsoil','Mantle'],                answer:0 },
      { q: 'The water cycle is driven mainly by…?',           options:['The sun','The moon','Wind','Gravity'],                 answer:0 },
    ],
    summary: { overview: 'The continuous movement of water through evaporation, condensation and precipitation.', concepts: ['Evaporation','Condensation','Precipitation','Transpiration'] }
  },
  {
    subject: 'english', topic: 'Parts of Speech', grade: 'Grade 7', rosterId: roster7b.id,
    questions: [
      { q: 'What part of speech is "quickly"?',           options:['Adverb','Adjective','Noun','Verb'],          answer:0 },
      { q: '"Beautiful" is a…?',                           options:['Adjective','Adverb','Noun','Pronoun'],       answer:0 },
      { q: 'Which word is a pronoun?',                     options:['They','Run','Blue','Slowly'],               answer:0 },
      { q: '"Jump" is a…?',                                options:['Verb','Noun','Adjective','Adverb'],         answer:0 },
      { q: 'Identify the conjunction: "She sang and danced."', options:['and','She','sang','danced'],           answer:0 },
      { q: '"The cat sat on the mat." — "on" is a…?',     options:['Preposition','Conjunction','Article','Verb'],answer:0 },
      { q: '"Wow!" is an…?',                               options:['Interjection','Adjective','Noun','Verb'],   answer:0 },
      { q: 'Which is a proper noun?',                      options:['Johannesburg','city','river','mountain'],   answer:0 },
    ],
    summary: { overview: 'Understanding nouns, verbs, adjectives, adverbs, pronouns, prepositions, conjunctions and interjections.', concepts: ['Nouns','Verbs','Adjectives','Adverbs'] }
  },
  {
    subject: 'history', topic: 'The Scramble for Africa', grade: 'Grade 7', rosterId: roster7b.id,
    questions: [
      { q: 'The Berlin Conference that divided Africa occurred in…?', options:['1884–1885','1900–1901','1870–1871','1910–1911'], answer:0 },
      { q: 'Which country colonised South Africa?',                   options:['Britain','France','Germany','Portugal'],          answer:0 },
      { q: '"Scramble for Africa" refers to…?', options:['European colonisation of Africa','African independence','The slave trade','Gold rush in Africa'], answer:0 },
      { q: 'What did European powers seek in Africa?',               options:['Raw materials and markets','Democracy','Religion','Technological exchange'], answer:0 },
      { q: 'The Berlin Conference was hosted by…?',                  options:['Germany','France','Britain','Belgium'],            answer:0 },
      { q: 'Which African country was NEVER colonised?',             options:['Ethiopia','Nigeria','Kenya','Congo'],              answer:0 },
      { q: 'The Anglo-Boer War was fought between 1899 and…?',       options:['1902','1900','1905','1910'],                       answer:0 },
      { q: 'Cecil John Rhodes was associated with which colony?',    options:['Rhodesia (Zimbabwe)','Kenya','Nigeria','Senegal'], answer:0 },
    ],
    summary: { overview: 'European powers divide and colonise Africa during the late 19th century.', concepts: ['Berlin Conference','Colonisation','Resistance','Economic motives'] }
  },
];

// Create game files
const rooms = loadRooms();
const createdGames = gameTemplates.map((tpl, i) => {
  const id = uid();
  const roomCode = genRoomCode();
  // stagger createdAt over the last 2 weeks
  const daysAgo = (gameTemplates.length - i) * 3;
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const rec = {
    id, teacherId: TEACHER_ID, teacherName: 'Mpho',
    lessonTitle: tpl.topic, subject: tpl.subject, topic: tpl.topic, grade: tpl.grade,
    roomCode, rosterId: tpl.rosterId,
    summary: tpl.summary,
    questions: tpl.questions.map(q => ({ question: q.q, options: q.options, correctIndex: q.answer, explanation: q.explanation || '' })),
    createdAt,
  };
  writeJsonAtomic(path.join(GAMES_DIR, `${id}.json`), rec);
  rooms[roomCode] = id;
  console.log(`✔ Game: "${tpl.topic}" → ${id}  [${roomCode}]`);
  return rec;
});
writeJsonAtomic(ROOMS_PATH, rooms);

// ── results ───────────────────────────────────────────────────────────────────
// Student performance profiles so data feels real
const PROFILES = [
  { label:'star',   scoreMin:7, scoreMax:8, car:[28,55], space:[12,40], runner:[10,30], playChance:0.95 },
  { label:'strong', scoreMin:6, scoreMax:8, car:[15,40], space:[8,25],  runner:[8,20],  playChance:0.90 },
  { label:'average',scoreMin:4, scoreMax:7, car:[8,25],  space:[4,15],  runner:[4,15],  playChance:0.80 },
  { label:'weak',   scoreMin:2, scoreMax:5, car:[2,12],  space:[1,8],   runner:[1,8],   playChance:0.70 },
  { label:'absent', scoreMin:0, scoreMax:0, car:[0,0],   space:[0,0],   runner:[0,0],   playChance:0.0  },
];

function assignProfile(i) {
  // rough distribution: 2 stars, 8 strong, 10 average, 4 weak, 2 absent (out of 26)
  if (i < 2)  return PROFILES[0];
  if (i < 10) return PROFILES[1];
  if (i < 20) return PROFILES[2];
  if (i < 24) return PROFILES[3];
  return PROFILES[4];
}

const GAME_TYPES = ['car','space','runner'];

createdGames.forEach(game => {
  const roster = game.rosterId === roster7a.id ? roster7a : roster7b;
  const total = game.questions.length;
  const results = [];
  const daysAgo = (Date.now() - new Date(game.createdAt).getTime()) / 86400000;

  roster.students.forEach((stu, i) => {
    const profile = assignProfile(i);
    if (Math.random() > profile.playChance) return; // absent / didn't play

    const score = rnd(profile.scoreMin, Math.min(profile.scoreMax, total));
    // Build answers array: get `score` correct
    const correctIndices = new Set();
    while (correctIndices.size < score) correctIndices.add(rnd(0, total - 1));
    const answers = game.questions.map((q, qi) =>
      correctIndices.has(qi) ? q.answer : (q.answer + rnd(1,3)) % 4
    );

    // arcade scores — may have played multiple game types
    const arcadeScores = {};
    const gameType = pick(GAME_TYPES);
    arcadeScores[gameType] = rnd(...profile[gameType]);
    // 40% chance they also tried a second type
    if (Math.random() < 0.4) {
      const second = GAME_TYPES.filter(t => t !== gameType)[rnd(0,1)];
      arcadeScores[second] = rnd(...profile[second]);
    }

    const attempts = Math.random() < 0.3 ? 2 : 1;
    // stagger submission times
    const atOffset = rnd(1, Math.max(1, Math.floor(daysAgo))) * 86400000;
    const at = new Date(Date.now() - atOffset + rnd(0, 3600000)).toISOString();

    results.push({ studentId: stu.id, name: stu.name, score, total, answers, at, attempts, arcadeScores, gameType });
  });

  writeJsonAtomic(path.join(GAMES_DIR, `${game.id}.results.json`), results);
  console.log(`✔ Results for "${game.topic}": ${results.length}/${roster.students.length} students played`);
});

console.log('\n✅ Seed complete. Log in as mphoeduc@gmail.com to see the data.');
console.log('   Grade 7A roster:', roster7a.id);
console.log('   Grade 7B roster:', roster7b.id);
