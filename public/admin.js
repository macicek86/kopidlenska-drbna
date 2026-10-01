// Redakce: okna, hledání v seznamech, hlídání neuložených změn a hlášky.
// Všechno jde i bez JS. Okna pak jsou obyčejné stránky s adresou (?id=, ?smazat=, ?novy=1…).

const CLEAN_PARAMS = ["ok", "chyba"];
let returnUrl = null;
let submitting = false;

function currentUrl() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function cleanFlashFromUrl() {
  const url = new URL(location.href);
  let changed = false;
  for (const name of CLEAN_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (changed) history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function basePath() {
  return location.pathname;
}

/* --- Okna ---------------------------------------------------------------- */

function isDirty(root) {
  return Boolean(root.querySelector("form.is-dirty"));
}

function focusFirst(dialog) {
  const target = dialog.querySelector(
    ".modal-body input:not([type=hidden]):not([type=checkbox]):not([type=file]), .modal-body textarea:not([hidden]), .modal-body select, .modal-body button",
  );
  if (target && !matchMedia("(max-width: 639px)").matches) target.focus({ preventScroll: true });
}

// `url` přepíše adresu, ať obnovení stránky okno zase otevře. Zavření vrátí adresu, ze které se přišlo.
function openDialog(dialog, { url } = {}) {
  if (!dialog) return;
  if (url) {
    returnUrl = currentUrl();
    history.replaceState(null, "", url);
  }
  if (dialog.open && !dialog.matches(":modal")) dialog.close();
  if (!dialog.open) dialog.showModal();
  dialog.dataset.js = "1";
  focusFirst(dialog);
}

function finishClose(dialog) {
  if (dialog.open) dialog.close();
  for (const form of dialog.querySelectorAll("form.is-dirty")) {
    form.reset();
    form.classList.remove("is-dirty");
  }
  if (dialog.dataset.fetched) dialog.remove();
  const back = returnUrl ?? dialog.dataset.close ?? basePath();
  returnUrl = null;
  const target = new URL(back, location.href);
  history.replaceState(null, "", `${target.pathname}${target.search}`);
}

function askLeave() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `<div class="leave">
      <p><b>Máte neuložené změny.</b> Zavřít okno a zahodit je?</p>
      <div class="form-foot">
        <button class="btn btn-line" type="button" data-answer="0">Pokračovat v úpravách</button>
        <span class="form-foot-gap"></span>
        <button class="btn btn-danger" type="button" data-answer="1">Zahodit změny</button>
      </div>
    </div>`;
    document.body.append(dialog);
    const done = (answer) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    dialog.addEventListener("click", (event) => {
      const button = event.target.closest("[data-answer]");
      if (button) done(button.dataset.answer === "1");
      else if (event.target === dialog) done(false);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      done(false);
    });
    dialog.showModal();
    dialog.querySelector("[data-answer='0']").focus();
  });
}

async function requestClose(dialog) {
  if (isDirty(dialog) && !(await askLeave())) return;
  finishClose(dialog);
}

function showLoading() {
  const node = document.createElement("div");
  node.className = "modal-loading";
  node.innerHTML = "<span></span>";
  document.body.append(node);
  return () => node.remove();
}

async function openRemote(href) {
  const hide = showLoading();
  try {
    const response = await fetch(href, { credentials: "same-origin", headers: { "x-drbna": "okno" } });
    const target = new URL(href, location.href);
    const landed = new URL(response.url);
    if (!response.ok || landed.pathname !== target.pathname) throw new Error("jinam");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const dialog = doc.querySelector("dialog[data-autoopen]");
    if (!dialog) throw new Error("bez okna");
    dialog.removeAttribute("open");
    dialog.removeAttribute("data-autoopen");
    dialog.dataset.fetched = "1";
    document.getElementById(dialog.id)?.remove();
    const node = document.importNode(dialog, true);
    document.body.append(node);
    node.dispatchEvent(new CustomEvent("drbna:mount", { bubbles: true }));
    bindForms(node);
    openDialog(node, { url: `${target.pathname}${target.search}` });
  } catch {
    location.href = href;
  } finally {
    hide();
  }
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const opener = event.target.closest("[data-open]");
  if (opener) {
    const dialog = document.getElementById(opener.dataset.open);
    if (dialog) {
      event.preventDefault();
      openDialog(dialog);
    }
    return;
  }
  const remote = event.target.closest("a[data-modal]");
  if (remote) {
    event.preventDefault();
    const inside = remote.closest("dialog");
    if (inside) {
      finishClose(inside);
    }
    openRemote(remote.getAttribute("href"));
    return;
  }
  const dismiss = event.target.closest("[data-dismiss]");
  if (dismiss) {
    const dialog = dismiss.closest("dialog");
    if (dialog?.matches(":modal")) {
      event.preventDefault();
      requestClose(dialog);
    }
    return;
  }
  if (event.target instanceof HTMLDialogElement && event.target.classList.contains("modal") && event.target.dataset.js) {
    const box = event.target.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) requestClose(event.target);
  }
});

