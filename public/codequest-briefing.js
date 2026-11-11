/* Level rules come from the same mission used to run the learner's code. */
window.CodeQuestBriefing = class {
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
  speak() {
    if (!window.speechSynthesis || !this.text) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(this.text);
    speech.lang = 'en-US';
    speech.rate = 0.9;
    window.speechSynthesis.speak(speech);
  }
  sync(state, teacher, sound, training) {
    const active = !training && state?.round > 0 && ['countdown', 'build'].includes(state.phase);
    this.panel.hidden = !active;
    if (!active) return;
    const mission = state.mission;
    const challenge = state.challenge;
    const repeatAllowed = mission.blocks.includes('repeat');
    const repeat = !repeatAllowed ? 'NO REPEAT' : mission.repeatRequired ? 'USE REPEAT' : 'REPEAT OPTIONAL';
    const focus = challenge?.kind === 'predict' ? 'Predict where the code goes' : challenge?.kind === 'simplify' ? 'Shorten your algorithm' : challenge?.kind === 'sections' ? 'Plan your algorithm in sections' : mission.repeatRequired ? 'Repeated instructions' : 'Build a step-by-step algorithm';
    const rules = [repeat];
    if (mission.blockLimit && !challenge?.supported) rules.push('MAXIMUM ' + mission.blockLimit + ' BLOCKS');
    if (challenge?.supported) rules.push('REPEAT EARNS A BONUS');
    const key = state.id + ':' + state.round;
    this.title.textContent = 'Level ' + state.round + ' · ' + focus;
    this.rules.replaceChildren(...rules.map(text => {
      const rule = document.createElement('strong');
      rule.textContent = text;
      return rule;
    }));
    this.text = 'Level ' + state.round + '. ' + focus + '. ' + rules.join('. ') + '.';
    this.button.hidden = !teacher;
    if (key !== this.key) {
      this.key = key;
      if (teacher && sound) this.speak();
    }
  }
};
