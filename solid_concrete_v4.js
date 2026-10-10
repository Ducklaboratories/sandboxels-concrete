// solid_concrete_v4.js - Sandboxels mod: realistic SOLID concrete (uses the game's own Cement)
//
// What the game does by default: "concrete" is a SUPPORT powder (it can hold itself up in
// some spots but it is still a powder), and Cement is a liquid that turns into it.
//
// What this mod changes:
//  - CONCRETE is now a true solid: never flows, never falls, never piles like a powder.
//  - The game's own CEMENT stays the way you make it (crafting recipes are the game's):
//        Wet Sand + Gravel            -> Cement
//        Clay Soil + Quicklime        -> Cement
//        Slaked Lime + Sand / Wet Sand / Ash / Clay Shard / Porcelain Shard -> Cement
//  - Cement only cures once it has SETTLED (so it can't freeze solid in mid-air), and it
//    does not cure while it is freezing cold.
//  - REBAR (new): concrete touching rebar becomes REINFORCED CONCRETE, which bridges far gaps.
//  - Unsupported spans crack: concrete can only bridge so far over empty space, but THICKER slabs
//    and beams bridge much farther (like real structural concrete). Poured into a mold, it holds.
//  - Don't want cracking at all? Type  concreteCracking(false)  in the console (true turns it back on).
//  - Cracked concrete becomes CONCRETE RUBBLE (a powder).

(function () {
  // ================= TUNING =================
  const CFG = {
    SPAN_PLAIN:      22,     // plain concrete can bridge this many cells with nothing under it
    SPAN_REINFORCED: 45,     // reinforced concrete can bridge this many
    CHECK_CHANCE:    0.004,  // chance per tick a concrete pixel checks itself (keeps the game fast)
    COLD_STOP:       2,      // cement does not cure below this temperature (C)
    CRACKING:        true,   // false = concrete never cracks
    THICK_BONUS:     0.35,   // each extra cell of thickness adds this much to the span limit (35%)
    MAX_BONUS:       4,      // thickness can multiply the span limit by at most this
    MAX_THICK:       12,     // how far up we measure thickness
  };

  function pxAt(x, y) { return (pixelMap[x] && pixelMap[x][y]) || null; }

  // true if the cell under (x,y) cannot carry weight (empty, gas, liquid or loose powder)
  function unsupportedBelow(x, y) {
    if (y + 1 >= pixelMap[0].length) return false;          // the world floor is support
    const b = pxAt(x, y + 1);
    if (!b) return true;
    const el = elements[b.element];
    return !el || el.state !== "solid" || el.movable === true;
  }

  const FAMILY = { concrete: true, reinforced_concrete: true };

  function hasRebarNear(x, y) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const q = pxAt(x + dx, y + dy);
        if (q && q.element === "rebar") return true;
      }
    }
    return false;
  }

  // how many concrete cells are stacked above this one (including itself)
  function thicknessAt(x, y) {
    let t = 1;
    for (let d = 1; d <= CFG.MAX_THICK; d++) {
      const q = pxAt(x, y - d);
      if (q && FAMILY[q.element]) t++; else break;
    }
    return t;
  }

  // ---- concrete tick: reinforce next to rebar, and crack over long unsupported spans ----
  function concreteTick(pixel) {
    if (Math.random() > CFG.CHECK_CHANCE) return;
    if (pixel.element === "concrete" && hasRebarNear(pixel.x, pixel.y)) {
      changePixel(pixel, "reinforced_concrete");
      return;
    }
    if (!CFG.CRACKING) return;
    if (!unsupportedBelow(pixel.x, pixel.y)) return;        // sitting on something: fine
    const base = pixel.element === "reinforced_concrete" ? CFG.SPAN_REINFORCED : CFG.SPAN_PLAIN;
    const bonus = Math.min(CFG.MAX_BONUS, 1 + (thicknessAt(pixel.x, pixel.y) - 1) * CFG.THICK_BONUS);
    const limit = Math.round(base * bonus);                 // thicker slab = longer span
    let run = 1;
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let i = 1; i <= limit + 1; i++) {
        const q = pxAt(pixel.x + dir * i, pixel.y);
        if (!q || !FAMILY[q.element] || !unsupportedBelow(q.x, q.y)) break;
        run++;
      }
    }
    if (run > limit) changePixel(pixel, "concrete_rubble");
  }
  window.concreteCracking = (on) => { CFG.CRACKING = on !== false; return "concrete cracking " + (CFG.CRACKING ? "on" : "off"); };

  // ================= new elements =================
  elements.concrete_rubble = {
    color: ["#8c8e90", "#7e8082", "#999b9c"],
    behavior: behaviors.POWDER,
    category: "land",
    state: "solid",
    density: 1800,
    desc: "Broken concrete. Falls like gravel.",
  };

  elements.rebar = {
    color: ["#6e4b3a", "#5f4132", "#7a5240"],
    behavior: behaviors.WALL,
    category: "solids",
    state: "solid",
    density: 7800,
    hardness: 1,
    desc: "Steel reinforcing bar. Concrete touching it becomes reinforced.",
  };

  elements.reinforced_concrete = {
    color: ["#8f9193", "#989a9b", "#85878a"],
    behavior: behaviors.WALL,
    category: "solids",
    state: "solid",
    density: 2500,
    hardness: 0.9,
    tempHigh: 1500,
    stateHigh: "magma",
    breakInto: "concrete_rubble",
    tick: concreteTick,
    desc: "Concrete with steel inside. Bridges much longer gaps.",
  };

  // ================= concrete: make the game's own concrete a complete solid =================
  if (elements.concrete) {
    const c = elements.concrete;
    c.behavior = behaviors.WALL;       // was behaviors.SUPPORT (a powder that can prop itself up)
    c.category = "solids";             // was listed under powders
    c.state = "solid";
    c.movable = false;
    c.breakInto = "concrete_rubble";
    c.tick = concreteTick;
    c.desc = "Solid concrete. Holds its shape. Cracks if it bridges too big a gap.";
    // keeps the game's own density, hardness, colour and 1500C melting point
  } else {
    console.warn("solid_concrete: no concrete element found, creating one");
    elements.concrete = {
      color: "#ababab", behavior: behaviors.WALL, category: "solids", state: "solid",
      density: 2400, hardness: 0.5, tempHigh: 1500, stateHigh: "magma",
      breakInto: "concrete_rubble", tick: concreteTick, darkText: true,
    };
  }

  // ================= cement: only cure once settled, and not while freezing =================
  if (elements.cement) {
    const cem = elements.cement;
    const baseTick = cem.__scOrig !== undefined ? cem.__scOrig : (cem.tick || null);
    cem.__scOrig = baseTick;
    cem.tick = function (pixel) {
      // still slumping or flowing: restart the cure timer so it can't harden mid-air
      if (isEmpty(pixel.x, pixel.y + 1)) { pixel.start = pixelTicks; return; }
      // too cold: cement doesn't set
      if (typeof pixel.temp === "number" && pixel.temp < CFG.COLD_STOP) { pixel.start = pixelTicks; return; }
      if (baseTick) baseTick(pixel);        // the game's own curing (about 100+ ticks, then random)
    };
  } else {
    console.warn("solid_concrete: no cement element found");
  }

  console.log("solid_concrete_v4 loaded");
})();