document.addEventListener(
  "cancel",
  (event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.dataset.js) return;
    event.preventDefault();
    requestClose(dialog);
  },
  true,
);

/* --- Formuláře ----------------------------------------------------------- */

function markDirty(event) {
  const form = event.target.closest?.("form");
  if (!form || form.matches(".inline-form, [method=get]")) return;
  if (event.target.matches?.("[type=search]")) return;
  form.classList.add("is-dirty");
  const holder = form.closest("[data-dirty]") ?? form;
  holder.classList.add("is-dirty");
}

function bindForms(root) {
  for (const area of root.querySelectorAll("textarea[data-count][maxlength]")) {
    if (area.dataset.counted) continue;
    area.dataset.counted = "1";
    const counter = document.createElement("span");
    counter.className = "char-count";
    const label = area.closest(".field");
    const paint = () => {
      const max = Number(area.maxLength);
      const used = area.value.length;
      counter.textContent = `${used} / ${max}`;
      counter.classList.toggle("is-near", used > max * 0.9);
    };
    (label ?? area.parentElement).append(counter);
    area.addEventListener("input", paint);
    paint();
  }
  for (const box of root.querySelectorAll("[data-slot-toggle]")) paintSlot(box);
}

function paintSlot(box) {
  box.closest("[data-slot]")?.classList.toggle("is-off", !box.checked);
}

document.addEventListener("input", markDirty);
document.addEventListener("change", (event) => {
  markDirty(event);
  if (event.target.matches?.("[data-slot-toggle]")) paintSlot(event.target);
});

document.addEventListener("trix-change", (event) => {
  const form = event.target.closest("form");
  if (form && event.target.editor && form.dataset.trixSeen) form.classList.add("is-dirty");
});
document.addEventListener("trix-initialize", (event) => {
  const form = event.target.closest("form");
  if (form) setTimeout(() => (form.dataset.trixSeen = "1"), 0);
});

document.addEventListener("submit", (event) => {
  if (event.defaultPrevented) return;
  const form = event.target;
  submitting = true;
  const button = event.submitter ?? form.querySelector("button[type=submit]");
  if (button && !button.disabled) {
    const busy = button.dataset.busy ?? "Ukládám…";
    setTimeout(() => {
      button.setAttribute("aria-busy", "true");
      button.disabled = true;
      button.textContent = busy;
    }, 0);
  }
});

window.addEventListener("pageshow", () => {
  submitting = false;
});

window.addEventListener("beforeunload", (event) => {
  if (submitting) return;
  const dirty = document.querySelector("[data-dirty].is-dirty, dialog[open] form.is-dirty");
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle]");
  if (toggle) {
    const target = document.getElementById(toggle.dataset.toggle);
    if (!target) return;
    const shown = target.classList.toggle("is-shown");
    toggle.setAttribute("aria-expanded", String(shown));
    if (shown) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      target.querySelector("textarea, input")?.focus({ preventScroll: true });
    }
    return;
  }
  const copy = event.target.closest("[data-copy-week]");
  if (copy) copyMonday(copy.closest("[data-week]"));
});

function copyMonday(grid) {
  if (!grid) return;
  const rows = [...grid.querySelectorAll(".wg-row")];
  const [first, ...rest] = rows;
  if (!first) return;
  const firstSlots = [...first.querySelectorAll(".wg-slot")];
  for (const row of rest) {
    const slots = [...row.querySelectorAll(".wg-slot")];
    slots.forEach((slot, index) => {
      const toggle = slot.querySelector("[data-slot-toggle]") ?? row.querySelector("[data-slot-toggle]");
      if (toggle && !toggle.checked) return;
      const from = firstSlots[index];
      if (!from) return;
      const sourceInputs = [...from.querySelectorAll("input:not([type=checkbox])")];
      const targetInputs = [...slot.querySelectorAll("input:not([type=checkbox])")];
      targetInputs.forEach((input, at) => {
        if (sourceInputs[at]) input.value = sourceInputs[at].value;
      });
    });
  }
  grid.closest("form")?.classList.add("is-dirty");
}

document.addEventListener("keydown", (event) => {
  if (!(event.key === "s" && (event.ctrlKey || event.metaKey))) return;
  const dialog = [...document.querySelectorAll("dialog.modal")].reverse().find((node) => node.matches(":modal"));
  const form = dialog?.querySelector("form") ?? document.querySelector("[data-dirty].is-dirty, form[data-dirty]");
  if (!form) return;
  event.preventDefault();
  form.requestSubmit();
});

