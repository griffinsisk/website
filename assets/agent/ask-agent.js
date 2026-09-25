// candidate-voice embed: connects a page to the ElevenLabs agent and runs its client tools.
// Needs the vendored ElevenLabs SDK (lib.iife.js) loaded first. No build step, no dependencies.
//
//   AskAgent.mount({
//     agentId: "agent_...",
//     data: candidateJson,                  // dist/candidate.json from scripts/build_agents.py
//     workletBase: "/vendor/elevenlabs/",   // self-hosted worklets for a strict CSP
//     els: { log, form, input, voice, stop, status },   // cards appear inline in the log;
//                                           // form and input are optional (a voice-only surface)
//     navigate: (section) => { ... },       // optional; defaults to location.hash = section
//     reveal: (kind, id, node) => { ... },  // optional; how the page shows one of its own items
//     onState: (state) => { ... },          // optional; connecting | listening | thinking |
//                                           // speaking | ended | unavailable
//     onAgentText: (text) => { ... },       // optional; each full agent reply as text
//     onCard: (node) => { ... },            // optional; a card was just added to the log
//   });
//
// show_project and show_story point at the page's own item when it has one, marked up as
// data-agent-target="project:<id>" or "story:<id>"; otherwise they show a card in the log.
(function () {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function linkButton(label, href) {
    const a = el("a", "ask-card-link", label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  // mailto: only works when the computer has a default mail app set up, which many webmail users
  // don't. So offer the two big webmail compose pages, mailto for everyone else, and a copy button.
  function emailButtons(to, subject, body) {
    const q = (params) => new URLSearchParams(params).toString().replace(/\+/g, "%20");
    const copy = el("button", "ask-card-link", "Copy email address");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(to); copy.textContent = "Copied"; }
      catch { copy.textContent = to; }
    });
    return [
      linkButton("Open in Gmail", `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to, su: subject, body })}`),
      linkButton("Open in Outlook", `https://outlook.office.com/mail/deeplink/compose?${q({ to, subject, body })}`),
      linkButton("Other mail app", `mailto:${to}?${q({ subject, body })}`),
      copy,
    ];
  }

  // A story link on the same site jumps within the page (the site opens the story from the hash);
  // anywhere else it opens in a new tab.
  function storyLink(href) {
    const url = new URL(href);
    if (url.origin !== location.origin) return linkButton("Read the full story", href);
    const a = el("a", "ask-card-link", "Read the full story");
    a.href = url.hash;
    return a;
  }

  // One conversation at a time across every surface on the page (a floating Ring, a chat panel):
  // starting one ends the other, so the visitor never has two sessions or two bills running.
  let liveEnd = null;

  // Find the page's own copy of a project or story and show it. Returns false when the page has none.
  function revealOnPage(opts, kind, id) {
    const node = document.querySelector(`[data-agent-target="${kind}:${CSS.escape(id)}"]`);
    if (!node) return false;
    if (opts.reveal) opts.reveal(kind, id, node);
    else {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.remove("agent-spotlight");
      void node.offsetWidth; // restart the highlight if it is already showing
      node.classList.add("agent-spotlight");
    }
    return true;
  }

  // Where on the page an item sits, in words the agent can say ("in the Projects section").
  function placeOf(kind) {
    return kind === "project" ? "in the Projects section" : "in the Highlights section";
  }

  function mount(opts) {
    const { els, data } = opts;
    let conversation = null;
    let mode = null;
    let agentSpoke = false;
    let streaming = null;
    let endedByVisitor = false;

    const setState = (s) => opts.onState && opts.onState(s);
    const status = (text) => { els.status.textContent = text; };
    const addMsg = (role, text) => {
      const msg = el("div", `ask-msg ask-${role}`, text);
      els.log.append(msg);
      msg.scrollIntoView({ block: "nearest" });
      return msg;
    };
    // Cards go inline in the conversation, where the visitor is already looking. A card with a key
    // (for example a project id) replaces its earlier copy instead of stacking duplicates.
    const showCard = (node, key) => {
      if (key) {
        node.dataset.cardKey = key;
        els.log.querySelector(`[data-card-key="${key}"]`)?.remove();
      }
      els.log.append(node);
      node.scrollIntoView({ block: "nearest" });
      if (opts.onCard) opts.onCard(node);
    };

    // Calendly needs room for its desktop layout, so it opens in one overlay, never stacked.
    function openCalendar(url) {
      document.querySelector(".ask-overlay")?.remove();
      const overlay = el("div", "ask-overlay");
      const panel = el("div", "ask-overlay-panel");
      const close = el("button", "ask-overlay-close", "Close");
      close.type = "button";
      close.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
      const frame = el("iframe");
      frame.src = url;
      frame.title = `Book time with ${data.name}`;
      panel.append(close, frame);
      overlay.append(panel);
      document.body.append(overlay);
    }

    // A title on its own line, with the actions underneath.
    function actionCard(title, ...actions) {
      const card = el("div", "ask-card");
      const links = el("div", "ask-card-links");
      links.append(...actions);
      card.append(el("strong", "", title), links);
      return card;
    }

    function contactCard(title) {
      const card = el("div", "ask-card");
      card.append(el("strong", "", title));
      const links = el("div", "ask-card-links");
      if (data.links.calendar) links.append(linkButton("Book time", data.links.calendar));
      if (data.links.email) links.append(linkButton("Email", `mailto:${data.links.email}`));
      if (data.links.linkedin) links.append(linkButton("LinkedIn", data.links.linkedin));
      card.append(links);
      return card;
    }

    const tools = {
      show_project({ project_id }) {
        const p = data.projects[project_id];
        if (!p) return `There is no project with the id ${project_id}.`;
        if (revealOnPage(opts, "project", project_id)) {
          const linkNote = Object.keys(p.links).length
            ? `Its links to the ${Object.keys(p.links).join(" and ")} are on the page.`
            : "It has no public links.";
          return `The ${p.title} project is now highlighted on the page, ${placeOf("project")}. ${p.one_liner} ${linkNote}`;
        }
        const card = el("div", "ask-card");
        card.append(el("strong", "", p.title), el("p", "", p.one_liner));
        const links = el("div", "ask-card-links");
        if (p.links.demo) links.append(linkButton("Live demo", p.links.demo));
        if (p.links.github) links.append(linkButton("Code on GitHub", p.links.github));
        if (links.childElementCount) card.append(links);
        showCard(card, `project-${project_id}`);
        const linkNote = links.childElementCount
          ? `The card has links to the ${Object.keys(p.links).join(" and ")}.`
          : "It has no public links, so the card shows the description only.";
        return `The ${p.title} card is now on screen. ${p.one_liner} ${linkNote}`;
      },

      show_story({ story_id }) {
        const st = (data.stories || {})[story_id];
        if (!st) return `There is no story with the id ${story_id}.`;
        if (revealOnPage(opts, "story", story_id)) {
          const who = st.customer.charAt(0).toLowerCase() + st.customer.slice(1);
          return `The story about ${who} (${st.headline}) is now open and highlighted on the page, ` +
            `${placeOf("story")}, with the full write-up. Its key numbers: ${st.stats.join("; ")}.`;
        }
        const card = el("div", "ask-card ask-story");
        card.append(el("span", "ask-story-customer", st.customer), el("strong", "", st.headline));
        const stats = el("ul", "ask-story-stats");
        for (const s of st.stats) stats.append(el("li", "", s));
        card.append(stats);
        if (st.link) card.append(storyLink(st.link));
        showCard(card, `story-${story_id}`);
        return `The card for ${st.customer} (${st.headline}) is on screen, showing: ${st.stats.join("; ")}.` +
          (st.link ? " It has a button to read the full story on the site." : "");
      },

      show_link({ kind, visitor_name, visitor_email, context }) {
        if (kind === "calendar" && data.links.calendar) {
          const url = new URL(data.links.calendar);
          if (visitor_name) url.searchParams.set("name", visitor_name);
          if (visitor_email) url.searchParams.set("email", visitor_email);
          url.searchParams.set("hide_gdpr_banner", "1");
          url.searchParams.set("hide_event_type_details", "1");
          openCalendar(url.toString());
          const reopen = el("button", "ask-card-link", "Reopen booking calendar");
          reopen.type = "button";
          reopen.addEventListener("click", () => openCalendar(url.toString()));
          showCard(actionCard(`Book time with ${data.name}`, reopen), "calendar");
          return "The booking calendar is open on screen" + (visitor_name ? ", pre-filled with their details." : ".");
        }
        if ((kind === "email" || kind === "resume_request") && data.links.email) {
          const resume = kind === "resume_request";
          const first = data.name.split(" ")[0];
          const subject = resume ? `Resume request: ${context || "a role"}` : "Hello from your website";
          const body = resume
            ? `Hi ${first},\n\nI'd like a tailored resume for ${context || "a role I'm hiring for"}.\n\n${visitor_name || ""}`
            : `Hi ${first},\n\n`;
          showCard(actionCard(resume ? "Request a tailored resume" : `Email ${data.name}`,
                              ...emailButtons(data.links.email, subject, body)), kind);
          return `Buttons are on screen to open a pre-written email to ${data.name}` +
            `${resume ? ` requesting a resume for ${context || "the role"}` : ""}, in Gmail, Outlook, or ` +
            "their own mail app, plus one to copy the address. The visitor must click one; nothing has been sent or opened yet.";
        }
        const href = data.links[kind];
        if (!href) return `That link is not available.`;
        const label = kind === "linkedin" ? "LinkedIn" : kind === "github" ? "GitHub" : "Website";
        showCard(actionCard(`${data.name} on ${label}`, linkButton(`Open ${label}`, href)), kind);
        return `A ${kind} link is on screen.`;
      },

      navigate_site({ section }) {
        if (!data.site_sections.includes(section)) return `There is no ${section} section.`;
        (opts.navigate || ((s) => { location.hash = s; }))(section);
        return `The ${section} section is now showing.`;
      },
    };

    function staticFallback() {
      status("");
      showCard(contactCard(`The assistant is resting right now. You can still reach ${data.name} directly:`), "fallback");
      if (els.voice) els.voice.disabled = true;
      if (els.input) els.input.disabled = true;
      setState("unavailable");
    }

    // A second start while one is still connecting waits for it instead of opening another session.
    let starting = null;
    function start(textOnly) {
      if (conversation) return Promise.resolve();
      if (!starting) starting = connect(textOnly).finally(() => { starting = null; });
      return starting;
    }

    async function connect(textOnly) {
      mode = textOnly ? "text" : "voice";
      if (liveEnd) liveEnd();
      liveEnd = end;
      agentSpoke = false;
      endedByVisitor = false;
      setState("connecting");
      status(textOnly ? "Connecting..." : "Connecting... allow the microphone when asked.");
      try {
        const session = await ElevenLabsClient.Conversation.startSession({
          agentId: opts.agentId,
          textOnly,
          clientTools: tools,
          workletPaths: {
            rawAudioProcessor: `${opts.workletBase}rawAudioProcessor.js`,
            audioConcatProcessor: `${opts.workletBase}audioConcatProcessor.js`,
          },
          onConnect: () => {
            status(textOnly ? "Connected. Type a question." : "Listening. Ask anything.");
            if (els.stop) els.stop.disabled = false;
            setState("listening");
          },
          onModeChange: ({ mode: m }) => {
            if (textOnly) return;
            status(m === "speaking" ? "Speaking..." : "Listening.");
            setState(m === "speaking" ? "speaking" : "listening");
          },
          onMessage: ({ source, message }) => {
            if (source === "ai") {
              agentSpoke = true;
              if (opts.onAgentText) opts.onAgentText(message);
            }
            // In voice, the visitor's words arrive once they stop talking; the agent is now working.
            if (source === "user" && !textOnly) setState("thinking");
            if (textOnly && source === "ai") return; // text replies arrive as streamed parts below
            addMsg(source === "ai" ? "assistant" : "user", message);
          },
          onAgentChatResponsePart: ({ type, text }) => {
            if (type === "start") streaming = addMsg("assistant", "");
            else if (type === "delta" && streaming) streaming.textContent += text;
            else if (type === "stop") { agentSpoke = true; streaming = null; }
          },
          onError: (message) => console.warn("ask-agent error:", message),
          onDisconnect: () => {
            conversation = null;
            if (liveEnd === end) liveEnd = null;
            if (els.stop) els.stop.disabled = true;
            // Hanging up before the agent spoke is the visitor's choice, not a failure.
            if (agentSpoke || endedByVisitor) { status("Conversation ended. Start again anytime."); setState("ended"); return; }
            fallBack();
          },
        });
        conversation = session;
        // Ended (by the visitor or another surface) while still connecting: hang up now.
        if (endedByVisitor) session.endSession();
      } catch (err) {
        console.warn("ask-agent could not start:", err);
        conversation = null;
        if (liveEnd === end) liveEnd = null;
        if (endedByVisitor) { setState("ended"); return; } // another surface took over mid-connect
        fallBack();
      }
    }

    // The ladder: voice fails -> offer text; text fails -> static contact card, which costs nothing.
    function fallBack() {
      if (mode === "voice") { status("Voice isn't available right now. You can type your question instead."); setState("unavailable"); }
      else staticFallback();
    }

    if (els.voice) els.voice.addEventListener("click", () => start(false));
    function end() {
      endedByVisitor = true;
      if (conversation) conversation.endSession();
    }
    if (els.stop) els.stop.addEventListener("click", end);
    if (els.form) els.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = els.input.value.trim();
      if (!text) return;
      els.input.value = "";
      if (!conversation) await start(true);
      if (!conversation) return;
      send(text);
    });

    // Send a visitor message on the live conversation, voice or text. The SDK doesn't echo sent
    // messages back, so it goes into the log here.
    function send(text) {
      if (!conversation) return false;
      addMsg("user", text);
      if (mode === "voice") setState("thinking");
      conversation.sendUserMessage(text);
      return true;
    }

    const EMPTY = new Uint8Array(0);
    return {
      tools,
      start,
      end,
      send,
      active: () => Boolean(conversation),
      // The audio the visitor is hearing right now: 1024 bins spanning 100 Hz to 8 kHz (voice only).
      frequencies: () => (conversation && mode === "voice" ? conversation.getOutputByteFrequencyData() : EMPTY),
      volume: () => (conversation && mode === "voice" ? conversation.getOutputVolume() : 0),
    };
  }

  window.AskAgent = { mount };
})();
