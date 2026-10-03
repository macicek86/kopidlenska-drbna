// Sekce Zprávy pro přispěvatele: vlastní návrhy, návrhy úprav a s oprávněním `drbena_navrhy` i schválení článků od Drběny.
import { byline } from "../db.js";
import { rubricLabel } from "../rubrics.js";
import { credit, esc } from "../view.js";
import { articleFields, BASE, proposalKind, reviewForm } from "./article-form.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, confirmForm, formFoot, hidden, item, list, modal, modalLink, openButton, pageHead, panel } from "./ui.js";

function contributorForm(data, { proposal, target, linked }) {
  const editingArticle = Boolean(proposal?.articleId || target);
  const mine = Boolean(linked && linked.authorId === data.user?.id);
  const help = !editingArticle
    ? `Na web to přijde, až to schválí hlavní redaktor. Do té doby to tu můžete měnit. Podepíše se jako ${esc(byline(data.user))}.`
    : mine
      ? "Veřejné znění se nezmění, dokud úpravu neschválí hlavní redaktor."
      : "Cizí zprávu nejde přepsat přímo. Tohle je návrh a rozhodne o něm hlavní redaktor. Autor zůstane ten původní.";
  const source = proposal ?? target;
  const formSource = source
    ? {
        ...source,
        imageKey: source.imageKey || linked?.imageKey || null,
        imageFocus: source.imageFocus || linked?.imageFocus || "",
        imageCaption: source.imageCaption || linked?.imageCaption || "",
      }
    : null;
  const returned =
    proposal?.status === "rejected"
      ? callout(proposal.note ? `<b>Vráceno:</b> ${esc(proposal.note)}` : "Hlavní redaktor návrh vrátil. Upravte ho a pošlete znovu.", "bad")
      : "";
  const submit = proposal ? "Uložit návrh" : target ? "Poslat návrh" : "Poslat ke schválení";
  return `<form class="form" method="post" action="${BASE}/navrh" enctype="multipart/form-data">
    ${returned}
    ${callout(help)}
    ${proposal ? hidden("id", proposal.id) : ""}
    ${target && !proposal ? hidden("clanek", target.id) : ""}
    ${proposal?.articleId ? hidden("clanek", proposal.articleId) : ""}
    ${articleFields(formSource, data)}
    ${formFoot(submit, cancelLink(BASE))}
  </form>`;
}

function contributorHeading(data, proposal, target, linked) {
  const editingArticle = Boolean(proposal?.articleId || target);
  if (!editingArticle) return proposal ? "Váš příspěvek" : "Nový příspěvek";
  return linked && linked.authorId === data.user?.id ? "Úprava vaší zprávy" : "Návrh úpravy";
}

export function contributorArticles(ctx, data, message, query) {
  const fromBot = data.botProposals ?? [];
  const reviewing = fromBot.find((row) => row.id === query.proposalId) ?? null;
  const opened = reviewing ? null : (data.proposals.find((row) => row.id === query.proposalId) ?? null);
  const target = data.articles.find((row) => row.id === query.targetId) ?? null;
  const existingForTarget = target ? (data.proposals.find((row) => row.articleId === target.id) ?? null) : null;
  const proposal = opened ?? existingForTarget;
  const linked = data.articles.find((row) => row.id === (proposal?.articleId ?? target?.id)) ?? null;
  const withdrawing = data.proposals.find((row) => row.id === query.withdrawId) ?? null;

  const own = data.proposals.map((row) =>
    item({
      title: row.title,
      meta: `${proposalKind(row)}${row.note ? ` · ${esc(row.note)}` : ""}`,
      badges: row.status === "rejected" ? badge("Vráceno", "bad") : badge("Čeká na schválení", "warn"),
      actions: `${modalLink(`${BASE}?navrh=${row.id}`, "Upravit")}${modalLink(`${BASE}?stahnout=${row.id}`, "Stáhnout", "btn-ghost btn-danger-text")}`,
      tone: row.status === "rejected" ? "bad" : "",
    }),
  );
  const botQueue = fromBot.map((row) =>
    item({
      title: row.title,
      meta: [esc(rubricLabel(row)), esc(credit(row))].filter(Boolean).join(" · "),
      badges: badge("Čeká", "warn"),
      actions: modalLink(`${BASE}?navrh=${row.id}`, "Posoudit", "btn-primary"),
      tone: "warn",
    }),
  );
  const published = data.articles.map((row) => {
    const mine = row.authorId === data.user?.id;
    const open = data.proposals.find((candidate) => candidate.articleId === row.id);
    const href = open ? `${BASE}?navrh=${open.id}` : `${BASE}?clanek=${row.id}`;
    return item({
      title: row.title,
      meta: [esc(rubricLabel(row)), esc(credit(row))].filter(Boolean).join(" · "),
      badges: `${mine ? badge("Vaše", "ok") : ""}${open ? badge("Úprava čeká", "warn") : ""}`,
      actions: modalLink(href, mine ? "Upravit" : "Navrhnout úpravu"),
    });
  });

  const dialogs = [
    modal({
      id: "novy-prispevek",
      title: "Nový příspěvek",
      size: "wide",
      close: BASE,
      open: Boolean(query.fresh) && !reviewing && !proposal && !target && !withdrawing,
      body: contributorForm(data, {}),
    }),
  ];
  if (reviewing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Schválit článek od Drběny",
        size: "wide",
        close: BASE,
        open: true,
        body: reviewForm(data, reviewing, { chief: false }),
      }),
    );
  } else if (proposal || target) {
    dialogs.push(
      modal({
        id: "okno",
        title: contributorHeading(data, proposal, target, linked),
        size: "wide",
        close: BASE,
        open: true,
        body: contributorForm(data, { proposal, target: proposal ? null : target, linked }),
      }),
    );
  } else if (withdrawing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Stáhnout návrh",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/stahnout`,
          id: withdrawing.id,
          text: `Návrh <b>${esc(withdrawing.title)}</b> zmizí a hlavní redaktor ho už neuvidí.`,
          submit: "Opravdu stáhnout",
          close: BASE,
        }),
      }),
    );
  }

  const body = `${pageHead("Zprávy", "Napište příspěvek nebo navrhněte úpravu. Na web jde, až to schválí hlavní redaktor.", openButton("novy-prispevek", `${BASE}?novy=1`, "Nový příspěvek"))}
    ${botQueue.length ? panel({ id: "od-drbeny", title: "Od Drběny ke schválení", count: botQueue.length, body: list(botQueue, ""), tone: "warn" }) : ""}
    ${panel({ id: "moje-navrhy", title: "Moje návrhy", count: own.length, body: list(own, "Zatím tu nic nečeká.") })}
    ${panel({ id: "na-webu", title: "Zprávy na webu", count: published.length, filter: "Hledat ve zprávách…", body: list(published, "Na webu zatím nic není.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "zpravy", message, body, { rich: true, title: "Zprávy" });
}
