// Menu na počítači: rozbalené „Praktické“ zavře klik jinam nebo Esc. Bez JS se zavírá znovu kliknutím na položku.
const more = document.querySelector("[data-nav-more]");

if (more) {
  document.addEventListener("click", (event) => {
    if (more.open && !more.contains(event.target)) more.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !more.open) return;
    more.open = false;
    more.querySelector("summary").focus();
  });
}

// Zpráva: „Zpět na zprávy“ vrátí čtenáře na výpis zpráv, ze kterého přišel (i s rubrikou), i když mezitím
// přešel na další zprávu, a výpis sjede na zprávu, kterou z něj otevřel. Když přišel odjinud
// (titulka, akce, zvenku), nebo bez JS a sessionStorage, vede odkaz na /zpravy.
const BACK_KEY = "drbna:zpet";
const CARD_KEY = "drbna:zpet-zprava";
const RETURN_KEY = "drbna:zpet-navrat";
const isArticle = /^\/zpravy\/./.test(location.pathname);
const isList = location.pathname === "/zpravy";

function store(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Bez sessionStorage odkaz prostě vede na /zpravy.
  }
}

function stored(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

if (isList) {
  store(BACK_KEY, location.pathname + location.search);
  document.addEventListener("click", (event) => {
    const card = event.target.closest?.('a.story[href^="/zpravy/"]');
    if (card) store(CARD_KEY, card.getAttribute("href"));
  });
  window.addEventListener("pageshow", (event) => {
    if (!stored(RETURN_KEY)) return;
    store(RETURN_KEY, null);
    // Krok zpět z mezipaměti prohlížeče už posunutí obnovil sám.
    if (event.persisted) return;
    const href = stored(CARD_KEY);
    const card = href && document.querySelector(`a.story[href="${CSS.escape(href)}"]`);
    if (card) card.scrollIntoView({ block: "center", behavior: "instant" });
  });
} else if (!isArticle) {
  store(BACK_KEY, null);
  store(CARD_KEY, null);
}

const back = isArticle && document.querySelector("[data-back]");
const target = stored(BACK_KEY);
if (back && target) {
  back.href = target;
  back.addEventListener("click", (event) => {
    store(RETURN_KEY, "1");
    // Přišel přímo z výpisu: krok zpět v historii, ať nepřibude další záznam.
    const from = document.referrer && new URL(document.referrer);
    if (from && from.origin === location.origin && from.pathname + from.search === target) {
      event.preventDefault();
      history.back();
    }
  });
}
