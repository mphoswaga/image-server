'use strict';
const core = require('./public/colonyquest-core');
const beats = {
  intro: {
    title: 'The quest for the Ancient Acorn',
    speaker: 'Pip',
    line: 'Grow your colony. Brave the seasons. Bring the Ancient Acorn home!',
    seconds: 5,
    art: 'pip-worker',
  },
  'fallen-fruit': {
    title: 'The golden berry falls!',
    speaker: 'Pip',
    line: 'A feast! Carry the berry pieces into the pantry.',
    seconds: 4.5,
    art: 'pip-worker',
  },
  dry: {
    title: 'The dry season arrives',
    speaker: 'Queen Aurelia',
    line: 'Our stored food will keep the workers going.',
    seconds: 4,
    art: 'queen',
  },
  'food-trail': {
    title: 'Pip finds a golden trail',
    speaker: 'Pip',
    line: 'Follow the seeds. Bring the harvest home!',
    seconds: 4.5,
    art: 'pip-worker',
  },
  predator: {
    title: 'A spider at the entrance!',
    speaker: 'Bramble',
    line: 'Guards, protect the food! Workers, head inside!',
    seconds: 5,
    art: 'guardian',
  },
  'tunnel-collapse': {
    title: 'The tunnel has fallen in!',
    speaker: 'Dot',
    line: 'Clear the stones together. Open our path home!',
    seconds: 4.5,
    art: 'pip-worker',
  },
  rain: {
    title: 'The Great Rain',
    speaker: 'Dot',
    line: 'Level 2 walls keep the pantry dry. Take shelter!',
    seconds: 5,
    art: 'pip-worker',
  },
  'lost-ant': {
    title: 'A little scout is lost!',
    speaker: 'Pip',
    line: 'Follow our glowing trail. You are nearly home!',
    seconds: 4.5,
    art: 'pip-worker',
  },
  'new-territory': {
    title: 'A hidden root reveals a path',
    speaker: 'Dot',
    line: 'Sticks and leaves can turn this discovery into a new room.',
    seconds: 4.5,
    art: 'pip-worker',
  },
  'birds-warning': {
    title: 'Shadows over the meadow',
    speaker: 'Bramble',
    line: 'Hungry birds! Level 3 walls protect our stored food.',
    seconds: 3,
    art: 'guardian',
  },
  birds: {
    title: 'Protect the pantry!',
    speaker: 'Bramble',
    line: 'Stay below ground while the birds sweep past.',
    seconds: 5,
    art: 'guardian',
  },
  'footsteps-warning': {
    title: 'The ground is trembling…',
    speaker: 'Dot',
    line: 'A human is coming. Build Level 4 walls before the final step!',
    seconds: 3.5,
    art: 'pip-worker',
  },
  footsteps: {
    title: 'The giant crosses Moonroot Meadow',
    speaker: 'Bramble',
    line: 'Hold together! Strong walls protect the colony.',
    seconds: 5.5,
    art: 'guardian',
  },
  acorn: {
    title: 'The Ancient Acorn is ours!',
    speaker: 'Queen Aurelia',
    line: 'Every colony made the journey. Celebrate our meadow champions!',
    seconds: 6,
    art: 'queen',
  },
};

