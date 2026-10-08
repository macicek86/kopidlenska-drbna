// Uvítací okno s Drběnou (src/welcome.js): jednou, při první návštěvě, pár sekund po načtení stránky.
// Že ho návštěvník viděl, si pamatuje localStorage (žádné cookies) jako verzi okna. Když redakce zaškrtne
// „Ukázat okno znovu všem“, verze se změní a okno se ukáže znovu. Bez localStorage se neukáže vůbec,
// jinak by vyskočilo na každé stránce.
const KEY = "drbna-uvitani";
const DELAY = 3000;
const template = document.querySelector("template[data-welcome]");

function seen() {
  try {
    return localStorage.getItem(KEY) === template.dataset.welcome;
  } catch {
    return true;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, template.dataset.welcome);
  } catch {
    // Bez úložiště se okno stejně neukáže.
  }
}

// Čtenář je zrovna zabraný do něčeho jiného (chat, jiné okno): přivítání počká na další stránku.
function busy() {
  return document.querySelector("dialog[open], .chat.is-open") !== null;
}

function show() {
  if (busy()) return;
  const dialog = template.content.firstElementChild.cloneNode(true);
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    // Klik na tlačítko zavřít, nebo vedle okna (na ztmavené pozadí).
    if (event.target === dialog || event.target.closest("[data-welcome-close]")) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    // Na počítači po něm přijde bublina s upozorněním (public/push-bell.js).
    document.dispatchEvent(new Event("drbna:welcome-closed"));
  });
  dialog.showModal();
  // Fokus na okno samotné, ne na první odkaz: čtečka přečte nadpis a Tab vede dál do okna.
  dialog.focus();
  remember();
}

function later() {
  setTimeout(() => (document.hidden ? document.addEventListener("visibilitychange", later, { once: true }) : show()), DELAY);
}

if (template && !seen() && !/bot|crawl|spider|lighthouse|headless/i.test(navigator.userAgent)) {
  document.documentElement.dataset.welcome = "1";
  later();
}
