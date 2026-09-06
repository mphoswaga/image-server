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
    compareLeaderboardPerformance,
    rankLeaderboard,
  });
}));
