// Authoritative teaching descriptions; gameplay state and rules stay in the game modules.
const GUIDES = Object.freeze({
  moonquest: {
    name: 'MoonQuest', defaultMode: 'duels', modes: {
      duels: 'Rabbit teams compete in friendly duels to light the Moon Festival. Every learner answers each question by selecting the requested areas of a teacher-prepared diagram. Follow the displayed selection count and lock in the answer. Learners confirm before changing a locked answer. Answer reveals support discussion and feedback.',
      cooperative: 'Learners select the requested areas of a teacher-prepared diagram, discuss their reasoning and learn from answer reveals during a Moon Festival adventure. Do not promise duels in this mode.',
    },
    joining: 'Learners open the teacher link, choose their own name and enter their PIN. The teacher prepares teams and attendance before opening sign-in in duel mode.',
    preparation: 'Prepare and review the playable mission, diagrams, labelled answer areas and accepted answers. A slide showing questions does not create the mission or its diagram.',
    feedback: 'Use live responses to identify misconceptions. Learners can request the shared extra time allowed by the game. A class meeting may pause play; the teacher resumes after discussion. Follow the current room settings rather than promising a fixed question timer.',
  },
  colonyquest: {
    name: 'ColonyQuest', defaultMode: 'smartboard', modes: {
      smartboard: 'Teams play on one smartboard. The active learner discusses with the team and selects an answer. Correct answers unlock a colony upgrade. Ants gather resources and the colony prepares for environmental threats. Use questions to assess the lesson concepts; the game is not a research or practical-computing tool.',
      multiplayer: 'Learners play on their own devices with individual colonies. They answer questions, choose earned upgrades and can raid rival colonies when the game permits. Do not describe these as smartboard teams.',
    }, joining: 'For smartboard play the teacher assigns teams and learners take turns at the board. For individual multiplayer use the teacher’s learner link and the existing roster/PIN sign-in.',
    preparation: 'Prepare reviewed lesson questions and select the correct mode. For smartboard play confirm teams and absent learners before starting.',
    feedback: 'Use answers and explanations to check understanding. Colony strength, raids and game points do not prove learning mastery.',
  },
  fishquest: {
    name: 'FishQuest', defaultMode: 'smartboard', modes: {
      smartboard: 'Each learner has a named fish in a team on the smartboard. Learners take turns answering, supported by team discussion. Correct answers feed their fish and team; fish grow as play progresses. This is the on-screen game, not a paper question-card quiz.',
      individual: 'Learners play on their own devices, eat plankton, answer lesson questions and grow their fish. Do not describe one shared board or assigned smartboard turns.',
    }, joining: 'In smartboard mode the teacher selects the class and teams; learners take turns at the board. For individual play use the learner game link and roster/PIN sign-in.',
    preparation: 'Prepare the playable game and reviewed lesson questions. Confirm the class, attendance and selected play mode.',
    feedback: 'Ask learners to explain answers and use response evidence for follow-up teaching. Food and fish growth are game rewards, not assessment marks.',
  },
  arcade: {
    name: 'Arcade quiz', defaultMode: 'individual', modes: { individual: 'Learners choose an available arcade game and answer the lesson’s questions during play. Different games share the lesson questions but have different movement controls.' },
    joining: 'Use the teacher’s learner link, select a name and enter the learner PIN.', preparation: 'Prepare and review the question set and learner access.', feedback: 'Use question responses, not arcade scores, to identify support needs.',
  },
});
const STUDENT_STEPS = {
  'moonquest:duels':['Join your rabbit team: choose your name and enter your PIN.','Select the number of diagram areas shown, then lock your answer.','Confirm any change. Tap “Need more time” if needed.'],
  'moonquest:cooperative':['Open your teacher’s link, choose your name and enter your PIN.','Select the number of diagram areas shown, then lock your answer.','Confirm any change. Tap “Need more time” if needed.'],
  'colonyquest:smartboard':['Talk with your team about the question.','When it is your turn, choose an answer on the board.','Choose your earned colony upgrade and watch what the ants do.'],
  'colonyquest:multiplayer':['Open the learner link, choose your name and enter your PIN.','Answer questions and choose upgrades for your own colony.','Prepare for threats and choose raids when available.'],
  'fishquest:smartboard':['Find your named fish in your team.','Discuss the question. On your turn, tap one answer.','Correct answers feed your fish and team. Watch your fish grow!'],
  'fishquest:individual':['Open the learner link, choose your name and enter your PIN.','Move your fish to collect plankton and answer lesson questions.','Keep learning as your fish grows.'],
  'arcade:individual':['Open the learner link, choose your name and enter your PIN.','Choose a game and follow its movement controls.','Answer the lesson questions during play.'],
};
function describeGame(game) {
  if (!game) return null;
  const guide = GUIDES[game.mode];
  if (!guide) throw new Error('Choose a supported lesson game.');
  const mode = game.playMode || guide.defaultMode;
  if (!guide.modes[mode]) throw new Error('Choose a supported play mode for ' + guide.name + '.');
  return { name: guide.name, mode, studentSteps: STUDENT_STEPS[game.mode+':'+mode], gameplay: guide.modes[mode], joining: guide.joining, preparation: guide.preparation, feedback: guide.feedback, startMinute: game.startMinute, durationMinutes: game.durationMinutes, existingId: game.existingId || null };
}
function gamePrompt(game) {
  const guide = describeGame(game);
  return guide ? '\nACTUAL SELECTED GAME (authoritative over obsolete game text in the plan):\n' + JSON.stringify(guide) + '\nConnect these mechanics to the learning objective. Keep learner instructions brief and teacher preparation in notes. Do not claim a playable game, diagram or worksheet has been created. Label any paper alternative as a backup only.\n' : '';
}
module.exports = { GUIDES, describeGame, gamePrompt };
