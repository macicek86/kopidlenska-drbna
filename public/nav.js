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
// přešel na další zprávu, a výpis sjede na zprávu, kterou z něj otevřel. Když přišel odjinud z drbny
// (titulka, akce, jiná zpráva), vede odkaz tam, odkud přišel („Zpět na akce“, u ostatních stránek jen „Zpět“),
// a vedle něj se ukáže „Všechny zprávy“. Zvenku, přímým odkazem nebo bez JS vede na /zpravy.
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
} else if (back) {
  const from = document.referrer && new URL(document.referrer);
  if (from && from.origin === location.origin && from.pathname + from.search !== location.pathname + location.search) {
    const labels = backLabels(back);
    const section = "/" + from.pathname.split("/")[1];
    const label = labels[section] ?? labels[""];
    if (label) {
      back.href = from.pathname + from.search + from.hash;
      back.textContent = label;
      const all = document.querySelector("[data-back-all]");
      if (all) all.hidden = false;
      back.addEventListener("click", (event) => {
        // V nové kartě historie není, tam odkaz prostě otevře stránku, odkud přišel.
        if (history.length < 2) return;
        event.preventDefault();
        history.back();
      });
    }
  }
}

function backLabels(link) {
  try {
    return JSON.parse(link.dataset.back) || {};
  } catch {
    return {};
  }
}

// Karta, na kterou vede odkaz, zasvítí přes :target. Ťuknutí na stejný odkaz podruhé adresu nezmění,
// proto ji rozsvítí znovu třída is-flash.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.('a[href*="#"]');
  if (!link || link.pathname !== location.pathname || link.search !== location.search || link.hash !== location.hash) return;
  const card = link.hash.length > 1 && document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (!card) return;
  card.classList.remove("is-flash");
  void card.offsetWidth;
  card.classList.add("is-flash");
});
