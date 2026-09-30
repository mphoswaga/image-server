// Owner-requested recovery of a previously replaced analysis link.
// Store only its hash; the one-time marker ensures future revocation remains final.
const fs = require('fs');
const path = require('path');
const recovery = {
  id: 'restore-analysis-2026-09-30',
  sessionId: 'bf66cc8f-3a2a-4f21-bce2-e567b013869a',
  teacherId: '3c302479-d532-4f02-b80b-c0e9c5cf7084',
  hash: '1d59b7fa7b84a8d79d880e459ee7aec2d18fa20121d6b2be6843bcecd9d8e377'
};
function recoverAnalysisLink(store) {
  if (!fs.existsSync(path.join(store.dir, `session-${recovery.sessionId}.json`))) return false;
  const s = store.session(recovery.sessionId);
  if (s.teacherId !== recovery.teacherId || (s.analysisLinkRecoveries || []).includes(recovery.id)) return false;
  s.observer = { hashes: [...new Set([...(s.observer?.hashes || []), ...(s.observer?.hash ? [s.observer.hash] : []), recovery.hash])], expiresAt: null };
  s.analysisLinkRecoveries = [...(s.analysisLinkRecoveries || []), recovery.id];
  store.saveSession(s);
  return true;
}
module.exports = { recoverAnalysisLink };