// Long games contain every encounter; short games use a shorter story, as on the board.
// All scheduling is by completed questions, never by device speed or arrival time.
function schedule(total) {
  const rounds = {};
  const add = (round, key) => (rounds[round] ||= []).push(key);
  if (total > 1) {
    const beforeEnd = (fraction) => Math.min(total - 1, Math.max(1, Math.ceil(total * fraction)));
    const encounters = [
      'fallen-fruit',
      'food-trail',
      'predator',
      'tunnel-collapse',
      'lost-ant',
      'new-territory',
    ];
    const places = [0.1, 0.28, 0.37, 0.44, 0.6, 0.68];
    // Do not stack six optional encounters into a two-question teacher test.
    const count = total >= 8 ? 6 : Math.max(1, total - 2);
    for (let i = 0; i < count; i++) add(beforeEnd(places[i]), encounters[i]);
    add(beforeEnd(0.2), 'dry');
    add(beforeEnd(0.5), 'rain');
    if (total >= 4) {
      add(beforeEnd(0.76), 'birds-warning');
      add(beforeEnd(0.76), 'birds');
      add(beforeEnd(0.9), 'footsteps-warning');
    }
  }
  if (total < 4) {
    add(total, 'birds-warning');
    add(total, 'birds');
    add(total, 'footsteps-warning');
  }
  add(total, 'footsteps');
  add(total, 'acorn');
  const order = [
    'fallen-fruit',
    'dry',
    'food-trail',
    'predator',
    'tunnel-collapse',
    'rain',
    'lost-ant',
    'new-territory',
    'birds-warning',
    'birds',
    'footsteps-warning',
    'footsteps',
    'acorn',
  ];
  for (const keys of Object.values(rounds)) keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return rounds;
}

function apply(match, key) {
  const s = match.state,
    teams = match.teams(),
    world = match.world();
  const before = new Map(
    teams.map((t) => [t.id, { food: t.food, rooms: t.territory, penalty: t.collapsePenalty || 0 }]),
  );
  if (key === 'dry') core.applyDrySeason(world);
  else if (key === 'rain') core.applyRain(world);
  else if (key === 'birds-warning') {
    world.birdStage = 'warning';
    world.birdStageMs = 3000;
    teams.forEach((t) => {
      t.birdsIncoming = core.birdCount(t);
    });
  } else if (key === 'birds') {
    core.resolveBirds(world);
    world.birdStage = 'attack';
    world.birdStageMs = 5000;
  } else if (key === 'footsteps') {
    // The board requires two submitted answers for a footstep penalty. An absent
    // learner must not suppress the finale for every other individual colony.
    const eligible = teams.filter((t) => t.attempts >= 2);
    const eligibleWorld = { ...world, teams: eligible };
    core.applyHumanStomp(eligibleWorld);
    world.stompOccurred = true;
  } else if (core.EVENTS.some((e) => e.key === key)) core.applyEvent(teams, key);
  const { teams: unused, phase, ...rest } = world;
  s.world = rest;
  return teams.map((t) => {
    const b = before.get(t.id),
      food = t.food - b.food,
      rooms = t.territory - b.rooms;
    const pointsLost = (t.collapsePenalty || 0) - b.penalty;
    let message =
      food > 0
        ? `+${food} food for your colony`
        : food < 0
          ? `${-food} food used or lost`
          : 'Your stores are safe';
    if (key === 'dry')
      message = t.dryShortfall
        ? `Need ${t.dryShortfall} food · workers slow down`
        : 'Your food stores fed the colony';
    if (key === 'rain')
      message = food < 0 ? `${-food} food lost · build stronger walls` : 'Your walls kept the pantry dry';
    if (key === 'birds')
      message =
        food < 0
          ? `${-food} food taken · Level 3 walls protect it`
          : t.defense >= 2
            ? 'Your walls stopped the birds!'
            : 'No stored food was lost';
    if (key === 'predator')
      message = food < 0 ? `${-food} food lost · guards and walls help` : 'Your colony protected its food!';
    if (key === 'tunnel-collapse')
      message = food < 0 ? `${-food} food lost while repairing` : 'Your workers reopened the tunnel safely';
    if (key === 'new-territory')
      message =
        rooms > 0 ? 'A new room! Building materials used' : 'Keep gathering materials for your next room';
    if (key === 'lost-ant')
      message =
        food > 0 ? `The scout shared ${food} food with your colony!` : 'The scout found a safe way home';
    if (key === 'footsteps')
      message = pointsLost
        ? `${pointsLost} colony points lost · learning marks unchanged`
        : t.defense >= 3
          ? 'Your Level 4 walls held strong!'
          : 'Practice journey · no footstep penalty';
    if (['intro', 'birds-warning', 'footsteps-warning', 'acorn'].includes(key)) message = '';
    return { playerId: t.id, food, rooms, pointsLost, message };
  });
}
module.exports = { beats, schedule, apply };
