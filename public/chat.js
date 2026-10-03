// Web: plovoucí okénko „Zeptej se Drběny“. Rozhovor drží v sessionStorage, ať přežije přechod na jinou stránku.
// Turnstile se načte, až když člověk poprvé píše; ověření proběhne většinou samo, bez klikání.

const root = document.querySelector("[data-chat]");
const STORE = "drbna-chat";
const QUESTION_MAX = 500;
const HISTORY = 8;
const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const IDEAS = ["Kdy jede popelář?", "Co se chystá o víkendu?", "Kdy má otevřeno knihovna?"];
const GREETING = "Ahoj, já jsem Drběna. Zeptejte se mě na cokoli z Kopidlna: kdy jede popelář, kdo má dnes otevřeno nebo co se chystá.";

function load() {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORE) ?? "{}");
    return { messages: Array.isArray(value.messages) ? value.messages : [], pass: typeof value.pass === "string" ? value.pass : "" };
  } catch {
    return { messages: [], pass: "" };
  }
}

function save(state) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify({ messages: state.messages.slice(-30), pass: state.pass }));
  } catch {
    // Bez úložiště chat funguje taky, jen rozhovor nepřežije přechod na jinou stránku.
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Odkazy jen na vlastní web ([text](/adresa)) a tučné písmo (**text**). Všechno ostatní je čistý text.
function inline(parent, text) {
  const pattern = /\[([^\]]+)\]\((\/(?!\/)[^)\s]*)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(text.slice(last, match.index));
    if (match[2]) {
      const link = el("a", "", match[1]);
      link.href = match[2];
      parent.append(link);
    } else {
      parent.append(el("strong", "", match[3]));
    }
    last = match.index + match[0].length;
  }
  parent.append(text.slice(last));
}

function richText(text) {
  const box = el("div", "chat-text");
  let list = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      if (!list) list = box.appendChild(el("ul"));
      inline(list.appendChild(el("li")), bullet[1]);
    } else {
      list = null;
      inline(box.appendChild(el("p")), line);
    }
  }
  return box;
}

let turnstileReady = null;

function loadTurnstile() {
  if (!turnstileReady) {
    turnstileReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TURNSTILE;
      script.async = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => {
        turnstileReady = null;
        reject(new Error("turnstile"));
      };
      document.head.append(script);
    });
  }
  return turnstileReady;
}

async function turnstileToken(box, sitekey) {
  const turnstile = await loadTurnstile();
  box.hidden = false;
  try {
    return await new Promise((resolve, reject) => {
      const id = turnstile.render(box, {
        sitekey,
        appearance: "interaction-only",
        language: "cs",
        size: "flexible",
        callback: (token) => {
          turnstile.remove(id);
          resolve(token);
        },
        "error-callback": () => {
          turnstile.remove(id);
          reject(new Error("turnstile"));
        },
      });
    });
  } finally {
    box.hidden = true;
  }
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Prázdná nebo rozbitá odpověď.
  }
  return { status: response.status, data };
}

