const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  layout = require("../public/colony-habitat-layout");
test("shared geometry preserves the smartboard chamber positions and proportions", () => {
  const rooms = Array.from({ length: 5 }, (_, id) => ({ id })),
    g = layout.board(rooms, { x: 14, y: 133, w: 500 });
  assert.equal(g.roomWidth, 186);
  assert.equal(g.roomHeight, 94);
  assert.deepEqual(
    g.rooms.map((r) => [r.x, r.y]),
    [
      [264, 269],
      [139, 411],
      [389, 411],
      [139, 553],
      [389, 553],
    ],
  );
  assert.deepEqual(g.entrance, { x: 264, y: 183 });
});
test("fitted smartboard colonies keep every chamber inside desktop and small rival panels", () => {
  for (const [w, h] of [
    [680, 350],
    [340, 260],
    [190, 110],
  ])
    for (const count of [1, 3, 9, 19]) {
      const g = layout.fit(
        Array.from({ length: count }, (_, id) => ({ id })),
        w,
        h,
      );
      assert.equal(g.rooms.length, count);
      for (const r of g.rooms) {
        assert.ok(r.x - r.rx * 1.08 >= 0);
        assert.ok(r.x + r.rx * 1.08 <= w);
        assert.ok(r.y - r.ry * 1.25 >= g.surface - 1);
        assert.ok(r.y + r.ry * 1.25 <= h);
      }
    }
});
