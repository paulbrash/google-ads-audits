/*!
 * Brash Digital — Audit Assistant Widget
 * Self-contained, no dependencies. Drop this <script> tag before </body>:
 *   <script src="brash-chat-widget.js" defer></script>
 *
 * Loads its knowledge base from "brash-faq-data.json", located in the same
 * folder as this script. Edit that file (or use brash-admin.html to manage
 * it) to train the assistant on new content — no code changes needed.
 *
 * Unanswered questions are optionally forwarded to a Formspree endpoint so
 * you can see what visitors are actually asking. Set FORMSPREE_ID below —
 * leave blank to disable (the widget still works fine without it).
 */

(function () {
  "use strict";

  // ---- configure this ----
  const FORMSPREE_ID = "mrednoey"; // e.g. "abcdwxyz" from https://formspree.io/f/abcdwxyz — leave blank to disable

  // ---- brand tokens, pulled from the site's own stylesheet ----
  const T = {
    bg: "#080e1c",
    bg2: "#0c1424",
    bg3: "#11192e",
    card: "rgba(255,255,255,.058)",
    cardHover: "rgba(255,255,255,.092)",
    text: "#eef2ff",
    muted: "#8899bb",
    accent: "#1a6fff",
    cyan: "#00d4ff",
    cyanDim: "rgba(0,212,255,.12)",
    cyanBorder: "rgba(0,212,255,.2)",
    glow: "rgba(26,111,255,.35)",
  };

  const scriptEl = document.currentScript;
  const baseUrl = scriptEl ? scriptEl.src.replace(/[^/]+$/, "") : "./";

  // ---------- retrieval ----------

  const STOPWORDS = new Set([
    "the","a","an","is","are","was","were","to","of","in","on","for","and","or",
    "how","do","i","my","it","this","that","with","can","does","not","when",
    "why","what","you","your","we","us","be","if","so","but","at","as","by",
    "from","have","has","had","did","get","need",
  ]);

  function tokenize(str) {
    return (str || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  }

  function scoreEntry(qTokens, entry) {
    const hay = tokenize(`${entry.question} ${entry.answer} ${entry.category} ${(entry.tags || []).join(" ")}`);
    if (!hay.length) return 0;
    let s = 0;
    qTokens.forEach((t) => { if (hay.includes(t)) s += 1; });
    return s;
  }

  function search(query, entries, k) {
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];
    return entries
      .map((e) => ({ e, s: scoreEntry(qTokens, e) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((r) => r.e);
  }

  // ---------- state ----------

  let faqEntries = [];
  let panelOpen = false;
  let messages = [];

  // ---------- styles ----------

  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

    #bd-chat-launcher {
      position: fixed; bottom: 24px; right: 24px; z-index: 999998;
      width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, ${T.accent}, ${T.cyan});
      box-shadow: 0 8px 30px ${T.glow}, 0 0 0 1px ${T.cyanBorder};
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.18s ease;
    }
    #bd-chat-launcher:hover { transform: scale(1.06); }
    #bd-chat-launcher svg { width: 26px; height: 26px; }

    #bd-chat-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 999999;
      width: 368px; max-width: calc(100vw - 32px);
      height: 540px; max-height: calc(100vh - 140px);
      background: ${T.bg2};
      border: 1px solid ${T.cyanBorder};
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'DM Sans', sans-serif;
      color: ${T.text};
    }
    #bd-chat-panel.open { display: flex; }

    #bd-chat-header {
      padding: 16px 18px; border-bottom: 1px solid ${T.cyanBorder};
      display: flex; align-items: center; justify-content: space-between;
      background: ${T.bg3};
      flex-shrink: 0;
    }
    #bd-chat-header .title {
      font-family: 'Syne', sans-serif; font-weight: 700; font-size: 15px; color: ${T.text};
    }
    #bd-chat-header .subtitle {
      font-size: 12px; color: ${T.muted}; margin-top: 2px;
    }
    #bd-chat-close {
      background: none; border: none; color: ${T.muted}; cursor: pointer;
      width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
      border-radius: 8px;
    }
    #bd-chat-close:hover { background: ${T.card}; color: ${T.text}; }

    #bd-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px;
    }
    .bd-row { display: flex; }
    .bd-row.bot { justify-content: flex-start; }
    .bd-row.user { justify-content: flex-end; }
    .bd-bubble {
      max-width: 84%; padding: 10px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.5;
    }
    .bd-bubble.bot { background: ${T.card}; border: 1px solid ${T.cyanBorder}; border-bottom-left-radius: 3px; color: ${T.text}; }
    .bd-bubble.user { background: linear-gradient(135deg, ${T.accent}, ${T.cyan}); color: ${T.bg}; font-weight: 600; border-bottom-right-radius: 3px; }

    .bd-suggestions { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    .bd-suggestion-btn {
      text-align: left; background: ${T.cyanDim}; border: 1px solid ${T.cyanBorder}; color: ${T.cyan};
      font-family: 'DM Sans', sans-serif; font-size: 12.5px; padding: 8px 11px; border-radius: 10px; cursor: pointer;
    }
    .bd-suggestion-btn:hover { background: ${T.cardHover}; }

    #bd-chat-inputrow {
      display: flex; gap: 8px; padding: 12px 14px 16px 14px; border-top: 1px solid ${T.cyanBorder};
      background: ${T.bg3}; flex-shrink: 0;
    }
    #bd-chat-input {
      flex: 1; background: ${T.bg}; border: 1px solid ${T.cyanBorder}; color: ${T.text};
      border-radius: 999px; padding: 10px 14px; font-size: 13.5px; font-family: 'DM Sans', sans-serif;
    }
    #bd-chat-input::placeholder { color: #3d4f72; }
    #bd-chat-input:focus { outline: none; border-color: ${T.cyan}; }
    #bd-chat-send {
      width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer; flex-shrink: 0;
      background: linear-gradient(135deg, ${T.accent}, ${T.cyan});
      display: flex; align-items: center; justify-content: center;
    }
    #bd-chat-send svg { width: 16px; height: 16px; }

    @media (max-width: 480px) {
      #bd-chat-panel { right: 16px; left: 16px; width: auto; bottom: 88px; }
      #bd-chat-launcher { right: 16px; bottom: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ---------- DOM ----------

  const launcher = document.createElement("button");
  launcher.id = "bd-chat-launcher";
  launcher.setAttribute("aria-label", "Ask a question about Google Ads audits");
  launcher.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="${T.bg}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

  const panel = document.createElement("div");
  panel.id = "bd-chat-panel";
  panel.innerHTML = `
    <div id="bd-chat-header">
      <div>
        <div class="title">Brash Digital</div>
        <div class="subtitle">Ask about your Google Ads audit</div>
      </div>
      <button id="bd-chat-close" aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div id="bd-chat-messages"></div>
    <div id="bd-chat-inputrow">
      <input id="bd-chat-input" type="text" placeholder="e.g. What does the audit cover?" />
      <button id="bd-chat-send" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="${T.bg}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector("#bd-chat-messages");
  const inputEl = panel.querySelector("#bd-chat-input");

  function addMessage(role, html) {
    const row = document.createElement("div");
    row.className = `bd-row ${role}`;
    const bubble = document.createElement("div");
    bubble.className = `bd-bubble ${role}`;
    bubble.innerHTML = html;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function greet() {
    addMessage(
      "bot",
      `Hi, I can answer questions about how the Google Ads audit works. Try asking something like <em>"what do you review"</em> or <em>"do I need to give you my password"</em>.`
    );
  }

  function reportUnanswered(question) {
    if (!FORMSPREE_ID) return;
    fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        source: "Audit assistant — unanswered question",
        question: question,
        page: window.location.href,
      }),
    }).catch(() => {});
  }

  function handleQuery(query) {
    addMessage("user", escapeHtml(query));
    const matches = search(query, faqEntries, 3);

    if (matches.length === 0) {
      addMessage(
        "bot",
        `I don't have an answer for that yet. Fill in the form below and Paul will get back to you directly, or email <a href="mailto:paulbrash1@gmail.com" style="color:${T.cyan}">paulbrash1@gmail.com</a>.`
      );
      reportUnanswered(query);
      return;
    }

    const top = matches[0];
    let html = `<strong>${escapeHtml(top.question)}</strong><br/>${escapeHtml(top.answer)}`;
    addMessage("bot", html);

    if (matches.length > 1) {
      const row = document.createElement("div");
      row.className = "bd-row bot";
      const wrap = document.createElement("div");
      wrap.style.maxWidth = "84%";
      wrap.innerHTML = `<div style="font-size:11px;color:${T.muted};margin-bottom:4px;">Related</div>`;
      const sugWrap = document.createElement("div");
      sugWrap.className = "bd-suggestions";
      matches.slice(1).forEach((m) => {
        const btn = document.createElement("button");
        btn.className = "bd-suggestion-btn";
        btn.textContent = m.question;
        btn.onclick = () => {
          inputEl.value = m.question;
          sendCurrent();
        };
        sugWrap.appendChild(btn);
      });
      wrap.appendChild(sugWrap);
      row.appendChild(wrap);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function sendCurrent() {
    const val = inputEl.value.trim();
    if (!val) return;
    inputEl.value = "";
    handleQuery(val);
  }

  launcher.addEventListener("click", () => {
    panelOpen = !panelOpen;
    panel.classList.toggle("open", panelOpen);
    if (panelOpen && messages.length === 0) {
      messages.push(1);
      greet();
    }
    if (panelOpen) inputEl.focus();
  });

  panel.querySelector("#bd-chat-close").addEventListener("click", () => {
    panelOpen = false;
    panel.classList.remove("open");
  });

  panel.querySelector("#bd-chat-send").addEventListener("click", sendCurrent);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendCurrent();
  });

  // ---------- load knowledge base ----------

  fetch(baseUrl + "brash-faq-data.json")
    .then((r) => r.json())
    .then((data) => {
      faqEntries = Array.isArray(data) ? data : [];
    })
    .catch(() => {
      faqEntries = [];
    });
})();
