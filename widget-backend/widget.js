/*!
 * AI Sales Engine — embeddable chat widget (prototype)
 * -----------------------------------------------------------------------
 * Safe to be public: this file contains no secrets. It only talks to your
 * own backend proxy (server.js), which is the thing holding your real
 * Gemini API key.
 *
 * Configure via attributes on the <script> tag that loads this file:
 *   data-title      Chat panel title              (default: "Chat with us")
 *   data-greeting   First message shown on open    (default: a generic greeting)
 *   data-endpoint   Override the backend URL       (default: same origin as this script + /api/chat)
 *   data-key        Optional public site id for your own analytics/routing —
 *                   NOT a secret, never used to authenticate to Gemini.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  // Grab the exact <script> tag that loaded this file. Must happen
  // synchronously at parse time — document.currentScript is only valid here.
  var scriptEl = document.currentScript;
  if (!scriptEl) {
    var allScripts = document.getElementsByTagName("script");
    scriptEl = allScripts[allScripts.length - 1];
  }

  var scriptOrigin = "";
  try {
    scriptOrigin = new URL(scriptEl.src, window.location.href).origin;
  } catch (e) {
    scriptOrigin = "";
  }

  var CONFIG = {
    endpoint: scriptEl.getAttribute("data-endpoint") || (scriptOrigin + "/api/chat"),
    siteKey: scriptEl.getAttribute("data-key") || "",
    title: scriptEl.getAttribute("data-title") || "Chat with us",
    greeting:
      scriptEl.getAttribute("data-greeting") ||
      "Hi! \uD83D\uDC4B Ask me anything about the product.",
  };

  var state = {
    open: false,
    sending: false,
    history: [], // { role: 'user' | 'assistant', text: string }
  };

  // ---------------------------------------------------------------------
  // Build isolated DOM (Shadow DOM keeps the host page's CSS out, and
  // keeps our CSS from leaking onto the host page).
  // ---------------------------------------------------------------------
  var host = document.createElement("div");
  host.id = "ase-chat-widget-host";
  document.documentElement.appendChild(host);

  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var style = document.createElement("style");
  style.textContent = [
    ":host{ all: initial; }",
    ".ase-wrap, .ase-wrap *{ box-sizing: border-box; }",
    ".ase-wrap{",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Arial, sans-serif;",
    "  position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;",
    "}",
    ".ase-toggle{",
    "  width: 58px; height: 58px; border-radius: 50%; border: none; cursor: pointer;",
    "  background: linear-gradient(135deg, #FF7A45, #D9B45C);",
    "  box-shadow: 0 10px 24px -8px rgba(255,122,69,0.55);",
    "  display: flex; align-items: center; justify-content: center;",
    "  transition: transform .15s ease;",
    "}",
    ".ase-toggle:hover{ transform: translateY(-2px); }",
    ".ase-toggle svg{ width: 26px; height: 26px; color: #201206; }",
    ".ase-panel{",
    "  position: absolute; right: 0; bottom: 72px;",
    "  width: 360px; max-width: calc(100vw - 32px);",
    "  height: 500px; max-height: calc(100vh - 120px);",
    "  background: #12141F; border: 1px solid rgba(255,255,255,0.08);",
    "  border-radius: 16px; box-shadow: 0 24px 48px -16px rgba(0,0,0,0.55);",
    "  display: flex; flex-direction: column; overflow: hidden;",
    "  font-size: 14px; color: #F5F6F8;",
    "}",
    ".ase-panel[hidden]{ display: none; }",
    ".ase-header{",
    "  padding: 14px 16px; background: #171A26; border-bottom: 1px solid rgba(255,255,255,0.08);",
    "  display: flex; align-items: center; justify-content: space-between; flex: none;",
    "}",
    ".ase-title{ font-weight: 700; font-size: 14.5px; }",
    ".ase-status{ display:block; font-size: 11.5px; color: rgba(245,246,248,0.5); margin-top: 2px; font-weight: 400; }",
    ".ase-close{",
    "  background: none; border: none; color: rgba(245,246,248,0.6); font-size: 20px;",
    "  line-height: 1; cursor: pointer; padding: 4px 8px; border-radius: 6px;",
    "}",
    ".ase-close:hover{ background: rgba(255,255,255,0.08); color: #F5F6F8; }",
    ".ase-messages{ flex: 1 1 auto; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }",
    ".ase-msg{ max-width: 84%; padding: 9px 12px; border-radius: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }",
    ".ase-msg-assistant{ align-self: flex-start; background: #1E2233; border-bottom-left-radius: 4px; }",
    ".ase-msg-user{ align-self: flex-end; background: linear-gradient(135deg, #8a5236, #7a6224); color: #fff; border-bottom-right-radius: 4px; }",
    ".ase-typing{ align-self: flex-start; background: #1E2233; border-radius: 13px; border-bottom-left-radius: 4px; padding: 10px 14px; display: flex; gap: 4px; }",
    ".ase-typing span{ width: 6px; height: 6px; border-radius: 50%; background: rgba(245,246,248,0.5); animation: aseBlink 1.2s infinite ease-in-out; }",
    ".ase-typing span:nth-child(2){ animation-delay: .15s; }",
    ".ase-typing span:nth-child(3){ animation-delay: .3s; }",
    "@keyframes aseBlink{ 0%,80%,100%{ opacity:.3; transform: translateY(0); } 40%{ opacity:1; transform: translateY(-2px); } }",
    ".ase-inputrow{ display: flex; gap: 8px; padding: 12px; border-top: 1px solid rgba(255,255,255,0.08); background: #12141F; flex: none; }",
    ".ase-input{",
    "  flex: 1 1 auto; background: #1E2233; border: 1px solid rgba(255,255,255,0.1); color: #F5F6F8;",
    "  border-radius: 10px; padding: 10px 12px; font-size: 14px; outline: none; font-family: inherit;",
    "}",
    ".ase-input:focus{ border-color: #D9B45C; }",
    ".ase-send{",
    "  flex: none; width: 40px; height: 40px; border-radius: 10px; border: none; cursor: pointer;",
    "  background: linear-gradient(135deg, #FF7A45, #D9B45C); color: #201206;",
    "  display: flex; align-items: center; justify-content: center;",
    "}",
    ".ase-send:disabled{ opacity: 0.5; cursor: default; }",
    ".ase-send svg{ width: 18px; height: 18px; }",
    "@media (max-width: 480px){",
    "  .ase-wrap{ right: 12px; bottom: 12px; }",
    "  .ase-panel{ width: calc(100vw - 24px); height: calc(100vh - 100px); bottom: 70px; }",
    "}",
  ].join("\n");
  root.appendChild(style);

  var wrap = document.createElement("div");
  wrap.className = "ase-wrap";
  wrap.innerHTML =
    '<button class="ase-toggle" type="button" aria-label="Open chat" aria-expanded="false">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.35 0-2.62-.31-3.75-.86L3 21l1.86-5.75A8.5 8.5 0 1 1 21 11.5z"/>' +
    "</svg></button>" +
    '<div class="ase-panel" hidden>' +
    '<div class="ase-header">' +
    '<span><span class="ase-title"></span><span class="ase-status">Usually replies in a few seconds</span></span>' +
    '<button class="ase-close" type="button" aria-label="Close chat">\u00D7</button>' +
    "</div>" +
    '<div class="ase-messages" role="log" aria-live="polite"></div>' +
    '<div class="ase-inputrow">' +
    '<input class="ase-input" type="text" placeholder="Type a message\u2026" maxlength="2000" />' +
    '<button class="ase-send" type="button" aria-label="Send message">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>' +
    "</button>" +
    "</div>" +
    "</div>";
  root.appendChild(wrap);

  var toggleBtn = wrap.querySelector(".ase-toggle");
  var panelEl = wrap.querySelector(".ase-panel");
  var closeBtn = wrap.querySelector(".ase-close");
  var titleEl = wrap.querySelector(".ase-title");
  var messagesEl = wrap.querySelector(".ase-messages");
  var inputEl = wrap.querySelector(".ase-input");
  var sendBtn = wrap.querySelector(".ase-send");

  titleEl.textContent = CONFIG.title;

  // ---------------------------------------------------------------------
  // Rendering helpers — always use textContent, never innerHTML, for
  // user- or model-supplied text, so nothing can inject markup/scripts.
  // ---------------------------------------------------------------------
  function renderMessage(role, text) {
    var div = document.createElement("div");
    div.className = "ase-msg " + (role === "user" ? "ase-msg-user" : "ase-msg-assistant");
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    state.history.push({ role: role, text: text });
    renderMessage(role, text);
  }

  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement("div");
    typingEl.className = "ase-typing";
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  // ---------------------------------------------------------------------
  // Networking — talks ONLY to your own backend, never to Gemini directly.
  // ---------------------------------------------------------------------
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || state.sending) return;

    var historyBeforeThisTurn = state.history.slice(-12);

    inputEl.value = "";
    addMessage("user", text);
    state.sending = true;
    sendBtn.disabled = true;
    showTyping();

    fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: historyBeforeThisTurn,
        siteKey: CONFIG.siteKey,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        hideTyping();
        if (!result.ok) {
          addMessage("assistant", (result.data && result.data.error) || "Something went wrong. Please try again.");
        } else {
          addMessage("assistant", (result.data && result.data.reply) || "Sorry, I didn't catch that.");
        }
      })
      .catch(function () {
        hideTyping();
        addMessage("assistant", "I'm having trouble connecting right now — please try again in a moment.");
      })
      .finally(function () {
        state.sending = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  function openPanel() {
    state.open = true;
    panelEl.hidden = false;
    toggleBtn.setAttribute("aria-expanded", "true");
    if (state.history.length === 0) addMessage("assistant", CONFIG.greeting);
    inputEl.focus();
  }
  function closePanel() {
    state.open = false;
    panelEl.hidden = true;
    toggleBtn.setAttribute("aria-expanded", "false");
  }

  toggleBtn.addEventListener("click", function () {
    state.open ? closePanel() : openPanel();
  });
  closeBtn.addEventListener("click", closePanel);
  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });
})();
