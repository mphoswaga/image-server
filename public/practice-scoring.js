(function exposePracticeScoring(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PracticeScoring = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildPracticeScoring() {
  const missionGoals = Object.freeze({
    'move-pointer': 8,
    'single-click': 8,
    'double-click': 6,
    'context-command': 5,
    'drag-drop': 5,
    'scroll-find': 4,
    'copy-paste-menu': 3,
    'keyboard-defense': 5,
    'copy-paste-shortcut': 3,
    'file-base': 3,
    'key-patrol': 8,
    'word-blaster': 7,
    'capital-charge': 5,
    'number-launch': 5,
    'punctuation-port': 4,
    'sentence-engine': 2,
    'repair-bay': 5,
    'keyboard-map': 6,
    'home-row-left': 10,
    'home-row-right': 10,
    'space-station': 4,
    'top-row-reach': 12,
    'bottom-row-reach': 12,
  });

  const missionTargetSeconds = Object.freeze({
    'move-pointer': 35,
    'single-click': 35,
    'double-click': 40,
    'context-command': 50,
    'drag-drop': 50,
    'scroll-find': 40,
    'copy-paste-menu': 75,
    'keyboard-defense': 65,
    'copy-paste-shortcut': 65,
    'file-base': 150,
    'key-patrol': 45,
    'word-blaster': 90,
    'capital-charge': 50,
    'number-launch': 75,
    'punctuation-port': 95,
    'sentence-engine': 75,
    'repair-bay': 75,
    'keyboard-map': 45,
    'home-row-left': 55,
    'home-row-right': 55,
    'space-station': 70,
    'top-row-reach': 70,
    'bottom-row-reach': 70,
  });

  function boundedNumber(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function scoreForGoal(goal) {
    let score = 0;
    for (let combo = 1; combo <= Math.max(0, Number(goal) || 0); combo += 1) {
      score += 100 + Math.min(5, combo - 1) * 20;
    }
    return score;
  }

  function maximumBaseScore(steps, completedSteps = steps.length) {
    return (steps || []).slice(0, completedSteps).reduce((sum, step) => (
      sum + scoreForGoal(missionGoals[step.id] || 1)
    ), 0);
  }

  function targetSecondsForSteps(steps, completedSteps = steps.length) {
    return (steps || []).slice(0, completedSteps).reduce((sum, step) => (
      sum + (missionTargetSeconds[step.id] || 45)
    ), 0);
  }

  function summarize(input = {}) {
    const baseScore = Math.max(0, Math.round(Number(input.baseScore) || 0));
    const correctInputs = Math.max(0, Math.round(Number(input.correctInputs) || 0));
    const mistakes = Math.max(0, Math.round(Number(input.mistakes) || 0));
    const activeSeconds = Math.max(0, Math.round(Number(input.activeSeconds) || 0));
    const targetSeconds = Math.max(1, Math.round(Number(input.targetSeconds) || 1));
    const totalInputs = correctInputs + mistakes;
    const accuracy = totalInputs ? correctInputs / totalInputs : 1;
    const accuracyFactor = 0.6 + (0.4 * accuracy);
    const paceFactor = activeSeconds <= targetSeconds
      ? 1
      : boundedNumber(Math.pow(targetSeconds / activeSeconds, 0.65), 0.45, 1, 0.45);
    const score = Math.max(0, Math.round(baseScore * accuracyFactor * paceFactor));
    const accuracyPercent = Math.round(accuracy * 100);
    const accuracyMultiplierPercent = Math.round(accuracyFactor * 100);
    const paceMultiplierPercent = Math.round(paceFactor * 100);
    const afterAccuracyScore = Math.max(0, Math.round(baseScore * accuracyFactor));
    const rating = accuracyPercent >= 95 && paceFactor >= 0.95
      ? 'Precision pilot'
      : accuracyPercent >= 85
        ? 'Steady navigator'
        : 'Skill builder';
    return {
      score,
      baseScore,
      correctInputs,
      mistakes,
      activeSeconds,
      targetSeconds,
      accuracyPercent,
      accuracyMultiplierPercent,
      paceMultiplierPercent,
      accuracyPointsLost: Math.max(0, baseScore - afterAccuracyScore),
      pacePointsLost: Math.max(0, afterAccuracyScore - score),
      paceFactor,
      rating,
    };
  }

  function keyLabel(value) {
    const label = String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 24);
    if (!label || ['__proto__', 'constructor', 'prototype'].includes(label)) return '';
    return label;
  }

  function boundedCount(value, maximum = 10000) {
    return Math.max(0, Math.min(maximum, Math.round(Number(value) || 0)));
  }

  function normalizeKeyStats(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const [rawKey, rawEntry] of Object.entries(value).slice(0, 64)) {
      const key = keyLabel(rawKey);
      if (!key || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
      const correct = boundedCount(rawEntry.correct);
      const mistakes = boundedCount(rawEntry.mistakes, 1000);
      const confusions = {};
      if (rawEntry.confusions && typeof rawEntry.confusions === 'object' && !Array.isArray(rawEntry.confusions)) {
        for (const [rawWrongKey, rawCount] of Object.entries(rawEntry.confusions).slice(0, 12)) {
          const wrongKey = keyLabel(rawWrongKey);
          const count = boundedCount(rawCount, 1000);
          if (wrongKey && count) confusions[wrongKey] = count;
        }
      }
      if (correct || mistakes) result[key] = { correct, mistakes, confusions };
    }
    return result;
  }

  function mergeKeyStats(...sources) {
    const result = {};
    for (const source of sources) {
      for (const [key, entry] of Object.entries(normalizeKeyStats(source))) {
        const target = Object.hasOwn(result, key) ? result[key] : { correct:0, mistakes:0, confusions:{} };
        target.correct = boundedCount(target.correct + entry.correct);
        target.mistakes = boundedCount(target.mistakes + entry.mistakes, 1000);
        for (const [wrongKey, count] of Object.entries(entry.confusions)) {
          const previous = Object.hasOwn(target.confusions, wrongKey) ? target.confusions[wrongKey] : 0;
          target.confusions[wrongKey] = boundedCount(previous + count, 1000);
        }
        result[key] = target;
      }
    }
    return result;
  }

  function summarizeTyping(input = {}) {
    const typedCharacters = boundedCount(input.typedCharacters, 100000);
    const typingSeconds = boundedCount(input.typingSeconds, 7200);
    const keyStats = normalizeKeyStats(input.keyStats);
    const wpm = typingSeconds > 0
      ? Math.round((((typedCharacters / 5) / (typingSeconds / 60))) * 10) / 10
      : 0;
    const problemKeys = Object.entries(keyStats)
      .filter(([, entry]) => entry.mistakes > 0)
      .map(([key, entry]) => {
        const total = entry.correct + entry.mistakes;
        const confusedWith = Object.entries(entry.confusions)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 3)
          .map(([wrongKey, count]) => ({ key:wrongKey, count }));
        return {
          key,
          correct: entry.correct,
          mistakes: entry.mistakes,
          accuracyPercent: total ? Math.round((entry.correct / total) * 100) : 0,
          confusedWith,
        };
      })
      .sort((a, b) => b.mistakes - a.mistakes || a.accuracyPercent - b.accuracyPercent || a.key.localeCompare(b.key))
      .slice(0, 8);
    return { typedCharacters, typingSeconds, wpm, keyStats, problemKeys };
  }

  function typingSummaryFromCheckpoints(checkpoints = []) {
    const totals = (Array.isArray(checkpoints) ? checkpoints : []).reduce((summary, checkpoint) => ({
      typedCharacters: summary.typedCharacters + boundedCount(checkpoint && checkpoint.typedCharacters, 100000),
      typingSeconds: summary.typingSeconds + boundedCount(checkpoint && checkpoint.typingSeconds, 7200),
      keyStats: mergeKeyStats(summary.keyStats, checkpoint && checkpoint.keyStats),
    }), { typedCharacters:0, typingSeconds:0, keyStats:{} });
    return summarizeTyping(totals);
  }

  function compareLeaderboardPerformance(a, b) {
    return (Number(b.totalMissionsCompleted) || 0) - (Number(a.totalMissionsCompleted) || 0)
      || (Number(b.score) || 0) - (Number(a.score) || 0)
      || (Number(b.accuracyPercent) || 0) - (Number(a.accuracyPercent) || 0)
      || (Number(a.mistakes) || 0) - (Number(b.mistakes) || 0)
      || (Number(a.activeSeconds) || 0) - (Number(b.activeSeconds) || 0);
  }

  function rankLeaderboard(entries = []) {
    const ordered = [...entries].sort((a, b) => (
      compareLeaderboardPerformance(a, b)
      || String(a.name || '').localeCompare(String(b.name || ''))
    ));
    let rank = 0;
    return ordered.map((entry, index) => {
      if (index === 0 || compareLeaderboardPerformance(ordered[index - 1], entry) !== 0) rank = index + 1;
      return { ...entry, rank };
    });
  }

  return Object.freeze({
    missionGoals,
    missionTargetSeconds,
    scoreForGoal,
    maximumBaseScore,
    targetSecondsForSteps,
    summarize,
    normalizeKeyStats,
    mergeKeyStats,
    summarizeTyping,
    typingSummaryFromCheckpoints,
    compareLeaderboardPerformance,
    rankLeaderboard,
  });
}));
