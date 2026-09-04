(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PracticeCity = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const positions = [[15,46],[38,43],[61,43],[87,46],[85,88],[61,88],[40,86],[15,88]];
  const escape = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(steps, completed = 0) {
    const count = Math.max(0, Math.min(steps.length, Number(completed) || 0));
    return `<div class="city-map" role="group" aria-label="Byte City: ${count} of ${steps.length} districts restored"><img class="city-art" src="/assets/practice/bg_city_map.webp" alt="Eight Byte City buildings connected by a road" />${steps.map((step, index) => {
      const [x,y] = positions[index];
      const state = index < count ? 'restored' : index === count ? 'next' : 'locked';
      const column = index < 4 ? index : 7-index;
      const light = state === 'restored' ? `<img class="city-light" src="/assets/practice/bg_city_map.webp" alt="" style="clip-path:inset(${index<4?0:48}% ${75-column*25}% ${index<4?52:0}% ${column*25}%);" />` : '';
      return `${light}<div class="city-marker ${state}" style="left:${x}%;top:${y}%"><span class="city-number">${index+1}</span><span class="city-name">${escape(step.title)}</span><small>${state==='restored'?'Restored':state==='next'?'Next mission':'Locked'}</small></div>`;
    }).join('')}</div>`;
  }
  return { render };
}));
