// Web: pás rubrik. Bez JS jde všechno taky, tohle jen pomáhá na úzkém displeji.
// Vybraná rubrika se posune do záběru, okraje pásu zeslábnou, když je za nimi další rubrika,
// a podblok s podrubrikami ukáže šipkou na svou rubriku.

function setupRubricNav(nav) {
  const tabs = nav.querySelector("[data-rubric-tabs]");
  const sub = nav.querySelector("[data-rubric-sub]");
  const active = tabs?.querySelector(".rubric-tab.is-on");
  if (!tabs) return;

  if (active) {
    const left = active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2;
    tabs.scrollLeft = Math.max(0, left);
  }

  function update() {
    const max = tabs.scrollWidth - tabs.clientWidth;
    tabs.classList.toggle("fade-start", tabs.scrollLeft > 2);
    tabs.classList.toggle("fade-end", tabs.scrollLeft < max - 2);
    if (!sub || !active) return;
    const tabBox = active.getBoundingClientRect();
    const subBox = sub.getBoundingClientRect();
    const x = tabBox.left + tabBox.width / 2 - subBox.left;
    const inside = x > 16 && x < subBox.width - 16;
    sub.classList.toggle("has-notch", inside);
    if (inside) sub.style.setProperty("--notch-x", `${Math.round(x)}px`);
  }

  update();
  tabs.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
}

document.querySelectorAll("[data-rubric-nav]").forEach(setupRubricNav);
