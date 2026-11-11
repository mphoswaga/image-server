function codeQuestLevelRules(state) {
    const mission = state.mission;
    const challenge = state.challenge;
    const repeatAllowed = mission.blocks.includes('repeat');
    const repeat = !repeatAllowed ? 'NO REPEAT' : mission.repeatRequired ? 'USE REPEAT' : 'REPEAT OPTIONAL';
    const focus = challenge?.kind === 'predict' ? 'Predict where the code goes' : challenge?.kind === 'simplify' ? 'Shorten your algorithm' : challenge?.kind === 'sections' ? 'Plan your algorithm in sections' : mission.repeatRequired ? 'Repeated instructions' : 'Build a step-by-step algorithm';
    const rules = [repeat];
    if (mission.blockLimit && !challenge?.supported) rules.push('MAXIMUM ' + mission.blockLimit + ' BLOCKS');
    if (challenge?.supported) rules.push('REPEAT EARNS A BONUS');
    return {focus, rules, text:'Level ' + state.round + '. ' + focus + '. ' + rules.join('. ') + '.'};
}
if (typeof module === 'object') module.exports = codeQuestLevelRules;
/* Level rules come from the same mission used to run the learner's code. */
if (typeof window !== 'undefined') window.CodeQuestBriefing = class {
  constructor() {
    this.key = '';
    this.panel = document.createElement('section');
    this.panel.id = 'levelBriefing';
    this.panel.setAttribute('aria-label', 'Level focus and rules');
    this.title = document.createElement('h2');
    this.rules = document.createElement('div');
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = 'Read level rules aloud';
    this.button.onclick = () => this.speak();
    this.panel.append(this.title, this.rules, this.button);
    document.querySelector('main').prepend(this.panel);
  }
  async speak() {
    if (!this.teacher || !this.state) return;
    const key = this.key;
    this.button.textContent = 'Preparing the captain’s voice…';
    this.controller?.abort();
    this.audio?.pause();
    this.controller = new AbortController();
    const params = new URLSearchParams(location.search);
    const url = new URL('/api/game/' + encodeURIComponent(params.get('game')) + '/codequest/level-audio', location.origin);
    if (params.has('test')) url.searchParams.set('test', params.get('test'));
    url.searchParams.set('round', this.state.round);
    try {
      const response = await fetch(url, {signal:this.controller.signal});
      if (!response.ok) throw Error('Narration unavailable');
      const blob = await response.blob();
      if (this.key !== key || this.panel.hidden) return;
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.audioUrl);
      await this.audio.play();
      this.button.textContent = 'Read level rules again';
    } catch (error) {
      if (error.name !== 'AbortError') this.button.textContent = 'Play level voice';
    }
  }
  sync(state, teacher, sound, training) {
    if (!sound || !teacher) this.audio?.pause();
    const active = !training && state?.round > 0 && ['countdown', 'build'].includes(state.phase);
    this.panel.hidden = !active;
    if (!active) { this.controller?.abort(); this.audio?.pause(); return; }
    const {focus, rules, text} = codeQuestLevelRules(state);
    const key = state.id + ':' + state.round;
    this.title.textContent = 'Level ' + state.round + ' · ' + focus;
    this.rules.replaceChildren(...rules.map(text => {
      const rule = document.createElement('strong');
      rule.textContent = text;
      return rule;
    }));
    this.text = text;
    this.state = state;
    this.teacher = teacher;
    this.button.hidden = !teacher;
    if (key !== this.key) {
      this.key = key;
      if (teacher && sound) this.speak();
    }
  }
};
