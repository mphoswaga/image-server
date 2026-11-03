/* Shared smartboard habitat proportions, also used by paired colony views. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ColonyHabitatLayout = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const constants = Object.freeze({
    gap: 14,
    minimumWidth: 205,
    roomStep: 142,
    baseHeight: 218,
  });
  function board(rooms, zone) {
    return {
      roomWidth: Math.min(186, zone.w * 0.44),
      roomHeight: 94,
      entrance: { x: zone.x + zone.w / 2, y: zone.y + 50 },
      rooms: rooms.map((room, index) => ({
        ...room,
        x:
          index === 0
            ? zone.x + zone.w / 2
            : zone.x + zone.w * ((index - 1) % 2 ? 0.75 : 0.25),
        y: zone.y + 136 + Math.ceil(index / 2) * constants.roomStep,
      })),
    };
  }
  function fit(rooms, w, h) {
    // Fit the complete smartboard nest instead of stretching chambers to fill a panel.
    const surface = Math.min(100, Math.max(38, h * 0.22)),
      rows = Math.ceil((rooms.length - 1) / 2);
    const scale = Math.min(
      1,
      Math.max(1, w - 24) / constants.minimumWidth,
      Math.max(1, h - surface - 20) / (136 + rows * constants.roomStep),
    );
    const source = board(rooms, { x: 0, y: 0, w: w / scale, h: h / scale });
    const top = surface - 50 * scale;
    return {
      surface,
      depth: h - surface,
      scale,
      size: 29 * scale,
      rooms: source.rooms.map((r) => ({
        ...r,
        x: r.x * scale,
        y: top + r.y * scale,
        rx: (source.roomWidth * scale) / 2,
        ry: (source.roomHeight * scale) / 2,
      })),
    };
  }
  return { constants, board, fit };
});
