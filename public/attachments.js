// Přílohy pod zprávou (src/attachments.js): ťuknutím se obrázek otevře v okně na stránce,
// šipkami (nebo tlačítky) se listuje mezi přílohami, ťuknutím na obrázek se zvětší na plnou velikost.
// Bez JS odkaz otevře obrázek samotný.
const links = [...document.querySelectorAll(".article-attachments a[href]")];

function button(className, label, text) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.setAttribute("aria-label", label);
  element.textContent = text;
  return element;
}

function build() {
  const dialog = document.createElement("dialog");
  dialog.className = "attachment-viewer";
  dialog.setAttribute("aria-label", "Příloha");
  const frame = document.createElement("div");
  frame.className = "attachment-frame";
  const image = document.createElement("img");
  image.alt = "";
  frame.append(image);
  const bar = document.createElement("div");
  bar.className = "attachment-bar";
  const caption = document.createElement("p");
  const count = document.createElement("span");
  count.className = "attachment-count";
  const prev = button("attachment-prev", "Předchozí příloha", "‹");
  const next = button("attachment-next", "Další příloha", "›");
  const close = button("attachment-close", "Zavřít", "×");
  bar.append(prev, count, caption, next);
  dialog.append(close, frame, bar);
  document.body.append(dialog);

  let index = 0;
  const show = (to) => {
    index = (to + links.length) % links.length;
    const link = links[index];
    frame.classList.remove("is-zoomed");
    frame.scrollTo(0, 0);
    image.src = link.href;
    image.alt = link.querySelector("img")?.alt ?? "";
    caption.textContent = link.querySelector("span")?.textContent.trim() ?? "";
    count.textContent = links.length > 1 ? `${index + 1} / ${links.length}` : "";
  };

  dialog.classList.toggle("is-single", links.length < 2);
  prev.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  close.addEventListener("click", () => dialog.close());
  image.addEventListener("click", () => frame.classList.toggle("is-zoomed"));
  // Klik vedle obrázku (na ztmavené pozadí) okno zavře.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target === frame) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (links.length < 2) return;
    if (event.key === "ArrowLeft") show(index - 1);
    if (event.key === "ArrowRight") show(index + 1);
  });
  dialog.addEventListener("close", () => image.removeAttribute("src"));

  return (to) => {
    show(to);
    dialog.showModal();
    close.focus();
  };
}

if (links.length) {
  let open = null;
  links.forEach((link, index) => {
    link.removeAttribute("target");
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open ??= build();
      open(index);
    });
  });
}
