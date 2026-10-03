// Akce: šipky kalendáře přepnou měsíc bez načtení celé stránky. Bez JS vedou na /akce?mesic=… a funguje to taky.
function swap(cal, href) {
  cal.classList.add("is-loading");
  fetch(href, { headers: { Accept: "text/html" } })
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
    .then((html) => {
      const fresh = new DOMParser().parseFromString(html, "text/html").querySelector("[data-cal]");
      if (!fresh) throw new Error("bez kalendáře");
      cal.replaceWith(fresh);
      const url = new URL(href, location.href);
      history.replaceState(null, "", url.pathname + url.search);
      fresh.querySelector("h2")?.focus({ preventScroll: true });
    })
    .catch(() => {
      location.href = href;
    });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-cal-nav]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  const cal = link.closest("[data-cal]");
  if (!cal) return;
  event.preventDefault();
  swap(cal, link.href);
});
