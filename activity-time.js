// Legacy game sessions use epoch milliseconds; assignments use ISO dates.
function activityTime(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
const newestActivityFirst = (a, b) => activityTime(b.at) - activityTime(a.at);
module.exports = { activityTime, newestActivityFirst };
