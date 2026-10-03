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
