// Pomocník při psaní zprávy (src/assist/): pošle nadpis, perex a text na /redakce/pomocnik
// a odpověď vloží zpátky do formuláře. Nic se neukládá, dokud redaktor formulář sám neodešle.

const BUSY = { drbena: "Drběna píše…", ucesat: "Drběna češe text…" };

function fieldsOf(form) {
  const body = form.querySelector("textarea[name='body']");
  return {
    title: form.querySelector("[name='title']"),
    excerpt: form.querySelector("[name='excerpt']"),
    body,
    editor: body?.closest(".rich")?.querySelector("trix-editor")?.editor ?? null,
    rubric: form.querySelector("select[name='rubric_id']"),
    file: form.querySelector("input[type='file'][name='image']"),
  };
}

function stockChoice(form) {
  return form.querySelector("input[name='stock_id']:checked")?.value ?? "";
}

// Fotku navrhne jen ke zprávě, která žádnou nemá a redaktor ji ani nevybral.
function wantsPhoto(form, fields) {
  if (form.querySelector("[data-photo-now]")) return false;
  if (fields.file?.files?.length) return false;
  return !stockChoice(form);
}

function setValue(node, value) {
  if (!node) return;
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

function setBody(fields, html) {
  if (fields.editor) fields.editor.loadHTML(html);
  else setValue(fields.body, html);
}

function setStock(form, id) {
  const radio = form.querySelector(`input[name='stock_id'][value='${CSS.escape(String(id))}']`);
  if (!radio) return false;
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function snapshot(form, fields) {
  return {
    title: fields.title?.value ?? "",
    excerpt: fields.excerpt?.value ?? "",
    body: fields.body?.value ?? "",
    rubric: fields.rubric?.value ?? "",
    stock: stockChoice(form),
  };
}

function restore(form, fields, saved) {
  setValue(fields.title, saved.title);
  setValue(fields.excerpt, saved.excerpt);
  setBody(fields, saved.body);
  if (fields.rubric) setValue(fields.rubric, saved.rubric);
  setStock(form, saved.stock);
}

function say(bar, text, kind = "") {
  const status = bar.querySelector("[data-assist-status]");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-bad", kind === "bad");
  status.classList.toggle("is-ok", kind === "ok");
}

function busy(bar, on) {
  bar.classList.toggle("is-busy", on);
  for (const button of bar.querySelectorAll("button")) button.disabled = on;
}

function summary(fields, answer, stockSet) {
  const parts = ["Hotovo, přečtěte si to a opravte, co je potřeba."];
  const option = fields.rubric?.selectedOptions?.[0];
  if (answer.rubricId && option) parts.push(`Rubrika: ${option.textContent.trim()}.`);
  if (answer.stock && stockSet) parts.push(`Fotka z knihovny: ${answer.stock.topic}.`);
  if (answer.note) parts.push(answer.note);
  if (typeof answer.left === "number") parts.push(answer.left ? `Dnes ještě ${answer.left}×.` : "Na dnešek je to poslední.");
  return parts.join(" ");
}

async function run(bar, mode) {
  const form = bar.closest("form");
  if (!form || bar.classList.contains("is-busy")) return;
  const fields = fieldsOf(form);
  const before = snapshot(form, fields);
  busy(bar, true);
  say(bar, BUSY[mode] ?? BUSY.drbena);
  let answer;
  try {
    const response = await fetch("/redakce/pomocnik", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        title: before.title,
        excerpt: before.excerpt,
        body: before.body,
        rubricId: before.rubric,
        wantsPhoto: wantsPhoto(form, fields),
      }),
    });
    answer = await response.json();
  } catch {
    answer = { ok: false, error: "Spojení se nepovedlo. Zkuste to znovu." };
  }
  busy(bar, false);
  if (!answer?.ok) {
    say(bar, answer?.error || "Něco se nepovedlo. Zkuste to znovu.", "bad");
    return;
  }
  bar.assistBefore = before;
  setValue(fields.title, answer.title);
  setValue(fields.excerpt, answer.excerpt);
  setBody(fields, answer.body);
  if (answer.rubricId && fields.rubric) setValue(fields.rubric, String(answer.rubricId));
  const stockSet = answer.stock ? setStock(form, answer.stock.id) : false;
  const undo = bar.querySelector("[data-assist-undo]");
  if (undo) undo.hidden = false;
  say(bar, summary(fields, answer, stockSet), "ok");
}

function undo(bar) {
  const form = bar.closest("form");
  if (!form || !bar.assistBefore) return;
  restore(form, fieldsOf(form), bar.assistBefore);
  bar.assistBefore = null;
  const button = bar.querySelector("[data-assist-undo]");
  if (button) button.hidden = true;
  say(bar, "Vráceno, jak to bylo.");
}

document.addEventListener("click", (event) => {
  const runButton = event.target.closest?.("[data-assist-run]");
  if (runButton) {
    const bar = runButton.closest("[data-assist]");
    if (bar) run(bar, runButton.dataset.assistRun);
    return;
  }
  const info = event.target.closest?.("[data-assist-info]");
  if (info) {
    const hint = info.closest("[data-assist]")?.querySelector("[data-assist-hint]");
    if (!hint) return;
    hint.hidden = !hint.hidden;
    info.setAttribute("aria-expanded", String(!hint.hidden));
    return;
  }
  const undoButton = event.target.closest?.("[data-assist-undo]");
  if (undoButton) {
    const bar = undoButton.closest("[data-assist]");
    if (bar) undo(bar);
  }
});

// Lišta je bez JS schovaná. Okna načtená na pozadí pošlou drbna:mount.
function boot(root) {
  for (const bar of root.querySelectorAll("[data-assist][hidden]")) bar.hidden = false;
}

document.addEventListener("drbna:mount", (event) => boot(event.target instanceof Element ? event.target : document));
boot(document);
