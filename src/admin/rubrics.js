import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, cancelLink, confirmForm, field, formFoot, hidden, input, item, list, modal, modalLink, openButton, pageHead, panel } from "./ui.js";

const BASE = "/redakce/rubriky";

function storyCount(count) {
  const n = Number(count) || 0;
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return `${n} zpráva`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} zprávy`;
  return `${n} zpráv`;
}

function rubricForm(rubrics, editing) {
  const parents = rubrics.filter((row) => !row.parentId && row.id !== editing?.id);
  const hasChildren = Boolean(editing && rubrics.some((row) => row.parentId === editing.id));
  const nextSort = rubrics.length ? Math.min(999, Math.max(...rubrics.map((row) => row.sortOrder)) + 10) : 10;
  const parentField = hasChildren
    ? `<input type="hidden" name="parentId" value=""><p class="hint">Tahle rubrika má podrubriky, takže zůstává hlavní. Podrubriky nejdřív odeberte, kdybyste ji chtěli zařadit pod jinou.</p>`
    : field(
        "Zařadit pod",
        `<select class="${input}" name="parentId"><option value="">Hlavní rubrika</option>${parents
          .map((row) => `<option value="${row.id}"${editing?.parentId === row.id ? " selected" : ""}>${esc(row.name)}</option>`)
          .join("")}</select>`,
        "Hlavní rubrika je na webu filtrem. Podrubrika patří pod ni, třeba Fotbal pod Sport.",
      );
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${editing ? hidden("id", editing.id) : ""}
    ${field("Název", `<input class="${input}" name="name" required maxlength="40" value="${esc(editing?.name ?? "")}" placeholder="Fotbal">`)}
    ${parentField}
    ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? nextSort}">`, "Menší číslo je výš. Podrubrika se řadí mezi ostatními pod stejnou rubrikou.")}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

export function adminRubrics(ctx, data, message, query = {}) {
  const rubrics = Array.isArray(data.rubrics) ? data.rubrics : [];
  const editing = rubrics.find((row) => row.id === query.editingId) ?? null;
  const removing = editing ? null : (rubrics.find((row) => row.id === query.confirmId) ?? null);
  const renderItem = (row, child) => {
    const parent = child ? rubrics.find((candidate) => candidate.id === row.parentId) : null;
    return item({
      title: row.name,
      meta: `${child ? `Podrubrika${parent ? ` · ${esc(parent.name)}` : ""}` : "Hlavní rubrika"} · ${esc(storyCount(row.articleCount))}`,
      badges: child ? "" : badge(`pořadí ${row.sortOrder}`),
      actions: `${modalLink(`${BASE}?id=${row.id}`, "Upravit")}${modalLink(`${BASE}?smazat=${row.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
      tone: child ? "child" : "",
    });
  };
  const tops = rubrics.filter((row) => !row.parentId);
  const listed = [];
  for (const top of tops) {
    listed.push(renderItem(top, false));
    for (const child of rubrics.filter((row) => row.parentId === top.id)) listed.push(renderItem(child, true));
  }
  for (const orphan of rubrics.filter((row) => row.parentId && !tops.some((top) => top.id === row.parentId))) {
    listed.push(renderItem(orphan, true));
  }
  const dialogs = [
    modal({ id: "nova-rubrika", title: "Nová rubrika", close: BASE, open: Boolean(query.fresh) && !editing && !removing, body: rubricForm(rubrics, null) }),
  ];
  if (editing) dialogs.push(modal({ id: "okno", title: "Upravit rubriku", close: BASE, open: true, body: rubricForm(rubrics, editing) }));
  if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat rubriku",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Smazat rubriku <b>${esc(removing.name)}</b>? Jde to jen u prázdné rubriky bez podrubrik.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  const body = `${pageHead("Rubriky", "Hlavní rubriky jsou na stránce zpráv filtrem. Filtr Sport ukáže i zprávy z podrubrik.", openButton("nova-rubrika", `${BASE}?novy=1`, "Nová rubrika"))}
    ${panel({ id: "rubriky", title: "Rubriky", count: rubrics.length, body: list(listed, "Zatím žádná rubrika.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "rubriky", message, body, { title: "Rubriky" });
}
