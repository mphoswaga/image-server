const test = require('node:test');
const assert = require('node:assert/strict');
const city = require('../public/practice-city');
const practice = require('../practice');
const steps = practice.getActivity('g2-pointer-control').steps;

test('city starts with exactly one next district and seven locked districts', () => {
  const html = city.render(steps);
  assert.equal((html.match(/city-marker next/g)||[]).length,1);
  assert.equal((html.match(/city-marker locked/g)||[]).length,7);
  assert.doesNotMatch(html, /<button|<a /);
});
test('city powers up only completed districts and preserves mission order', () => {
  const html = city.render(steps,3);
  assert.equal((html.match(/city-marker restored/g)||[]).length,3);
  assert.equal((html.match(/class="city-light"/g)||[]).length,3);
  assert.match(html,/city-marker next[\s\S]*?Command Deck/);
  assert.equal((city.render(steps,8).match(/city-marker restored/g)||[]).length,8);
  assert.doesNotMatch(city.render(steps,8),/city-marker next/);
});
