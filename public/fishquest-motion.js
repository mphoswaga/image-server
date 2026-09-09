(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FishQuestMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function push(samples, point, time, reset = false) {
    const last = samples.at(-1);
    if (reset || last && (time - last.time > 600 || Math.hypot(point.x - last.x, point.y - last.y) > 200)) samples.length = 0;
    if (samples.at(-1)?.time === time) samples.pop();
    samples.push({ x: point.x, y: point.y, time });
    if (samples.length > 8) samples.shift();
  }
  function sample(samples, time) {
    const first = samples[0], last = samples.at(-1);
    if (!last) return null;
    if (time <= first.time) return first;
    for (let i = 1; i < samples.length; i++) {
      const b = samples[i], a = samples[i - 1];
      if (time <= b.time) {
        const t = (time - a.time) / Math.max(1, b.time - a.time);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    // Briefly bridge a late packet, then stop instead of drifting indefinitely.
    const previous = samples.at(-2);
    if (!previous) return last;
    const interval = Math.max(1, last.time - previous.time);
    const extra = Math.min(80, time - last.time);
    return { x: last.x + Math.max(-.5, Math.min(.5, (last.x - previous.x) / interval)) * extra,
      y: last.y + Math.max(-.5, Math.min(.5, (last.y - previous.y) / interval)) * extra };
  }
  return { push, sample };
});
