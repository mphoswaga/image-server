const MAX_BUFFER = 128 * 1024;

function send(ws, message, now = Date.now()) {
  if (ws.readyState !== 1) return false;
  if (ws.bufferedAmount > MAX_BUFFER) {
    ws.congestedAt ??= now;
    if (now - ws.congestedAt >= 10000) ws.terminate();
    return false;
  }
  ws.congestedAt = null;
  try {
    ws.send(JSON.stringify(message), error => { if (error) ws.terminate(); });
    return true;
  } catch { ws.terminate(); return false; }
}

function decode(ws, raw, now = Date.now()) {
  if (raw.length > 4096) { ws.close(1009, 'Message too large'); return null; }
  if (!ws.rateWindow || now - ws.rateWindow >= 1000) { ws.rateWindow = now; ws.messageCount = 0; }
  if (++ws.messageCount > 80) { ws.close(1008, 'Too many messages'); return null; }
  try {
    const message = JSON.parse(String(raw));
    return message && !Array.isArray(message) && typeof message === 'object' ? message : null;
  } catch { return null; }
}

module.exports = { send, decode, MAX_BUFFER };
