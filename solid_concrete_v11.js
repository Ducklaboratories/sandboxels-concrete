// solid_concrete_v11.js - Sandboxels mod: realistic SOLID concrete (uses the game's own Cement)
//
// What the game does by default: "concrete" is a SUPPORT powder (it can hold itself up in
// some spots but it is still a powder), and Cement is a liquid that turns into it.
//
// EVERYTHING lives in a new category called CONCRETE (it shows up next to the Acids tab): concrete, cement, rebar,
// rubble, all the new kinds and all the wet mixes.
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
//
//  MORE KINDS OF CONCRETE. Mix the game's CEMENT with something else (just let the pixels touch):
//     Cement + Water      -> LIQUID CONCRETE (grout). Thin and runny, gets into tight cracks, cures SLOWLY into concrete.
//     Cement + Salt       -> QUICK-SET CEMENT. Salt is a real accelerator. Sets in a flash and runs hot.
//     Cement + Sugar      -> SLOW-SET CEMENT. Sugar is a real retarder. Stays workable for a very long time.
//     Cement + Foam       -> AERATED MIX -> AERATED CONCRETE. Light, full of bubbles, INSULATES heat, but spans very little.
//     Cement + Sawdust    -> FIBER MIX -> FIBER CONCRETE. Spans farther than plain concrete (not as far as reinforced).
//     Cement + Brick Rubble -> REFRACTORY MIX -> REFRACTORY CONCRETE. For furnaces and engines: no cracking from heat
//                           until about 1500C, melts at 1800C.
//  (Finished solid concrete does NOT dissolve in water, or every dam and pool would melt.)

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
    SPAN_FIBER:      35,     // fiber concrete span
    SPAN_AERATED:    8,      // aerated concrete span (light and weak)
    SPAN_REFRACTORY: 26,     // refractory concrete span
    SPALL_REFRACTORY_START: 1500,   // refractory concrete only starts cracking from heat above this (C)
    SPALL_REFRACTORY_FULL:  1700,
    REFRACTORY_MELT: 1800,   // refractory concrete melts into magma at this temperature (C)
    CURE_GROUT:      400,    // liquid concrete cures slowly
    CURE_QUICK:      5,      // quick-set cement cures almost at once
    CURE_SLOW:       1800,   // slow-set cement stays liquid for a long time
    CURE_AERATED:    150,
    CURE_FIBER:      200,
    CURE_REFRACTORY: 300,
    GROUT_VISCOSITY: 40,     // liquid concrete is much runnier than cement (cement is 1000)
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
  const FAMILY = { concrete: true, reinforced_concrete: true, fiber_concrete: true, aerated_concrete: true, refractory_concrete: true };
  const SPANS = { reinforced_concrete: CFG.SPAN_REINFORCED, fiber_concrete: CFG.SPAN_FIBER, aerated_concrete: CFG.SPAN_AERATED, refractory_concrete: CFG.SPAN_REFRACTORY };

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
    const refractory = pixel.element === "refractory_concrete";
    const spStart = refractory ? CFG.SPALL_REFRACTORY_START : CFG.SPALL_START;
    const spFull  = refractory ? CFG.SPALL_REFRACTORY_FULL  : CFG.SPALL_FULL;
    if (CFG.CRACKING && typeof pixel.temp === "number" && pixel.temp > spStart) {
      const f = Math.min(1, (pixel.temp - spStart) / (spFull - spStart));
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
    const base = SPANS[pixel.element] || CFG.SPAN_PLAIN;
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
    category: "concrete",
    state: "solid",
    density: 1800,
    desc: "Broken concrete. Falls like gravel.",
  };

  elements.rebar = {
    color: ["#6e4b3a", "#5f4132", "#7a5240"],
    behavior: behaviors.WALL,
    category: "concrete",
    state: "solid",
    density: 7800,
    hardness: 1,
    desc: "Steel reinforcing bar. Concrete touching it becomes reinforced.",
  };

  elements.reinforced_concrete = {
    color: ["#8f9193", "#989a9b", "#85878a"],
    behavior: behaviors.WALL,
    category: "concrete",
    state: "solid",
    density: 2500,
    hardness: 0.9,
    breakInto: "concrete_rubble",
    tick: concreteTick,
    desc: "Concrete with steel inside. Bridges much longer gaps.",
  };

  elements.fiber_concrete = {
    color: ["#9a9c9b", "#a2a49f", "#929490"],
    behavior: behaviors.WALL, category: "concrete", state: "solid", density: 2350, hardness: 0.7,
    breakInto: "concrete_rubble", tick: concreteTick,
    desc: "Concrete with fibers mixed in. Bridges farther than plain concrete.",
  };
  elements.aerated_concrete = {
    color: ["#dcdcd4", "#d2d2ca", "#e4e4dc"],
    behavior: behaviors.WALL, category: "concrete", state: "solid", density: 650, hardness: 0.3, insulate: true,
    breakInto: "concrete_rubble", tick: concreteTick,
    desc: "Light, full of tiny bubbles. INSULATES against heat, but only spans short gaps.",
  };
  elements.refractory_concrete = {
    color: ["#b9a898", "#b0a090", "#c2b2a2"],
    behavior: behaviors.WALL, category: "concrete", state: "solid", density: 2200, hardness: 0.85,
    breakInto: "concrete_rubble", tick: concreteTick,
    desc: "Furnace concrete. Does not crack from heat until about 1500C. Melts at 1800C.",
  };

  // ================= concrete: make the game's own concrete a complete solid =================
  if (elements.concrete) {
    const c = elements.concrete;
    c.behavior = behaviors.WALL;       // was behaviors.SUPPORT (a powder that can prop itself up)
    c.category = "concrete";           // was listed under powders
    c.state = "solid";
    c.movable = false;
    c.breakInto = "concrete_rubble";
    c.tick = concreteTick;
    c.desc = "Solid concrete. Holds its shape. Cracks if it bridges too big a gap.";
    // keeps the game's own density, hardness, colour and melting point
  } else {
    console.warn("solid_concrete: no concrete element found, creating one");
    elements.concrete = {
      color: "#ababab", behavior: behaviors.WALL, category: "concrete", state: "solid",
      density: 2400, hardness: 0.5, tempHigh: 1500, stateHigh: "magma",
      breakInto: "concrete_rubble", tick: concreteTick, darkText: true,
    };
  }

  // reinforced concrete and rubble melt at the same temperature as the game's concrete
  ["reinforced_concrete", "concrete_rubble", "fiber_concrete", "aerated_concrete"].forEach(function (n) {
    if (elements[n] && elements.concrete.tempHigh !== undefined) {
      elements[n].tempHigh = elements.concrete.tempHigh;
      elements[n].stateHigh = elements.concrete.stateHigh;
    }
  });
  if (elements.concrete.tempHigh !== undefined) {         // refractory concrete is the heat-proof one
    elements.refractory_concrete.tempHigh = Math.max(CFG.REFRACTORY_MELT, elements.concrete.tempHigh);
    elements.refractory_concrete.stateHigh = elements.concrete.stateHigh;
  }

  // ================= wet mixes: only cure once settled, and not while freezing =================
  // NOTE: we never touch pixel.start. The game's liquid movement freezes a pixel whose start
  // equals the current tick, so resetting it would make wet concrete hang in the air.
  function makeWetTick(cureKey, into, heat, setChance) {
    return function (pixel) {
      if (pixel.cure === undefined) pixel.cure = 0;
      // falling (or standing over nothing) restarts the clock; sliding sideways does NOT
      const fell = pixel.ly !== undefined && pixel.y > pixel.ly;
      pixel.lx = pixel.x; pixel.ly = pixel.y;
      const cold = typeof pixel.temp === "number" && pixel.temp < CFG.COLD_STOP;
      if (fell || cold || isEmpty(pixel.x, pixel.y + 1)) { pixel.cure = 0; return; }
      pixel.cure++;
      if (pixel.cure > CFG[cureKey] && Math.random() < (setChance || 0.1)) {
        if (pixel.hyd === undefined) pixel.hyd = CFG.HEAT_TOTAL * heat;   // heat still to be released
        changePixel(pixel, into);
      }
    };
  }
  function resetCure(pixel) { pixel.cure = 0; }

  if (elements.cement) {
    const cem = elements.cement;
    if (CFG.VISCOSITY !== null) cem.viscosity = CFG.VISCOSITY;
    cem.category = "concrete";               // cement joins the Concrete category
    const baseMix = cem.__scMix !== undefined ? cem.__scMix : (cem.onMix || null);
    cem.__scMix = baseMix;
    cem.onMix = function (pixel) { pixel.cure = 0; if (baseMix) baseMix(pixel); };
    cem.tick = makeWetTick("CURE_TICKS", "concrete", 1);
  } else {
    console.warn("solid_concrete: no cement element found");
  }

  const WET = [
    // name,               colour,                         density, viscosity,          cure key,         cures into,            heat, description
    ["liquid_concrete",   ["#7f8386", "#777b7e"],          2100,    CFG.GROUT_VISCOSITY, "CURE_GROUT",     "concrete",            0.8, "Thin, runny grout. Flows into tight cracks and cures slowly into concrete. Made by mixing Cement with Water."],
    ["quickset_cement",   ["#a39d8c", "#9b9584"],          2300,    1000,               "CURE_QUICK",     "concrete",            1.4, "Sets almost at once, and runs hot. Made by mixing Cement with Salt."],
    ["slowset_cement",    ["#8a8d8f", "#818486"],          2300,    1000,               "CURE_SLOW",      "concrete",            0.6, "Stays liquid for a very long time. Made by mixing Cement with Sugar."],
    ["aerated_mix",       ["#c4c6c4", "#bcbebc"],          1200,    800,                "CURE_AERATED",   "aerated_concrete",    0.5, "Frothy cement. Cures into light, insulating aerated concrete. Made by mixing Cement with Foam."],
    ["fiber_mix",         ["#93908a", "#8b8882"],          2200,    1000,               "CURE_FIBER",     "fiber_concrete",      1,   "Cement with fibers in it. Cures into fiber concrete. Made by mixing Cement with Sawdust."],
    ["refractory_mix",    ["#a89888", "#a09080"],          2300,    1000,               "CURE_REFRACTORY","refractory_concrete", 1,   "Cement with crushed brick. Cures into heat-proof furnace concrete. Made by mixing Cement with Brick Rubble."],
  ];
  WET.forEach(function (w) {
    elements[w[0]] = {
      color: w[1], behavior: behaviors.LIQUID, category: "concrete", state: "liquid", density: w[2], viscosity: w[3],
      tick: makeWetTick(w[4], w[5], w[6], w[0] === "quickset_cement" ? 0.6 : 0.1), onMix: resetCure, desc: w[7],
    };
  });

  // ---- recipes: cement + something = a mix (both pixels become the mix) ----
  if (elements.cement) {
    const recipes = [["water", "liquid_concrete"], ["salt", "quickset_cement"], ["sugar", "slowset_cement"], ["foam", "aerated_mix"],
                     ["sawdust", "fiber_mix"], ["fiber", "fiber_mix"], ["brick_rubble", "refractory_mix"]];
    elements.cement.reactions = Object.assign({}, elements.cement.reactions || {});
    recipes.forEach(function (r) {
      if (elements[r[0]]) elements.cement.reactions[r[0]] = { elem1: r[1], elem2: r[1], chance: 0.3 };
    });
  }

  console.log("solid_concrete_v11 loaded");
})();
