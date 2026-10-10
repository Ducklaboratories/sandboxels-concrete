// solid_concrete_v9.js - Sandboxels mod: realistic SOLID concrete (uses the game's own Cement)
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
//  - Cement only cures once it is resting on something (so it can't turn solid in mid-air), and it
//    does not cure while it is freezing cold. Sliding sideways does not stop it from curing.
//  - CURING HEAT: fresh concrete gives off heat while it cures, like real concrete. A thin pour sheds it to
//    the air and stays cool; a big thick pour keeps it in its core and gets hot. Water pipes through a
//    big pour carry the heat away (why Hoover Dam used cooling pipes). The heat never cracks the concrete.
//  - HIGH HEAT: concrete starts cracking into rubble between 900C and 1000C. Melting into magma is the
//    game's own (this mod does not change it). Cured concrete otherwise follows the game's normal heat.
//  - REBAR (new): concrete touching rebar becomes REINFORCED CONCRETE, which bridges far gaps.
//  - Unsupported spans crack: concrete can only bridge so far over empty space, but THICKER slabs
//    and beams bridge much farther (like real structural concrete). Poured into a mold, it holds.
//  - Console switches (reset on refresh):  concreteCracking(false)  = no cracking at all
//                                          concreteHeat(false)      = no curing heat
//  - Cracked concrete becomes CONCRETE RUBBLE (a powder).

(function () {
  // ================= TUNING =================
  const CFG = {
    SPAN_PLAIN:      22,     // plain concrete can bridge this many cells with nothing under it
    SPAN_REINFORCED: 45,     // reinforced concrete can bridge this many
    CHECK_CHANCE:    0.004,  // chance per tick a concrete pixel checks itself (keeps the game fast)
    COLD_STOP:       2,      // cement does not cure below this temperature (C)
    HEAT:            true,   // false = curing gives off no heat
    HEAT_TOTAL:      120,    // total temperature rise (C) one pixel of curing concrete can release
    HEAT_TICKS:      200,    // over how many ticks that heat is released
    AIR_COOL:        0.03,   // fraction of its extra heat a pixel touching open air loses each tick
    COOL_TICKS:      600,    // how long after curing a pixel still sheds heat to open air (then plain game physics)
    SPALL_START:     900,    // concrete starts cracking into rubble above this temperature (C)
    SPALL_FULL:      1000,   // ...and cracks at full speed by this temperature
    SPALL_CHANCE:    0.05,   // chance per tick, per pixel, at SPALL_FULL (lower further below it)
    CURE_TICKS:      100,    // ticks cement must rest on something (and not be freezing) before it can harden
    VISCOSITY:       null,   // null = the game's own thickness (1000). Lower, like 200, = runnier cement
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

  const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
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
    // --- very hot (900-1000C and up): concrete cracks into rubble ---
    if (CFG.CRACKING && typeof pixel.temp === "number" && pixel.temp > CFG.SPALL_START) {
      const f = Math.min(1, (pixel.temp - CFG.SPALL_START) / (CFG.SPALL_FULL - CFG.SPALL_START));
      if (Math.random() < f * CFG.SPALL_CHANCE) { changePixel(pixel, "concrete_rubble"); return; }
    }
    // --- fresh concrete: releases curing heat, then sheds it for a while ---
    if (CFG.HEAT && pixel.hyd > 0) {
      const r = Math.min(pixel.hyd, CFG.HEAT_TOTAL / CFG.HEAT_TICKS);
      pixel.hyd -= r;
      pixel.temp = (typeof pixel.temp === "number" ? pixel.temp : 20) + r;
      if (pixel.hyd < 0.001) { pixel.hyd = 0; pixel.cool = CFG.COOL_TICKS; }
    } else if (pixel.cool > 0) {
      pixel.cool--;
    }
    // Fresh concrete only. Cured concrete follows the game's normal heat rules, so your engine is not affected.
    const fresh = pixel.hyd > 0 || pixel.cool > 0;
    if (fresh && typeof pixel.temp === "number" && pixel.temp > 21) {
      for (let i = 0; i < 4; i++) {
        if (isEmpty(pixel.x + N4[i][0], pixel.y + N4[i][1])) { pixel.temp -= (pixel.temp - 20) * CFG.AIR_COOL; break; }
      }
    }
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
  window.concreteHeat = (on) => { CFG.HEAT = on !== false; return "concrete curing heat " + (CFG.HEAT ? "on" : "off"); };
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
    // keeps the game's own density, hardness, colour and melting point
  } else {
    console.warn("solid_concrete: no concrete element found, creating one");
    elements.concrete = {
      color: "#ababab", behavior: behaviors.WALL, category: "solids", state: "solid",
      density: 2400, hardness: 0.5, tempHigh: 1500, stateHigh: "magma",
      breakInto: "concrete_rubble", tick: concreteTick, darkText: true,
    };
  }

  // reinforced concrete and rubble melt at the same temperature as the game's concrete
  ["reinforced_concrete", "concrete_rubble"].forEach(function (n) {
    if (elements[n] && elements.concrete.tempHigh !== undefined) {
      elements[n].tempHigh = elements.concrete.tempHigh;
      elements[n].stateHigh = elements.concrete.stateHigh;
    }
  });

  // ================= cement: only cure once it has settled, and not while freezing =================
  // NOTE: we never touch pixel.start. The game's liquid movement freezes a pixel whose start
  // equals the current tick, so resetting it would make cement hang in the air.
  if (elements.cement) {
    const cem = elements.cement;
    if (CFG.VISCOSITY !== null) cem.viscosity = CFG.VISCOSITY;
    const baseMix = cem.__scMix !== undefined ? cem.__scMix : (cem.onMix || null);
    cem.__scMix = baseMix;
    cem.onMix = function (pixel) {
      pixel.cure = 0;                          // mixing resets the setting time (like the game does)
      if (baseMix) baseMix(pixel);
    };
    cem.tick = function (pixel) {
      if (pixel.cure === undefined) pixel.cure = 0;
      // falling (or standing over nothing) restarts the clock; sliding sideways does NOT, so the
      // top of a pile that is still shuffling around, or a single wandering pixel, still sets
      const fell = pixel.ly !== undefined && pixel.y > pixel.ly;
      pixel.lx = pixel.x; pixel.ly = pixel.y;
      const cold = typeof pixel.temp === "number" && pixel.temp < CFG.COLD_STOP;
      if (fell || cold || isEmpty(pixel.x, pixel.y + 1)) { pixel.cure = 0; return; }
      pixel.cure++;
      if (pixel.cure > CFG.CURE_TICKS && Math.random() < 0.1) {
        if (pixel.hyd === undefined) pixel.hyd = CFG.HEAT_TOTAL;   // heat still to be released
        changePixel(pixel, "concrete");
      }
    };
  } else {
    console.warn("solid_concrete: no cement element found");
  }

  console.log("solid_concrete_v9 loaded");
})();
