// Zvoneček upozornění v hlavičce a jednorázová nabídka (src/push/promo.js).
// Kde prohlížeč upozornění neumí, zvoneček zmizí (iPhone ho vidí: na stránce se dozví, jak drbnu přidat na plochu).
// Nabídka vyskočí nejvýš OFFER_TIMES krát a znovu nejdřív po OFFER_GAP_DAYS dnech, vždy až poslední v řadě:
// na mobilu má stránka s uvítacím oknem jen to, na další „Zeptej se mě!“ chatu a po ní bublina; na počítači
// bublina přijde chvíli po zavření uvítacího okna. Ne tomu, kdo už odebírá nebo ťukl na „Chci upozornění“,
// a ne do otevřeného chatu.
(() => {
  const bell = document.querySelector("[data-push-bell]");
  // Kolikrát a kdy naposledy se nabídka ukázala ({ n, last }), nebo { done: true } po „Chci upozornění“.
  const OFFER = "drbna-push-offer";
  const OFFER_TIMES = 2;
  const OFFER_GAP_DAYS = 14;
  // Mezera po nápovědě chatu a začátek na stránce bez chatu.
  const PAUSE = 1000;
  const QUIET_START = 2500;
  // Stejná hranice mobilu jako u chatu (public/chat.js).
  const MOBILE = "(max-width: 540px), (pointer: coarse) and (max-height: 540px)";
  const store = {
    get: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Bez úložiště (soukromé okno) se nabídka prostě neukáže.
      }
    },
  };
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!supported && !ios) {
    if (bell) bell.hidden = true;
    return;
  }

  async function subscribed() {
    if (!supported || Notification.permission !== "granted") return false;
    const registration = await navigator.serviceWorker.getRegistration("/");
    return Boolean(registration && (await registration.pushManager.getSubscription()));
  }

  // Ocásek bubliny míří na obličej Drběny v tlačítku chatu (na počítači je vedle ní nápis).
  function aimTail(box) {
    const face = document.querySelector(".chat-fab img");
    if (!face || !box.isConnected) return;
    const goat = face.getBoundingClientRect();
    const bubble = box.getBoundingClientRect();
    const fromRight = bubble.right - (goat.left + goat.width / 2) - 8;
    if (fromRight > 12 && fromRight < bubble.width - 24) box.style.setProperty("--push-tail", `${fromRight}px`);
  }

  function offered() {
    try {
      const value = JSON.parse(store.get(OFFER) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function daysSince(day, today) {
    return Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  }

  function offer() {
    // Na stránce Upozornění nabídka nedává smysl (server ji tam ani nevkládá), i s lomítkem na konci.
    if (location.pathname.replace(/\/+$/, "") === "/upozorneni") return;
    if (supported && Notification.permission === "denied") return;
    const today = new Date().toLocaleDateString("sv");
    const past = offered();
    if (past.done || (past.n ?? 0) >= OFFER_TIMES) return;
    if (past.last && daysSince(past.last, today) < OFFER_GAP_DAYS) return;
    const template = document.querySelector("template[data-push-offer]");
    if (!template) return;
    afterOthers(() => show(template));
  }

  // Ukáže se na téhle stránce uvítací okno (public/welcome.js, i znovu všem po změně v redakci)?
  function welcomeDue() {
    const welcome = document.querySelector("template[data-welcome]");
    return Boolean(welcome) && store.get("drbna-uvitani") !== welcome.dataset.welcome;
  }

  // Bublina je poslední v řadě. Na mobilu patří stránka s uvítacím oknem jen jemu a bublina počká na další stránku,
  // kde čeká, až chat řekne, že „Zeptej se mě!“ dořekla (public/chat.js). Na počítači nápověda chatu není,
  // bublina tam přijde chvíli po zavření uvítacího okna.
  function afterOthers(then) {
    const next = () => setTimeout(then, PAUSE);
    if (welcomeDue()) {
      if (!matchMedia(MOBILE).matches) document.addEventListener("drbna:welcome-closed", next, { once: true });
      return;
    }
    if (document.querySelector("[data-chat]")) {
      if (document.documentElement.dataset.chatHint === "done") next();
      else document.addEventListener("drbna:chat-hint-done", next, { once: true });
    } else setTimeout(then, QUIET_START);
  }

  function show(template) {
    // Kdo si zrovna povídá s Drběnou, toho nerušit: nabídka přijde při jiné stránce nebo návštěvě.
    const chatRoot = document.querySelector("[data-chat]");
    if (chatRoot?.classList.contains("is-open") || document.documentElement.dataset.chatUsed) return;
    const box = template.content.firstElementChild.cloneNode(true);
    // Bez chatu na stránce není Drběna, která by bublinu říkala: přijde s ní.
    if (!document.querySelector("[data-chat]")) box.classList.add("with-goat");
    box.querySelector("[data-push-offer-no]").addEventListener("click", () => box.remove());
    box.querySelector("[data-push-offer-yes]").addEventListener("click", () => store.set(OFFER, JSON.stringify({ done: true })));
    document.body.append(box);
    // Počítá se každé ukázání, ať na ni klikne, nebo ne. Zvoneček v hlavičce zůstává vždycky.
    const past = offered();
    store.set(OFFER, JSON.stringify({ n: (past.n ?? 0) + 1, last: new Date().toLocaleDateString("sv") }));
    aimTail(box);
    // Tlačítko chatu staví public/chat.js, může přijít až po bublině.
    const chat = document.querySelector("[data-chat]");
    if (chat && !chat.querySelector(".chat-fab")) {
      const watch = new MutationObserver(() => {
        if (!chat.querySelector(".chat-fab img")) return;
        watch.disconnect();
        requestAnimationFrame(() => aimTail(box));
      });
      watch.observe(chat, { childList: true, subtree: true });
    }
    window.addEventListener("resize", () => aimTail(box));
    // Otevře chat, když je bublina vidět: zmizí a už se na téhle stránce nevrátí.
    if (chatRoot) {
      const opened = new MutationObserver(() => {
        if (!chatRoot.classList.contains("is-open")) return;
        opened.disconnect();
        box.remove();
      });
      opened.observe(chatRoot, { attributes: true, attributeFilter: ["class"] });
    }
  }

  subscribed()
    .then((on) => {
      if (on) {
        bell?.classList.add("is-on");
        bell?.setAttribute("aria-label", "Upozornění jsou zapnutá");
        store.set(OFFER, JSON.stringify({ done: true }));
      } else offer();
    })
    .catch(() => {});
})();
