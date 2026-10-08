// Zvoneček upozornění v hlavičce a jednorázová nabídka (src/push/promo.js).
// Kde prohlížeč upozornění neumí, zvoneček zmizí (iPhone ho vidí: na stránce se dozví, jak drbnu přidat na plochu).
// Nabídka vyskočí nejvýš OFFER_TIMES krát a znovu nejdřív po OFFER_GAP_DAYS dnech, poprvé až při návštěvě v jiný
// den než první (první den má uvítací okno). Ne tomu, kdo už odebírá nebo ťukl na „Chci upozornění“, a ne do otevřeného chatu.
(() => {
  const bell = document.querySelector("[data-push-bell]");
  const FIRST = "drbna-push-first";
  // Kolikrát a kdy naposledy se nabídka ukázala ({ n, last }), nebo { done: true } po „Chci upozornění“.
  const OFFER = "drbna-push-offer";
  const OFFER_TIMES = 2;
  const OFFER_GAP_DAYS = 14;
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
    if (location.pathname === "/upozorneni") return;
    if (supported && Notification.permission === "denied") return;
    const today = new Date().toLocaleDateString("sv");
    // Uvítací okno (public/welcome.js) má přednost: v den, kdy se ukazuje (i znovu všem po změně v redakci),
    // bublina nepřijde, počítá se od toho dne znovu.
    const welcome = document.querySelector("template[data-welcome]");
    if (welcome && store.get("drbna-uvitani") !== welcome.dataset.welcome) {
      store.set(FIRST, today);
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    const first = store.get(FIRST);
    if (!first) store.set(FIRST, today);
    if (!first || first === today) return;
    const past = offered();
    if (past.done || (past.n ?? 0) >= OFFER_TIMES) return;
    if (past.last && daysSince(past.last, today) < OFFER_GAP_DAYS) return;
    const template = document.querySelector("template[data-push-offer]");
    if (!template) return;
    afterChatHint(() => show(template));
  }

  // Na mobilu chat jednou za návštěvu řekne „Zeptej se mě!“ (public/chat.js). Bublina s upozorněním počká,
  // až dořekne, ať nemluví dvě najednou. Když se nápověda tentokrát neukáže, přijde bublina po chvíli sama.
  function afterChatHint(then) {
    const chat = document.querySelector("[data-chat]");
    const mobile = matchMedia("(max-width: 540px), (pointer: coarse) and (max-height: 540px)").matches;
    let hintDue = false;
    try {
      hintDue = !sessionStorage.getItem("drbna-chat-napoveda");
    } catch {
      hintDue = false;
    }
    if (!chat || !mobile || !hintDue) {
      setTimeout(then, 1500);
      return;
    }
    let seen = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      watch.disconnect();
      setTimeout(then, 1200);
    };
    const watch = new MutationObserver(() => {
      const hint = chat.querySelector(".chat-hint");
      if (!hint) return;
      if (hint.classList.contains("is-shown")) seen = true;
      else if (seen && hint.hidden) finish();
    });
    watch.observe(chat, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });
    // Nápověda se ukáže po 2,5 s; když do 4 s nepřišla (otevřený chat, uvítací okno), nečeká se.
    setTimeout(() => {
      if (!seen) finish();
    }, 4000);
  }

  function show(template) {
    // Kdo si zrovna povídá s Drběnou, toho nerušit: nabídka přijde při jiné stránce nebo návštěvě.
    const chatRoot = document.querySelector("[data-chat]");
    if (chatRoot?.classList.contains("is-open")) return;
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
