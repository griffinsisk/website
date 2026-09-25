// candidate-voice Ring: a floating voice assistant for any page. Needs the vendored ElevenLabs SDK
// and ask-agent.js loaded first, and ring.css on the page. No build step, no dependencies.
//
//   AskRing.mount({
//     agentId: "agent_...",
//     data: candidateJson,                  // dist/candidate.json from scripts/build_agents.py
//     workletBase: "/vendor/elevenlabs/",   // self-hosted worklets for a strict CSP
//     reveal: (kind, id, node) => { ... },  // optional; how the page shows one of its own items
//     navigate: (section) => { ... },       // optional; how the page shows a section
//     textHref: "#ask",                     // optional; where to type instead when voice fails
//     disclosure: "AI assistant built with ...",   // optional; shown under the tooltip
//     nudgeAfter: 6000,                     // optional; ms before a one-time, silent invitation
//   });
//
// Returns { talk(), ask(text), sleep(), dismissNudge() }. ask() wakes the Ring and asks that
// question by voice once its intro line has finished.
//
// The Ring sleeps until clicked: a still icon with no animation loop and no session, so an unused
// Ring costs nothing. Awake, its mouth follows the audio the visitor is hearing and its face takes
// on the tone of each reply.
(function () {
  // ── Tone of a reply ─────────────────────────────────────────────────────────
  // Rules, not a model call: a misread only changes a facial expression, and a mood tool would
  // add a round trip before every spoken reply. First match wins.
  const MOOD_RULES = [
    ["apologetic", /\b(i don'?t have|i do not have|i'?m not sure|i don'?t know|not covered|isn'?t covered|not something i|i can'?t|i cannot|unfortunately|sorry)\b/i],
    ["excited", /!|\$\s?\d|\b\d+(\.\d+)?\s?(%|k|m|x|percent|days|weeks|million|thousand)\b|\b(launched|shipped|won|record|largest|biggest|fastest)\b/i],
    ["curious", /\?\s*$/],
    ["warm", /\b(glad|happy to|great question|thanks|thank you|pleasure|you'?re welcome|nice to meet|enjoy|all set|booked)\b/i],
    ["thoughtful", /\b(because|the way it works|how it works|works by|under the hood|the idea is|designed to|so that|which means|in other words)\b/i],
  ];

  function moodOf(text) {
    const t = (text || "").trim();
    for (const [mood, rule] of MOOD_RULES) if (rule.test(t)) return mood;
    return "neutral";
  }

  // How each mood sets the face. eye: eye height; lidTop / lidBottom: how far the upper and lower
  // lids close (a raised lower lid reads as a smile); brow: brow visibility; browTilt: inner ends up
  // (worry) when positive; browLift: both brows up; browArch: right brow only (skeptical/thinking);
  // tilt: head tilt in degrees; bounce: a short hop; glow: extra glow; mouth: mouth size.
  // lookX / lookY: where the eyes point.
  const NEUTRAL = { eye: 1, lidTop: 0, lidBottom: 0, brow: 0, browTilt: 0, browLift: 0, browArch: 0, tilt: 0,
    bounce: 0, glow: 0, mouth: 1, smile: 1, lookX: 0, lookY: 0 };
  const MOODS = {
    neutral: NEUTRAL,
    warm: { ...NEUTRAL, lidBottom: 0.85, glow: 0.15, smile: 1.8 },
    excited: { ...NEUTRAL, eye: 1.3, brow: 1, browLift: 1.6, bounce: 1, glow: 0.45, mouth: 1.2, smile: 1.8 },
    thoughtful: { ...NEUTRAL, lidTop: 0.3, brow: 1, browArch: 1.4, tilt: 8, mouth: 0.85, smile: 0.2, lookX: -4, lookY: -3 },
    apologetic: { ...NEUTRAL, eye: 0.85, lidTop: 0.45, brow: 1, browTilt: 1.5, tilt: -5, mouth: 0.75, smile: -0.8, lookY: 2.5 },
    curious: { ...NEUTRAL, eye: 1.25, brow: 1, browLift: 1.4, browArch: 0.6, tilt: -10, smile: 0.5, lookX: 2 },
  };

  // ── Mouth from the audio ────────────────────────────────────────────────────
  // The SDK hands over 1024 bins spanning 100 Hz to 8 kHz of the audio actually playing, so the
  // mouth moves with what the visitor hears. Vowels differ in where their energy sits: "ah" is
  // strong low and mid, "ee" adds bright highs, "oo" is low-heavy and dull. Silence between words
  // closes the mouth, which is what makes it read as talking rather than pulsing.
  // TUNING is the one table to adjust after listening to the real voice.
  const TUNING = {
    gate: 0.06,       // loudness below this is silence: mouth closed
    full: 0.38,       // loudness at which the mouth is fully open
    brightMid: 0.55,  // spectral brightness of a neutral "ah"
    brightSpan: 0.35, // brightness change that swings the mouth fully wide ("ee") or round ("oo")
  };
  const BANDS = { low: [0, 52], mid: [52, 247], high: [247, 1024] }; // ~100-500 Hz, 500-2k, 2k-8k

  function bandMean(freq, [from, to]) {
    let sum = 0;
    const end = Math.min(to, freq.length);
    for (let i = from; i < end; i++) sum += freq[i];
    return end > from ? sum / (end - from) / 255 : 0;
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // open: 0 (closed) to 1 (fully open). width: -1 (round "oo") through 0 ("ah") to 1 (wide "ee").
  function mouthShape(freq, tuning = TUNING) {
    if (!freq || !freq.length) return { open: 0, width: 0, loud: 0 };
    const low = bandMean(freq, BANDS.low), mid = bandMean(freq, BANDS.mid), high = bandMean(freq, BANDS.high);
    const loud = 0.5 * low + 0.35 * mid + 0.15 * high;
    if (loud < tuning.gate) return { open: 0, width: 0, loud };
    const open = clamp((loud - tuning.gate) / (tuning.full - tuning.gate), 0, 1);
    const bright = (mid + 2 * high) / (low + mid + high + 1e-6);
    const width = clamp((bright - tuning.brightMid) / tuning.brightSpan, -1, 1);
    return { open, width, loud };
  }

  // An open mouth: upper and lower lip as curves between two corners. round (0 to 1) lifts the
  // upper lip so a narrow mouth reads as an "oo" circle rather than a slit.
  function mouthPath(cx, cy, halfWidth, height, round = 0) {
    const l = cx - halfWidth, r = cx + halfWidth;
    const upper = cy - height * (0.25 + 0.45 * round);
    const lower = cy + height;
    return `M${l.toFixed(1)},${cy.toFixed(1)} Q${cx},${upper.toFixed(1)} ${r.toFixed(1)},${cy.toFixed(1)} ` +
      `Q${cx},${lower.toFixed(1)} ${l.toFixed(1)},${cy.toFixed(1)}Z`;
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.append(n);
    return n;
  }
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text) n.textContent = text;
    return n;
  }

  // Concept D: a glowing ring with teal eyes on a dark disc. Lids and brows are extra parts so the
  // face can smile with its eyes, worry, or raise a brow.
  function drawFace(svg) {
    const defs = svgEl("defs", {}, svg);
    defs.innerHTML = `<radialGradient id="ask-ring-glow" cx="50%" cy="50%" r="50%">
      <stop offset="60%" stop-color="currentColor" stop-opacity=".35"/>
      <stop offset="100%" stop-color="currentColor" stop-opacity="0"/></radialGradient>`;
    const parts = {};
    parts.glow = svgEl("circle", { cx: 100, cy: 100, r: 82, fill: "url(#ask-ring-glow)", class: "ask-ring-glow" }, svg);
    parts.disc = svgEl("circle", { cx: 100, cy: 100, r: 58, class: "ask-ring-disc" }, svg);
    parts.ring = svgEl("circle", { cx: 100, cy: 100, r: 60, fill: "none", class: "ask-ring-stroke", "stroke-width": 5 }, svg);
    parts.arc = svgEl("circle", { cx: 100, cy: 100, r: 60, fill: "none", class: "ask-ring-arc", "stroke-width": 5,
      "stroke-linecap": "round", "stroke-dasharray": "60 317", opacity: 0 }, svg);
    parts.head = svgEl("g", {}, svg);
    parts.eyes = [-1, 1].map((side) => {
      const x = 100 + side * 17, y = 96;
      const eye = svgEl("ellipse", { cx: x, cy: y, rx: 6.5, ry: 8, class: "ask-ring-ink" }, parts.head);
      const shine = svgEl("circle", { cx: x + 1.8, cy: y - 2.6, r: 1.7, fill: "#fff", opacity: 0.9 }, parts.head);
      // Lids are disc-colored shapes that slide over the eye from above and below.
      const top = svgEl("ellipse", { cx: x, cy: y - 16, rx: 9, ry: 9, class: "ask-ring-lid" }, parts.head);
      const bottom = svgEl("ellipse", { cx: x, cy: y + 16, rx: 9, ry: 9, class: "ask-ring-lid" }, parts.head);
      const brow = svgEl("path", { d: "", fill: "none", class: "ask-ring-brow", "stroke-width": 2.4,
        "stroke-linecap": "round", opacity: 0 }, parts.head);
      const lash = svgEl("path", { d: "", fill: "none", class: "ask-ring-brow", "stroke-width": 3,
        "stroke-linecap": "round", opacity: 0 }, parts.head);
      return { side, x, y, eye, shine, top, bottom, brow, lash };
    });
    parts.mouth = svgEl("path", { class: "ask-ring-mouth", "stroke-width": 2.6, "stroke-linejoin": "round",
      "stroke-linecap": "round" }, parts.head);
    // Open, the mouth is a dark opening with a tongue inside and the lips drawn over both.
    parts.tongue = svgEl("ellipse", { cx: 100, cy: 116, rx: 5, ry: 2, class: "ask-ring-tongue", opacity: 0 }, parts.head);
    parts.lips = svgEl("path", { class: "ask-ring-lips", "stroke-width": 2.6, "stroke-linejoin": "round", opacity: 0 }, parts.head);
    parts.sparkle = svgEl("path", { d: "M0,-7 Q1,-1 7,0 Q1,1 0,7 Q-1,1 -7,0 Q-1,-1 0,-7Z",
      class: "ask-ring-ink", opacity: 0 }, parts.head);
    parts.dots = [0, 1, 2].map((i) => svgEl("circle", { cx: 132 + i * 9, cy: 30, r: 3, class: "ask-ring-dot", opacity: 0 }, svg));
    return parts;
  }

  // ── The widget ──────────────────────────────────────────────────────────────
  function mount(opts) {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const noHover = matchMedia("(hover: none)").matches;
    const first = opts.data.name.split(" ")[0];

    const root = el("div", "ask-ring");
    const panel = el("div", "ask-ring-panel");
    panel.hidden = true;
    const bubble = el("div", "ask-ring-bubble");
    const caption = el("p", "ask-ring-caption");
    caption.setAttribute("aria-live", "polite");
    const status = el("p", "ask-ring-status");
    const fallbackLink = el("a", "ask-card-link", "Go to text chat");
    fallbackLink.hidden = true;
    if (opts.textHref) fallbackLink.href = opts.textHref;
    const hideBtn = el("button", "ask-ring-hide", "×");
    hideBtn.type = "button";
    hideBtn.setAttribute("aria-label", "Hide captions");
    const actions = el("div", "ask-ring-actions");
    const toggle = el("button", "ask-ring-action", "Transcript");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    const endBtn = el("button", "ask-ring-action", "End");
    endBtn.type = "button";
    actions.append(toggle, endBtn);
    bubble.append(hideBtn, caption, status, fallbackLink, actions);
    const log = el("div", "ask-ring-log");
    log.hidden = true;
    log.id = "ask-ring-log";
    toggle.setAttribute("aria-controls", log.id);
    panel.append(log, bubble);

    const TIP = `AI assistant · Ask me about ${first}'s work. Click to talk.`;
    const tip = el("div", "ask-ring-tip");
    const tipText = el("span", "", TIP);
    tip.append(tipText);
    if (opts.disclosure) tip.append(el("small", "ask-ring-disclosure", opts.disclosure));
    tip.id = "ask-ring-tip";
    tip.setAttribute("role", "tooltip");
    const button = el("button", "ask-ring-button");
    button.type = "button";
    button.setAttribute("aria-describedby", tip.id);
    const svg = svgEl("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", focusable: "false" }, button);
    const face = drawFace(svg);
    const ccBtn = el("button", "ask-ring-cc", "Show captions");
    ccBtn.type = "button";
    root.append(panel, tip, button, ccBtn);
    document.body.append(root);

    // What the face is doing. `awake` is the visitor's intent; `state` comes from the call.
    let awake = false, peek = false, state = "asleep", mood = "neutral";
    let rafId = 0, bounceUntil = 0, nextBlink = 0, blinkUntil = 0, lastNow = 0, quietTimer = 0;
    let peakLoud = 0.2, prevLoud = 0, winkAt = -1e9, winked = false;
    let pending = null, pendingTimer = 0; // a question to ask once the intro line is over
    const WINK_MS = 1100;

    // 0 to 1: how far into the wink the face is. Snaps shut, holds, then eases open.
    function winkAmount(now) {
      const e = now - winkAt;
      if (e < 0 || e > WINK_MS) return 0;
      if (e < 110) return e / 110;
      if (e < WINK_MS - 260) return 1;
      return (WINK_MS - e) / 260;
    }
    const shown = { ...MOODS.neutral, eye: 0.15, open: 0, width: 0, level: 0, emph: 0, listen: 0, think: 0, peek: 0, alive: 0 };

    // Captions off is a per-visitor preference, so it is remembered in this browser only.
    let captionsOff = false;
    try { captionsOff = localStorage.getItem("ask-ring-captions") === "off"; } catch {}
    function setCaptions(on) {
      captionsOff = !on;
      root.classList.toggle("ask-ring-nocaptions", captionsOff);
      try { localStorage.setItem("ask-ring-captions", on ? "on" : "off"); } catch {}
    }
    setCaptions(!captionsOff);

    // The caption steps out of the way a few seconds after the agent stops talking. Hovering the
    // Ring brings it back; so does the next reply.
    function quietSoon(on) {
      clearTimeout(quietTimer);
      root.classList.remove("ask-ring-quiet");
      if (on) quietTimer = setTimeout(() => { if (log.hidden) root.classList.add("ask-ring-quiet"); }, 5000);
    }

    const agent = AskAgent.mount({
      agentId: opts.agentId,
      data: opts.data,
      workletBase: opts.workletBase,
      navigate: opts.navigate,
      reveal: opts.reveal,
      els: { log, status },
      onState: (s) => {
        if (!awake && (s === "listening" || s === "speaking")) { agent.end(); return; } // hung up while connecting
        const prev = state;
        state = s;
        // Ask a queued question after the intro. If the agent has no intro, ask it shortly anyway.
        if (s === "speaking") clearTimeout(pendingTimer);
        if (s === "listening" && prev === "connecting" && pending) pendingTimer = setTimeout(flushPending, 2500);
        if (s === "listening" && prev === "speaking") flushPending();
        if (s === "listening") mood = "neutral";
        // The intro line just finished: a wink to say hello.
        if (s === "listening" && prev === "speaking" && !winked) { winked = true; winkAt = performance.now(); }
        quietSoon(s === "listening");
        if (s === "ended") { sleep(); return; }
        if (s === "unavailable") {
          mood = "apologetic";
          caption.textContent = "";
          fallbackLink.hidden = !opts.textHref;
        }
        label();
        wakeLoop();
      },
      onAgentText: (text) => {
        caption.textContent = text;
        mood = moodOf(text);
        if (mood === "excited") bounceUntil = performance.now() + 900;
      },
      // A card the agent says is on screen must be visible, so open the transcript it lands in.
      onCard: (node) => {
        setCaptions(true);
        quietSoon(false);
        showTranscript(true);
        node.scrollIntoView({ block: "nearest" });
      },
    });

    function label() {
      const names = { connecting: "connecting", listening: "listening", thinking: "thinking", speaking: "speaking",
        unavailable: "voice unavailable" };
      button.setAttribute("aria-label", awake
        ? `AI assistant, ${names[state] || "on"}. Click to end the conversation.`
        : "AI assistant. Click to talk.");
      root.dataset.state = awake ? state : "asleep";
    }

    function showTranscript(open) {
      log.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide transcript" : "Transcript";
    }

    function flushPending() {
      clearTimeout(pendingTimer);
      if (pending && awake) agent.send(pending);
      pending = null;
    }

    // The one-time invitation: eyes open and a speech bubble, no sound and no session.
    const NUDGE_KEY = "ask-ring-nudged";
    const seen = () => { try { return sessionStorage.getItem(NUDGE_KEY) === "1"; } catch { return false; } };
    const markSeen = () => { try { sessionStorage.setItem(NUDGE_KEY, "1"); } catch {} };
    let nudgeTimer = 0, nudging = false;
    function dismissNudge() {
      markSeen();
      clearTimeout(nudgeTimer);
      if (!nudging) return;
      nudging = false;
      root.classList.remove("ask-ring-nudge");
      tipText.textContent = TIP;
      setPeek(false);
    }
    function nudge() {
      if (awake || seen() || document.hidden) return;
      markSeen();
      nudging = true;
      tipText.textContent = `Hi! Want to hear about ${first}'s work? Click me and ask out loud.`;
      root.classList.add("ask-ring-nudge");
      setPeek(true);
      nudgeTimer = setTimeout(dismissNudge, 6000);
      addEventListener("scroll", dismissNudge, { once: true, passive: true });
      addEventListener("pointerdown", dismissNudge, { once: true });
    }
    if (opts.nudgeAfter && !seen()) nudgeTimer = setTimeout(nudge, opts.nudgeAfter);

    function wake() {
      dismissNudge();
      awake = true; peek = false; state = "connecting"; mood = "neutral"; winked = false;
      caption.textContent = "";
      fallbackLink.hidden = true;
      panel.hidden = false;
      root.classList.remove("ask-ring-peek");
      label();
      wakeLoop();
      agent.start(false);
    }

    function sleep() {
      awake = false; state = "asleep"; mood = "neutral";
      pending = null;
      clearTimeout(pendingTimer);
      quietSoon(false);
      agent.end();
      panel.hidden = true;
      label();
      wakeLoop(); // eases the face back to rest, then the loop stops itself
    }

    button.addEventListener("click", () => {
      if (awake) { sleep(); return; }
      // Touch screens have no hover, so the first tap explains what the Ring is.
      if (noHover && !peek) { peek = true; root.classList.add("ask-ring-peek"); wakeLoop(); return; }
      wake();
    });
    function setPeek(on) { if (!awake && !(nudging && !on)) { peek = on; wakeLoop(); } }
    // setPeek is a function declaration (hoisted) so the nudge can use it before this point.
    button.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") setPeek(true); });
    button.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setPeek(false); });
    button.addEventListener("focus", () => setPeek(true));
    button.addEventListener("blur", () => { setPeek(false); root.classList.remove("ask-ring-peek"); });
    endBtn.addEventListener("click", sleep);
    toggle.addEventListener("click", () => { showTranscript(log.hidden); quietSoon(false); });
    hideBtn.addEventListener("click", () => { showTranscript(false); setCaptions(false); button.focus(); });
    ccBtn.addEventListener("click", () => { setCaptions(true); quietSoon(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && awake) sleep(); });

    // ── Animation: runs only while awake or while easing into or out of rest ──
    function wakeLoop() { if (!rafId) { lastNow = performance.now(); rafId = requestAnimationFrame(frame); } }

    function targets(now) {
      const m = MOODS[awake ? mood : "neutral"];
      const speaking = awake && state === "speaking";
      const shape = speaking ? speechShape() : { open: 0, width: 0, emph: 0 };
      return {
        ...m,
        emph: shape.emph,
        eye: awake ? (state === "listening" ? 1.18 : m.eye) : peek ? 0.55 : 0.15,
        open: shape.open * m.mouth * (reduced ? 0.6 : 1),
        width: shape.width,
        level: speaking ? agent.volume() : 0,
        listen: awake && state === "listening" ? 1 : 0,
        think: awake && (state === "thinking" || state === "connecting") ? 1 : 0,
        peek: !awake && peek ? 1 : 0,
        alive: awake ? 1 : 0,
        bounce: now < bounceUntil && !reduced ? 1 : 0,
      };
    }

    // The SDK's analyser is smoothed, which flattens syllables. Measuring each frame against the
    // voice's own recent peak restores the full open-to-closed range, and a rise in loudness (the
    // start of a syllable) pushes the mouth open further and lifts the brows for emphasis.
    function speechShape() {
      const full = Math.max(TUNING.gate + 0.08, peakLoud);
      const shape = mouthShape(agent.frequencies(), { ...TUNING, full });
      peakLoud = Math.max(shape.loud, peakLoud * 0.997, TUNING.gate + 0.08);
      const rise = clamp((shape.loud - prevLoud) * 8, 0, 1);
      prevLoud = shape.loud;
      if (!shape.open) return { open: 0, width: 0, emph: 0 };
      return { open: clamp(Math.pow(shape.open, 0.7) + rise * 0.35, 0, 1), width: shape.width, emph: rise };
    }

    function frame(now) {
      const t = now / 1000;
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const goal = targets(now);
      // Mood eases in over ~200ms (instantly with reduced motion); the mouth attacks fast and
      // releases a little slower so it shuts cleanly between words.
      const ease = reduced ? 1 : 1 - Math.exp(-dt / 0.07);
      let moving = false;
      for (const k in goal) {
        let rate = ease;
        if (k === "open") rate = goal.open > shown.open ? 0.8 : 0.55;
        if (k === "emph") rate = goal.emph > shown.emph ? 0.7 : 0.15;
        if (k === "width") rate = 0.35;
        const d = goal[k] - shown[k];
        if (Math.abs(d) > 0.002) moving = true;
        shown[k] += d * rate;
      }
      render(t, now);
      if (awake || moving) rafId = requestAnimationFrame(frame);
      else { rafId = 0; render(t, now); }
    }

    function render(t, now) {
      const s = shown;
      // Blinks: natural, a few seconds apart, also while speaking; never asleep or reduced.
      const wk = s.alive > 0.5 ? winkAmount(now) : 0;
      if (s.alive > 0.5 && !reduced && !wk && now > nextBlink) { blinkUntil = now + 130; nextBlink = now + 2600 + Math.random() * 2600; }
      const blinking = now < blinkUntil;

      const w = 5 + s.level * 7 + s.listen * 3 - (1 - s.alive) * 1;
      face.ring.setAttribute("stroke-width", w.toFixed(2));
      face.arc.setAttribute("stroke-width", w.toFixed(2));
      face.arc.setAttribute("opacity", Math.max(s.listen, s.think).toFixed(2));
      if (!reduced) face.arc.setAttribute("transform", `rotate(${((t * (s.think > 0.5 ? 240 : 90)) % 360) - 90} 100 100)`);
      face.glow.setAttribute("r", (82 + s.level * 16 + s.glow * 10).toFixed(1));
      face.glow.setAttribute("opacity", (s.alive * (0.8 + s.glow) + s.peek * 0.5).toFixed(2));
      face.ring.setAttribute("opacity", (0.7 + 0.3 * Math.max(s.alive, s.peek)).toFixed(2));

      const look = s.lookX + s.think * (reduced ? 3 : Math.sin(t * 1.4) * 4 + 3);
      const lookY = s.lookY;
      const hop = reduced ? 0 : s.bounce * Math.abs(Math.sin(t * 9)) * -6 - wk * 4;
      const breathe = s.alive * Math.sin(t * (reduced ? 0.6 : 1.6)) * 0.8;
      const nod = reduced ? 0 : -s.emph * 2.5;
      // Talking stretches the face a little, the way a real jaw drops.
      const sx = 1 - s.open * 0.02, sy = 1 + (reduced ? 0 : s.open * 0.05);
      face.head.setAttribute("transform", `translate(0 ${(hop + breathe + nod).toFixed(2)}) rotate(${(s.tilt + wk * 9).toFixed(2)} 100 100) ` +
        `translate(100 100) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-100 -100)`);

      for (const e of face.eyes) {
        // The wink closes the right eye into a happy curve and widens the left.
        const winking = e.side > 0 ? wk : 0;
        const x = e.x + look, y = e.y + lookY;
        const ry = blinking ? 0.8 : Math.max(0.8, 8 * s.eye * (e.side > 0 ? 1 - wk : 1 + wk * 0.15));
        e.eye.setAttribute("opacity", (1 - winking).toFixed(2));
        e.lash.setAttribute("d", `M${(x - 7).toFixed(1)},${(y + 1).toFixed(1)} Q${x.toFixed(1)},${(y - 7 * winking).toFixed(1)} ${(x + 7).toFixed(1)},${(y + 1).toFixed(1)}`);
        e.lash.setAttribute("opacity", winking.toFixed(2));
        e.eye.setAttribute("cx", x.toFixed(2));
        e.eye.setAttribute("cy", y.toFixed(2));
        e.eye.setAttribute("ry", ry.toFixed(2));
        e.shine.setAttribute("cx", (x + 2).toFixed(2));
        e.shine.setAttribute("cy", (y - 3 * s.eye).toFixed(2));
        e.shine.setAttribute("opacity", blinking || s.eye < 0.4 || winking > 0.3 ? 0 : 0.9);
        e.top.setAttribute("cx", x.toFixed(2));
        e.top.setAttribute("cy", (e.y - 16 + s.lidTop * 7).toFixed(2));
        e.bottom.setAttribute("cx", x.toFixed(2));
        e.bottom.setAttribute("cy", (e.y + 16 - s.lidBottom * 7).toFixed(2));
        // Brows: inner end is the one nearest the middle of the face.
        const by = e.y - 14 - s.browLift * 3 - s.emph * 3 - (e.side > 0 ? s.browArch * 4 : 0) + e.side * wk * 3.5 - wk * 1;
        const inner = by - s.browTilt * 3.5, outer = by + s.browTilt * 2;
        const xi = x - e.side * 3, xo = x + e.side * 6;
        e.brow.setAttribute("d", `M${xi.toFixed(1)},${inner.toFixed(1)} L${xo.toFixed(1)},${outer.toFixed(1)}`);
        e.brow.setAttribute("opacity", (Math.max(s.brow, wk) * s.alive).toFixed(2));
      }

      // Speaking: shape from the audio. Otherwise a resting mouth whose curve follows the mood.
      const halfWidth = (10 + s.width * (s.width > 0 ? 5 : 4)) * s.mouth;
      if (s.open > 0.03) {
        const round = Math.max(0, -s.width);
        const h = (2 + s.open * 24) * s.mouth;
        const d = mouthPath(100, 110, halfWidth, h, round);
        face.mouth.setAttribute("d", d);
        face.lips.setAttribute("d", d);
        face.lips.setAttribute("opacity", 1);
        face.mouth.classList.add("ask-ring-mouth-open");
        // The tongue sits just inside the lower lip and only shows once the mouth is open enough.
        const ry = h * 0.16;
        face.tongue.setAttribute("rx", (halfWidth * 0.5).toFixed(2));
        face.tongue.setAttribute("ry", ry.toFixed(2));
        face.tongue.setAttribute("cy", (110 + h / 2 - ry - 0.8).toFixed(2));
        face.tongue.setAttribute("opacity", clamp((s.open - 0.3) * 3, 0, 0.9).toFixed(2));
      } else {
        face.lips.setAttribute("opacity", 0);
        face.tongue.setAttribute("opacity", 0);
        const smile = s.smile * (0.4 + 0.6 * Math.max(s.alive, s.peek)) + wk * 1.6;
        const half = 10 * s.mouth;
        face.mouth.setAttribute("d", `M${(100 - half).toFixed(1)},109 Q100,${(109 + smile * 6).toFixed(1)} ${(100 + half).toFixed(1)},109`);
        face.mouth.classList.remove("ask-ring-mouth-open");
      }

      // A little sparkle pops out beside the winking eye.
      const pop = reduced ? wk : Math.sin(Math.min(1, wk) * Math.PI / 2) * (1 + 0.25 * Math.sin(now / 60));
      face.sparkle.setAttribute("transform", `translate(${(134 + look).toFixed(1)} ${(78 + lookY).toFixed(1)}) rotate(${(wk * 45).toFixed(1)}) scale(${(pop * 0.9).toFixed(2)})`);
      face.sparkle.setAttribute("opacity", wk.toFixed(2));

      face.dots.forEach((c, i) => c.setAttribute("opacity", s.think > 0.5 && !reduced
        ? (0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - i * 0.9))).toFixed(2) : (s.think * 0.6).toFixed(2)));
    }

    label();
    render(0, 0); // draw the sleeping icon once; no loop runs until something changes
    // talk(): wake up and listen. ask(text): wake up and ask this question out loud after the intro.
    function talk() { if (!awake) wake(); }
    function ask(text) {
      if (awake && agent.active()) { agent.send(text); return; }
      pending = text;
      talk();
    }

    return { wake, talk, ask, sleep, dismissNudge, agent };
  }

  const api = { mount, moodOf, mouthShape, mouthPath, TUNING };
  if (typeof module === "object" && module.exports) module.exports = api; // for the unit tests
  else window.AskRing = api;
})();