function setup() {
  const sitekey = root.dataset.sitekey || "";
  const state = load();
  let busy = false;

  const fab = el("button", "chat-fab");
  fab.type = "button";
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-controls", "chat-okno");
  fab.setAttribute("aria-label", "Zeptej se Drběny");
  const face = el("img");
  face.src = "/kozel-maskot.webp";
  face.alt = "";
  fab.append(face, el("span", "", "Zeptej se Drběny"));

  const panel = el("section", "chat-panel");
  panel.id = "chat-okno";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat s kozou Drběnou");

  const head = el("header", "chat-head");
  const headFace = el("img");
  headFace.src = "/kozel-maskot.webp";
  headFace.alt = "";
  const title = el("div", "chat-title");
  title.append(el("strong", "", "Koza Drběna"), el("small", "", "Chat s expertkou na Kopidlenskou drbnu"));
  const close = el("button", "chat-x", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Zavřít chat");
  head.append(headFace, title, close);

  const log = el("div", "chat-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  const check = el("div", "chat-check");
  check.hidden = true;

  const form = el("form", "chat-form");
  const field = el("textarea");
  field.rows = 1;
  field.maxLength = QUESTION_MAX;
  field.placeholder = "Na co se chcete zeptat?";
  field.setAttribute("aria-label", "Otázka pro Drběnu");
  const send = el("button", "chat-send");
  send.type = "submit";
  send.setAttribute("aria-label", "Odeslat");
  send.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="m12 5 7 7-7 7"/></svg>';
  form.append(field, send);

  const fine = el("p", "chat-fine", "Odpovídá umělá inteligence a může se splést.");

  panel.append(head, log, check, form, fine);
  root.append(fab, panel);

  function bubble(role, text, extra = "") {
    const item = el("div", `chat-msg chat-${role}${extra ? ` ${extra}` : ""}`);
    if (role === "assistant") item.append(richText(text));
    else item.append(el("p", "", text));
    log.append(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function render() {
    log.textContent = "";
    bubble("assistant", GREETING);
    for (const message of state.messages) bubble(message.role, message.text);
    if (!state.messages.length) {
      const ideas = el("div", "chat-ideas");
      for (const idea of IDEAS) {
        const chip = el("button", "chat-idea", idea);
        chip.type = "button";
        chip.addEventListener("click", () => ask(idea));
        ideas.append(chip);
      }
      log.append(ideas);
    }
  }

  async function ensurePass() {
    if (state.pass) return true;
    let token = "";
    if (sitekey) {
      try {
        token = await turnstileToken(check, sitekey);
      } catch {
        return false;
      }
    }
    const { data } = await post("/chat/zacit", { token });
    if (!data.pass) return false;
    state.pass = data.pass;
    save(state);
    return true;
  }

  async function ask(question) {
    const text = question.trim().slice(0, QUESTION_MAX);
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    log.querySelector(".chat-ideas")?.remove();
    const history = state.messages.slice(-HISTORY);
    state.messages.push({ role: "user", text });
    save(state);
    bubble("user", text);
    field.value = "";
    fit();
    const typing = bubble("assistant", "Drběna píše…", "chat-typing");
    try {
      let result = { status: 0, data: {} };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!(await ensurePass())) {
          result = { status: 403, data: { error: "Nepodařilo se ověřit, že nejste robot. Zkuste to znovu." } };
          break;
        }
        result = await post("/chat/zeptat", { pass: state.pass, question: text, history });
        if (!result.data.restart) break;
        state.pass = "";
        save(state);
      }
      typing.remove();
      if (result.data.answer) {
        state.messages.push({ role: "assistant", text: result.data.answer });
        save(state);
        bubble("assistant", result.data.answer);
        if (typeof result.data.left === "number" && result.data.left <= 3) {
          bubble("note", result.data.left ? `Dnes se můžete zeptat ještě ${result.data.left}×.` : "Na dnešek jste otázky vyčerpali.");
        }
      } else {
        bubble("assistant", result.data.error || "Něco se nepovedlo. Zkuste to prosím znovu.", "chat-error");
      }
    } catch {
      typing.remove();
      bubble("assistant", "Nepodařilo se spojit. Zkontrolujte připojení a zkuste to znovu.", "chat-error");
    } finally {
      busy = false;
      send.disabled = false;
      field.focus();
    }
  }

  // Výška podle textu (i s rámečkem, jinak naskočí posuvník); posuvník jen nad maximální výškou.
  function fit() {
    field.style.height = "auto";
    const border = field.offsetHeight - field.clientHeight;
    const height = field.scrollHeight + border;
    field.style.height = `${Math.min(height, 120)}px`;
    field.style.overflowY = height > 120 ? "auto" : "hidden";
  }

  // Na mobilu okénko vyplní jen viditelnou část nad klávesnicí, ať hlavička nezajede nahoru.
  const phone = window.matchMedia("(max-width: 540px)");
  const viewport = window.visualViewport;

  function fitScreen() {
    if (panel.hidden || !phone.matches || !viewport) {
      root.style.removeProperty("top");
      root.style.removeProperty("height");
      return;
    }
    root.style.top = `${Math.round(viewport.offsetTop) + 8}px`;
    root.style.height = `${Math.round(viewport.height) - 16}px`;
    log.scrollTop = log.scrollHeight;
  }

  viewport?.addEventListener("resize", fitScreen);
  viewport?.addEventListener("scroll", fitScreen);
  phone.addEventListener("change", fitScreen);

  function open() {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
    document.documentElement.classList.add("chat-lock");
    render();
    fitScreen();
    field.focus();
  }

  function shut() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
    document.documentElement.classList.remove("chat-lock");
    fitScreen();
    fab.focus();
  }

  fab.addEventListener("click", () => (panel.hidden ? open() : shut()));
  close.addEventListener("click", shut);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") shut();
  });
  field.addEventListener("input", fit);
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask(field.value);
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(field.value);
  });
}

if (root) setup();