/* --- Hledání ------------------------------------------------------------- */

document.addEventListener("input", (event) => {
  const box = event.target;
  if (box.matches?.("[data-filter]")) {
    const panel = document.getElementById(box.dataset.filter);
    if (!panel) return;
    const needle = box.value.trim().toLowerCase();
    let shown = 0;
    for (const row of panel.querySelectorAll(".item")) {
      const hit = !needle || (row.dataset.search ?? "").includes(needle);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    const empty = panel.querySelector("[data-filter-empty]");
    if (empty) empty.hidden = shown > 0;
  }
  if (box.matches?.("[data-text-filter]")) {
    const needle = box.value.trim().toLowerCase();
    for (const group of document.querySelectorAll(".text-group")) {
      let hits = 0;
      for (const row of group.querySelectorAll(".text-field")) {
        const value = row.querySelector("input, textarea")?.value ?? "";
        const hit = !needle || `${row.dataset.search ?? ""} ${value.toLowerCase()}`.includes(needle);
        row.hidden = !hit;
        if (hit) hits += 1;
      }
      group.hidden = hits === 0;
      if (needle) group.open = hits > 0;
    }
  }
});

document.addEventListener("click", (event) => {
  const expand = event.target.closest("[data-expand]");
  if (!expand) return;
  const groups = [...document.querySelectorAll(".text-group")];
  const open = !groups.every((group) => group.open);
  for (const group of groups) group.open = open;
  expand.textContent = open ? "Sbalit vše" : "Rozbalit vše";
});

/* --- Hlášky -------------------------------------------------------------- */

function dismissToast(toast) {
  toast.classList.add("is-leaving");
  setTimeout(() => toast.remove(), 300);
}

for (const toast of document.querySelectorAll("[data-toast]")) {
  if (toast.classList.contains("toast-ok")) setTimeout(() => dismissToast(toast), 4500);
}

document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-toast-close]");
  if (close) dismissToast(close.closest("[data-toast]"));
});

/* --- Obnova, když redakce na něco čeká (Drběna píše fotbal) ---------------- */

// Stránku stáhne na pozadí a vymění jen obsah. Otevřené okno zůstane otevřené (jinak by při každé obnově bliklo)
// a jen dostane nový obsah, když ho server vykreslil jako otevřené. Bez JS se stránka neobnovuje vůbec.
async function softRefresh() {
  const url = currentUrl();
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok || new URL(response.url).pathname !== location.pathname) throw new Error("jinam");
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  const fresh = doc.getElementById("obsah");
  const main = document.getElementById("obsah");
  if (!fresh || !main) throw new Error("bez obsahu");
  if (currentUrl() !== url) return;
  const filters = new Map([...main.querySelectorAll("[data-filter]")].map((box) => [box.dataset.filter, box.value]));
  const kept = new Map([...document.querySelectorAll("dialog[open][id]")].map((dialog) => [dialog.id, dialog]));
  for (const node of [...main.childNodes]) if (!kept.has(node.id)) node.remove();
  for (const node of [...fresh.childNodes]) {
    const dialog = node.id ? kept.get(node.id) : null;
    if (dialog) {
      if (node.hasAttribute("data-autoopen") && !isDirty(dialog)) {
        dialog.querySelector(".modal-body")?.replaceWith(document.importNode(node.querySelector(".modal-body"), true));
        bindForms(dialog);
        dialog.dispatchEvent(new CustomEvent("drbna:mount", { bubbles: true }));
      }
      continue;
    }
    if (node instanceof HTMLDialogElement) {
      node.removeAttribute("open");
      node.removeAttribute("data-autoopen");
    }
    main.append(document.importNode(node, true));
  }
  for (const box of main.querySelectorAll("[data-filter]")) {
    const value = filters.get(box.dataset.filter);
    if (!value) continue;
    box.value = value;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
  bindForms(main);
  main.dispatchEvent(new CustomEvent("drbna:mount", { bubbles: true }));
}

function scheduleRefresh() {
  const holder = document.querySelector("[data-refresh]");
  if (!holder) return;
  setTimeout(async () => {
    const busy = document.querySelector("[data-dirty].is-dirty, dialog[open] form.is-dirty, input[name=ids]:checked");
    if (busy || submitting) return scheduleRefresh();
    try {
      await softRefresh();
    } catch {
      return location.replace(currentUrl());
    }
    scheduleRefresh();
  }, Number(holder.dataset.refresh || 10) * 1000);
}

/* --- Start --------------------------------------------------------------- */

cleanFlashFromUrl();
bindForms(document);
scheduleRefresh();
document.querySelector(".adm-link.is-on")?.scrollIntoView({ block: "nearest", inline: "center" });
const first = document.querySelector("dialog[data-autoopen]");
if (first) openDialog(first);
