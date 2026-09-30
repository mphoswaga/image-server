const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const QRCode = require('qrcode');
const {createRateLimiter}=require('./security');
const { createStore, validateGame } = require('./moonquest');
const { generateQuestions } = require('./moonquest-ai');
const { writeJsonAtomic, writeFileAtomic } = require('./storage');

function installMoonQuest(app, deps) {
  const { requireAuth, sessionSecret, roster, studentAccount, learnerPickerEntries, studentHandle, joinLimiter, generationLimiter, uploadLimiter, reserve, capture, release, declareFree, costOf } = deps;
  const store = createStore();
  const observer = require('./moonquest-observer').observerService(store);
  const teamProfiles = require('./class-game-teams').createTeamProfiles();
  const base = '/api/games/moonquest';
  // Room discovery must not consume the PIN-attempt budget on a shared school IP.
  const roomLookupLimiter=createRateLimiter({name:'moonquest-room-lookup',windowMs:60000,max:240});
  app.use(base, (_req, res, next) => process.env.MOONQUEST_ENABLED === 'false' ? res.status(503).json({ error: 'MoonQuest is temporarily unavailable. Your saved games and answers are safe.' }) : next());
  const assetDir = path.join(store.dir, 'assets'); fs.mkdirSync(assetDir, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
  const wrap = fn => async (req, res) => { try { res.set('Cache-Control', 'no-store'); await fn(req, res); } catch (e) { res.status(400).json({ error: e.message || 'MoonQuest could not complete this action.' }); } };
  const teacher = (req, res, next) => requireAuth(req, res, () => req.user.role === 'student' ? res.status(403).json({ error: 'Teacher access required.' }) : next());
  const mutate = (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Open MoonQuest on LessonScope to continue.' });
    next();
  };
  app.use(base, (req, res, next) => req.method === 'GET' ? next() : mutate(req, res, next));
  const ownGame = (req, id) => { const g = store.read('game', id); if (g.teacherId !== req.userId) throw new Error('Game not found for this teacher.'); return g; };
  const ownSession = req => { const s = store.session(req.params.id); if (s.teacherId !== req.userId) throw new Error('Session not found for this teacher.'); return s; };
  const assetPath = id => { if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Invalid diagram.'); return path.join(assetDir, id); };
  function checkAssets(game, teacherId) {
    for (const d of game.diagrams) {
      const meta = JSON.parse(fs.readFileSync(assetPath(d.asset) + '.json', 'utf8'));
      if (meta.teacherId !== teacherId) throw new Error('Upload a diagram belonging to this teacher.');
    }
  }
  function audience(req) {
    const token = String(req.get('Authorization') || '').replace(/^Bearer /, '');
    const s = store.session(req.params.id);
    if (req.query.board && req.query.board === s.boardToken) return { s, role: 'board' };
    const t = jwt.verify(token, sessionSecret(), { algorithms: ['HS256'] });
    if (t.type !== 'moonquest' || t.sessionId !== s.id || !s.members[t.studentId] || (s.removedStudents || []).includes(t.studentId)) throw new Error('Rejoin this MoonQuest room.');
    return { s, role: 'student', studentId: t.studentId };
  }
  // Content-addressed URLs also bypass copies cached before no-store was added.
  const pageHtml = ['moonquest.js', 'moonquest.css', 'moonquest-report.js'].reduce((html, filename) => {
    const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'public', filename))).digest('hex').slice(0, 16);
    return html.replace(`/${filename}"`, `/${filename}?v=${version}"`);
  }, fs.readFileSync(path.join(__dirname, 'public/moonquest.html'), 'utf8'));
  app.get(['/moonquest', '/moonquest/join'], (_req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('CDN-Cache-Control', 'no-store');
    res.set('Cloudflare-CDN-Cache-Control', 'no-store');
    res.type('html').send(pageHtml);
  });
  app.get(base + '/library', teacher, wrap((req, res) => res.json({
    teacherId: req.userId,
    drafts: store.list('draft', req.userId).map(d=>({id:d.id,title:d.payload.title || 'Untitled adventure',updatedAt:d.updatedAt})),
    games: store.list('game', req.userId).map(g => ({ id: g.id, title: g.title, subject: g.subject, grade: g.grade, questions: g.questions.length, version: g.version, createdAt: new Date(g.createdAt).toISOString() })),
    sessions: store.list('session', req.userId).sort((a,b) => b.createdAt-a.createdAt).map(s => ({ id: s.id, gameId: s.game.id, rosterId: s.rosterId, code: s.code, title: s.game.title, className: s.className, test: s.test, phase: s.phase, createdAt: new Date(s.createdAt).toISOString(), savedAnswers: s.rounds.reduce((n,r)=>n+Object.keys(r.answers).length,0), completedRounds: s.rounds.filter(r=>r.revealedAt).length })),
    rosters: roster.listRosters(req.userId), generationCost: costOf(req, 'lessonscope.generate_game'),
  })));
  app.post(base + '/assets', teacher, uploadLimiter, (req, res, next) => {
    const started = Date.now(), requestId = crypto.randomUUID();
    req.diagramStage = 'receiving';
    res.on('close', () => console.info(JSON.stringify({event:'moonquest_diagram_upload', requestId, stage:req.diagramStage, completed:res.writableFinished, status:res.statusCode, elapsedMs:Date.now()-started})));
    upload.single('file')(req, res, err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'This image is larger than 8 MB. Choose a smaller PNG, JPEG or WebP image.' : 'The image upload was interrupted. Choose the image again.' });
      next();
    });
  }, wrap(async (req, res) => {
    req.diagramStage = 'processing';
    if (!req.file) throw new Error('Choose a PNG, JPEG or WebP diagram.');
    const decoder = sharp(req.file.buffer, { limitInputPixels: 20000000, animated: false });
    const meta = await decoder.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('Use a single PNG, JPEG or WebP image.');
    const output = await decoder.rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    const id = crypto.randomUUID(); const dims = await sharp(output).metadata();
    req.diagramStage = 'saving';
    writeFileAtomic(assetPath(id) + '.webp', output);
    writeJsonAtomic(assetPath(id) + '.json', { teacherId: req.userId, width: dims.width, height: dims.height });
    req.diagramStage = 'complete';
    res.json({ asset: id, width: dims.width, height: dims.height });
  }));
  app.get(base + '/assets/:asset', wrap((req, res) => {
    // Images are opaque capability URLs; contain no answer keys or roster data.
    res.type('webp').sendFile(assetPath(req.params.asset) + '.webp');
  }));
  app.post(base + '/drafts', teacher, wrap((req,res)=>{
    if (!Array.isArray(req.body.payload?.diagrams)) throw Error('Invalid draft.');
    checkAssets(req.body.payload, req.userId);
    res.json({draft:store.saveDraft(req.userId,req.body)});
  }));
  app.get(base + '/drafts/:id', teacher, wrap((req,res)=>{
    const draft=store.read('draft',req.params.id);
    if(draft.teacherId!==req.userId) throw Error('Draft not found for this teacher.');
    res.json({draft});
  }));
  app.post(base + '/drafts/:id/discard', teacher, wrap((req,res)=>{
    store.deleteDraft(req.userId,req.params.id);res.json({ok:true});
  }));
  app.post(base + '/games', teacher, wrap((req, res) => {
    const validated = validateGame(req.body); checkAssets(validated, req.userId);
    res.json({ game: store.saveGame(req.userId, req.body) });
  }));
  app.get(base + '/games/:id', teacher, wrap((req, res) => res.json({ game: ownGame(req, req.params.id) })));
  app.post(base + '/draft', teacher, generationLimiter, wrap(async (req, res) => {
    // Validate region geometry using a temporary valid question before AI work.
    const diagrams = req.body.diagrams;
    const checked = validateGame({ ...req.body, reviewed: true, questions: [{ id: 'validation', diagramId: diagrams?.[0]?.id, prompt: 'Validation', concept: 'Validation', explanation: 'Validation', accepted: [diagrams?.[0]?.regions?.[0]?.id] }] });
    checkAssets(checked, req.userId);
    const { reservation, block } = await reserve(req, 'lessonscope.generate_game');
    if (block) return res.status(402).json(block);
    try {
      const questions = await generateQuestions({ ...checked, objective: String(req.body.objective || '').slice(0, 3000) });
      await capture(req, reservation, 'lessonscope.generate_game', 'moonquest-draft');
      res.json({ questions: questions.map(q => ({ ...q, id: crypto.randomUUID() })) });
    } catch (e) { await release(req, reservation, 'lessonscope.generate_game', e.message); throw e; }
  }));
  app.post(base + '/games/:id/sessions', teacher, wrap((req, res) => {
    ownGame(req, req.params.id);
    const test = req.body.test === true;
    const classRoster = test ? null : roster.getRoster(req.userId, req.body.rosterId);
    if (!test && req.body.mode === 'duels' && classRoster) {
      const priorTeams=teamProfiles.load(req.userId,classRoster);
      if(priorTeams && priorTeams.teams.length!==2) throw Error('This class has more than two saved teams. MoonQuest needs two sides; review the class teams first.');
    }
    const s = store.createSession(req.userId, req.params.id, classRoster, test, req.body.mode || 'cooperative');
    if (!test && s.duels) {s.joinOpen=false;store.saveSession(s);}
    if (test) for (const st of s.students) store.join(s.id, st.id);
    teamProfiles.applyMoon(store, s, classRoster);
    res.json({ id: s.id });
  }));
  app.get(base + '/sessions/:id/teacher', teacher, wrap((req, res) => { ownSession(req); res.json(store.snapshot(req.params.id, 'teacher')); }));
  app.get(base + '/sessions/:id/presenter', teacher, wrap((req, res) => {
    ownSession(req); res.json({ ...store.snapshot(req.params.id, 'board'), canControl: true });
  }));
  app.post(base + '/sessions/:id/command', teacher, wrap((req, res) => {
    const before = ownSession(req);
    if (req.body.action === 'remember-teams') {
      if (before.phase !== 'lobby' || !before.duels || before.test) throw Error('Save class teams from a real duel lobby.');
      teamProfiles.rememberMoon(before, roster.getRoster(req.userId,before.rosterId));
      before.teamSetup={source:'Saved class teams',needsReview:0};store.saveSession(before);
    } else {
      const updated=store.command(req.params.id, req.userId, req.body.action, req.body);
      if(req.body.action==='open-joining') {
        teamProfiles.rememberMoon(updated,roster.getRoster(req.userId,updated.rosterId));
        updated.teamSetup={source:'Saved class teams',needsReview:0};store.saveSession(updated);
      }
    }
    res.json(req.body.presentation === true ? { ...store.snapshot(req.params.id, 'board'), canControl: true } : store.snapshot(req.params.id, 'teacher'));
  }));
  app.post(base + '/sessions/:id/simulate', teacher, wrap((req, res) => {
    const s = ownSession(req); if (!s.test) throw new Error('Practice learners are only available in Test game.');
    const q = s.rounds[s.round]?.question; if (!q) throw new Error('Open a question first.');
    const regions = s.game.diagrams.find(d => d.id === q.diagramId).regions;
    const connected = new Set(Object.values(s.testDevices || {}));
    for (const [i, st] of s.students.entries()) {
      if (connected.has(st.id) || !s.rounds[s.round].expected.includes(st.id)) continue;
      store.answer(s.id, st.id, { phase: s.phase, round: s.round, changeConfirmed: true, ...(q.answerMode === 'all' ? {regionIds: req.body.pattern === 'misconception' ? [...regions.filter(r => !q.accepted.includes(r.id)), ...regions.filter(r => q.accepted.includes(r.id))].slice(0, q.accepted.length).map(r => r.id) : q.accepted} : {}), regionId: req.body.pattern === 'misconception' ? (regions.find(r => !q.accepted.includes(r.id)) || regions[0]).id : regions[i % regions.length].id, eventId: crypto.randomUUID() });
    }
    res.json(store.snapshot(s.id, 'teacher'));
  }));
  const observerHtml = ['moonquest-observer.js','moonquest-observer.css'].reduce((html, filename) => {
    const version = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'public',filename))).digest('hex').slice(0,16);
    return html.replace('/'+filename+'\"', '/'+filename+'?v='+version+'\"');
  }, fs.readFileSync(path.join(__dirname,'public/moonquest-observer.html'),'utf8'));
  app.get(['/moonquest/observe','/moonquest/analysis'], (_req, res) => {
    res.set({'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex, nofollow'});
    res.type('html').send(observerHtml);
  });
  app.post(base + '/sessions/:id/observer-link', teacher, wrap((req,res) => {
    ownSession(req); res.json(observer.issue(req.params.id, req.userId));
  }));
  app.post(base + '/sessions/:id/observer-revoke', teacher, wrap((req,res) => {
    ownSession(req); observer.revoke(req.params.id, req.userId); res.json({ok:true});
  }));
  app.get(base + '/sessions/:id/observe', wrap((req,res) => {
    try { res.json(observer.read(req.params.id, String(req.get('Authorization') || '').replace(/^Bearer /, ''))); }
    catch (_) { res.status(403).json({error:'This report link has expired or been withdrawn. Ask the teacher for a new link.'}); }
  }));
  app.post(base + '/sessions/:id/assessment', teacher, wrap((req,res)=>res.json(store.saveAssessment(req.params.id,req.userId,req.body))));
  app.post(base + '/sessions/:id/reflection', teacher, wrap((req,res)=>res.json(store.saveReflection(req.params.id,req.userId,req.body))));
  app.get(base + '/sessions/:id/report', teacher, wrap((req, res) => res.json(store.report(req.params.id, req.userId))));
  app.get(base + '/sessions/:id/qr', teacher, wrap(async (req, res) => {
    const s = ownSession(req);
    const url = `${req.protocol}://${req.get('host')}/moonquest/join?code=${s.code}`;
    res.type('svg').send(await QRCode.toString(url, { type: 'svg', margin: 1 }));
  }));
  app.post(base + '/sessions/:id/review', teacher, wrap((req, res) => { ownSession(req); store.review(req.params.id, req.userId, req.body.queueId, req.body); res.json({ saved: true }); }));
  const aiPending = new Set();
  app.post(base + '/sessions/:id/suggest', teacher, generationLimiter, wrap(async (req, res) => {
    const s = ownSession(req); const item = s.queue.find(q => q.id === req.body.queueId);
    if (!item || item.status !== 'needs-review') throw new Error('This challenge is not awaiting a suggestion.');
    if (item.suggestion) return res.json(item.suggestion);
    if (aiPending.has(item.id)) throw new Error('A suggestion is already being prepared.');
    if ((item.attempts || 0) >= 2) throw new Error('Write this challenge manually. The two included AI attempts have been used.');
    item.attempts = (item.attempts || 0) + 1; store.saveSession(s); aiPending.add(item.id);
    try {
      declareFree('lessonscope.moonquest_followup');
      const original = s.game.questions.find(q => q.id === item.parentId);
      const evidence = store.stats(s, s.rounds[item.sourceRound]);
      const [suggestion] = await generateQuestions({ ...s.game, original, evidence, previousPrompts: [...s.game.questions.map(q => q.prompt), ...s.rounds.map(r => r.question.prompt)] });
      store.saveSuggestion(s.id, req.userId, item.id, suggestion); res.json(suggestion);
    } finally { aiPending.delete(item.id); }
  }));
  app.get(base + '/rooms/:code', roomLookupLimiter, wrap((req, res) => {
    const s = store.findCode(String(req.params.code).toUpperCase());
    if (!s || s.phase === 'ended') throw new Error('This room is unavailable. Check the code with your teacher.');
    if(s.joinOpen===false)return res.json({id:s.id,title:s.game.title,joinOpen:false,students:[]});
    res.json({ id: s.id, title: s.game.title, test: !!s.test, students: s.test ? [] : learnerPickerEntries(s.students.filter(st => !(s.removedStudents || []).includes(st.id)), s.id) });
  }));
  app.post(base + '/rooms/:code/test-enter', joinLimiter, wrap((req, res) => {
    const s = store.findCode(String(req.params.code).toUpperCase());
    if (!s || !s.test || s.phase === 'ended') throw new Error('This is not an active teacher test room.');
    const participant = store.joinPractice(s.id, req.body.deviceKey);
    res.json({ id: s.id, name: participant.name, token: jwt.sign({ type: 'moonquest', sessionId: s.id, studentId: participant.studentId }, sessionSecret(), { expiresIn: '12h' }) });
  }));
  app.post(base + '/sessions/:id/join', joinLimiter, wrap((req, res) => {
    const s = store.session(req.params.id);
    if (s.test) throw new Error('This is a teacher practice session.');
    if(s.joinOpen===false)throw Error('Your teacher is preparing the teams. Sign-in will open shortly.');
    if((s.removedStudents||[]).some(id=>studentHandle(s.id,id)===req.body.handle))throw Error('You are not included in this game. Ask your teacher.');
    const st = s.students.find(st => studentHandle(s.id, st.id) === req.body.handle);
    if (!st) throw new Error('Select your name from this class.');
    const pin = String(req.body.pin || '');
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your four-digit PIN. If you have not set one, choose one now.');
    if (studentAccount.getAccountState(st.id) === 'unset') {
      if (!studentAccount.setPin(st.id, pin)) throw new Error('Your PIN was already set. Try your current PIN.');
    } else if (!studentAccount.verifyPin(st.id, pin)) throw new Error('Incorrect PIN. Ask your teacher for help.');
    store.join(s.id, st.id);
    res.json({ token: jwt.sign({ type: 'moonquest', sessionId: s.id, studentId: st.id }, sessionSecret(), { expiresIn: '12h' }), name: st.name });
  }));
  app.get(base + '/sessions/:id/state', wrap((req, res) => {
    const { role, studentId } = audience(req); res.json(store.snapshot(req.params.id, role, studentId));
  }));
  app.get(base + '/sessions/:id/board-qr', wrap(async (req, res) => {
    const { s, role } = audience(req);
    if (role !== 'board') throw new Error('Smartboard link required.');
    res.type('svg').send(await QRCode.toString(`${req.protocol}://${req.get('host')}/moonquest/join?code=${s.code}`, { type: 'svg', margin: 1 }));
  }));
  app.post(base + '/sessions/:id/story-vote', wrap((req,res)=>{
    const {role,studentId}=audience(req);if(role!=='student')throw Error('Only learners can vote.');
    store.vote(req.params.id,studentId,req.body);res.json(store.snapshot(req.params.id,role,studentId));
  }));
  app.post(base + '/sessions/:id/avatar', wrap((req,res)=>{
    const {role,studentId}=audience(req);if(role!=='student')throw Error('Only learners can choose their rabbit.');
    store.avatar(req.params.id,studentId,req.body);res.json(store.snapshot(req.params.id,role,studentId));
  }));
  app.post(base + '/sessions/:id/request-time', wrap((req,res)=>{
    const {role,studentId}=audience(req);if(role!=='student')throw Error('Only learners can request time.');
    store.requestTime(req.params.id,studentId,req.body);res.json(store.snapshot(req.params.id,role,studentId));
  }));
  app.post(base + '/sessions/:id/answer', wrap((req, res) => {
    const { role, studentId } = audience(req); if (role !== 'student') throw new Error('Only learners can answer.');
    store.answer(req.params.id, studentId, req.body); res.json(store.snapshot(req.params.id, role, studentId));
  }));
  return store;
}
module.exports = { installMoonQuest };
