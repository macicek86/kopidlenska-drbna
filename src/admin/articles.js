// Sekce Zprávy: hlavní redaktor píše zprávy a schvaluje návrhy, přispěvatel viz `articles-contributor.js`.
import { byline } from "../db.js";
import { formatLong } from "../format.js";
import { rubricLabel } from "../rubrics.js";
import { credit, esc } from "../view.js";
import { articleFields, BASE, proposalKind, reviewForm } from "./article-form.js";
import { contributorArticles } from "./articles-contributor.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, confirmForm, formFoot, hidden, item, list, modal, modalLink, openButton, pageHead, panel } from "./ui.js";

function articleForm(data, editing, close) {
  const help = !editing
    ? `Jde na web hned a podepíše se jako ${esc(byline(data.user) || "Redakce")}.`
    : credit(editing) && editing.authorId !== data.user?.id
      ? `Autor zůstává ${esc(credit(editing))}. Když změníte text, na webu se objeví nanejvýš slovo Redigováno.`
      : "Úprava jde na web hned.";
  return `<form class="form" method="post" action="${BASE}/ulozit" enctype="multipart/form-data">
    ${callout(help)}
    ${editing ? hidden("id", editing.id) : ""}
    ${articleFields(editing, data, { publish: { checked: editing ? editing.published : true } })}
    ${formFoot("Uložit", cancelLink(close))}
  </form>`;
}

function chiefArticles(ctx, data, message, query) {
  const proposal = data.proposals.find((row) => row.id === query.proposalId) ?? null;
  const editing = proposal ? null : (data.articles.find((row) => row.id === query.editingId) ?? null);
  const removing = data.articles.find((row) => row.id === query.confirmId) ?? null;
  const discarding = data.proposals.find((row) => row.id === query.discardId) ?? null;
  const pending = data.proposals.filter((row) => row.status === "pending");

  const queue = pending.map((row) =>
    item({
      title: row.title,
      meta: `${proposalKind(row)} · ${esc(credit(row))}${row.articleTitle ? ` · ke zprávě ${esc(row.articleTitle)}` : ""}`,
      badges: badge("Čeká", "warn"),
      actions: `${modalLink(`${BASE}?navrh=${row.id}`, "Posoudit", "btn-primary")}
        ${modalLink(`${BASE}?smazat-navrh=${row.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
      tone: "warn",
    }),
  );
  const rows = data.articles.map((row) =>
    item({
      title: row.title,
      meta: [esc(rubricLabel(row)), esc(credit(row)), row.createdOn ? esc(formatLong(row.createdOn)) : ""].filter(Boolean).join(" · "),
      badges: `${row.published ? badge("Na webu", "ok") : badge("Skrytá", "off")}${row.redacted ? badge("Redigováno") : ""}`,
      actions: `${modalLink(`${BASE}?id=${row.id}`, "Upravit")}
        ${row.published && row.slug ? `<a class="btn btn-sm btn-ghost" href="/zpravy/${esc(row.slug)}" target="_blank" rel="noopener">Zobrazit</a>` : ""}
        ${modalLink(`${BASE}?smazat=${row.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
    }),
  );

  const dialogs = [
    modal({
      id: "nova-zprava",
      title: "Nová zpráva",
      size: "wide",
      close: BASE,
      open: Boolean(query.fresh) && !proposal && !editing && !removing && !discarding,
      body: articleForm(data, null, BASE),
    }),
  ];
  if (editing) dialogs.push(modal({ id: "okno", title: "Upravit zprávu", size: "wide", close: BASE, open: true, body: articleForm(data, editing, BASE) }));
  if (proposal) {
    dialogs.push(
      modal({
        id: "okno",
        title: proposal.articleId ? "Schválit úpravu" : "Schválit příspěvek",
        size: "wide",
        close: BASE,
        open: true,
        body: reviewForm(data, proposal),
      }),
    );
  }
  if (discarding && !editing && !proposal) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat návrh",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat-navrh`,
          id: discarding.id,
          text: `Návrh <b>${esc(discarding.title)}</b> zmizí. Na web nepůjde a autor ho už neuvidí ani jako vrácený. Vrátit to nejde.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  if (removing && !editing && !proposal && !discarding) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat zprávu",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Zpráva <b>${esc(removing.title)}</b> zmizí z webu i z redakce. Vrátit to nejde.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }

  const body = `${pageHead("Zprávy", "Co vyjde na webu. Vaše zpráva jde ven hned, příspěvky ostatních čekají na schválení.", openButton("nova-zprava", `${BASE}?novy=1`, "Nová zpráva"))}
    ${queue.length ? panel({ id: "ke-schvaleni", title: "Ke schválení", count: queue.length, body: list(queue, ""), tone: "warn" }) : ""}
    ${panel({ id: "zpravy", title: "Všechny zprávy", count: rows.length, filter: "Hledat ve zprávách…", body: list(rows, "Zatím žádná zpráva. Začněte tlačítkem Nová zpráva.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "zpravy", message, body, { rich: true, title: "Zprávy" });
}

export function adminArticles(ctx, data, message, query = {}) {
  if (data.user?.role === "hlavni") return chiefArticles(ctx, data, message, query);
  return contributorArticles(ctx, data, message, query);
}
