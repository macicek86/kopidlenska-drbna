import { byline } from "../db.js";
import { formatLong } from "../format.js";
import { readFocus } from "../photo.js";
import { prepareArticleBody } from "../rich.js";
import { rubricLabel, rubricsFrom } from "../rubrics.js";
import { credit, esc, mediaUrl } from "../view.js";
import { adminShell } from "./shell.js";
import {
  badge,
  callout,
  cancelLink,
  check,
  confirmForm,
  field,
  formFoot,
  hidden,
  input,
  item,
  list,
  modal,
  modalLink,
  openButton,
  pageHead,
  panel,
} from "./ui.js";

const BASE = "/redakce/zpravy";

function rubricChosen(rubric, source, list) {
  if (source?.rubricId) return rubric.id === Number(source.rubricId);
  if (source?.category) return rubric.name === source.category;
  const first = list.find((row) => !row.parentId);
  return first?.id === rubric.id;
}

export function rubricOptions(rubrics, source) {
  const all = Array.isArray(rubrics) ? rubrics : rubricsFrom({});
  const parts = [];
  for (const top of all.filter((row) => !row.parentId)) {
    const children = all.filter((row) => row.parentId === top.id);
    const topOption = `<option value="${top.id}"${rubricChosen(top, source, all) ? " selected" : ""}>${esc(top.name)}</option>`;
    if (!children.length) {
      parts.push(topOption);
      continue;
    }
    parts.push(`<optgroup label="${esc(top.name)}">`, topOption);
    for (const child of children) {
      parts.push(`<option value="${child.id}"${rubricChosen(child, source, all) ? " selected" : ""}>${esc(child.name)}</option>`);
    }
    parts.push("</optgroup>");
  }
  return parts.join("");
}

export function photoControl(source) {
  const current = source?.imageKey ? mediaUrl(source.imageKey) : "";
  const now = current
    ? `<figure class="photo-now" data-photo-now><img src="${current}" alt=""><figcaption>Současná fotka. Nová ji nahradí.</figcaption></figure>`
    : "";
  return `<div class="field photo-field" data-photo${current ? ` data-current="${esc(current)}"` : ""}>
    <span>Fotka</span>
    ${now}
    <input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">
    <span class="hint">Před odesláním se v prohlížeči zmenší. Stačí fotka z mobilu.</span>
    <input type="hidden" name="image_focus" value="${esc(readFocus(source?.imageFocus))}" data-photo-focus>
    <div class="photo-pick" data-photo-pick hidden>
      <p class="photo-pick-title">Ťukněte na to, co má být vidět</p>
      <div class="photo-pick-full" data-photo-full tabindex="0" role="button" aria-label="Místo, které má zůstat vidět. Posunete ho i šipkami.">
        <img alt="" data-photo-src>
        <span class="photo-dot" data-photo-dot></span>
      </div>
      <div class="photo-pick-previews">
        <figure><div class="photo-crop photo-crop-list"><img alt="" data-photo-src data-photo-crop></div><figcaption>Přehled zpráv</figcaption></figure>
        <figure><div class="photo-crop photo-crop-wide"><img alt="" data-photo-src data-photo-crop></div><figcaption>Mobil a titulka</figcaption></figure>
      </div>
      <p class="hint">Ve zprávě samotné bude fotka vidět celá.</p>
    </div>
  </div>
  ${field(
    "Popisek fotky",
    `<input class="${input}" name="image_caption" maxlength="200" value="${esc(source?.imageCaption ?? "")}" placeholder="Foto: Jana Nováková">`,
    "Nepovinné. Kdo fotil nebo co je na fotce. Ukáže se pod fotkou ve zprávě.",
  )}`;
}

function richTextField(body) {
  const html = prepareArticleBody(body).html;
  return `<div class="field field-rich"><span>Text</span>
    <div class="rich">
      <textarea class="control" name="body" maxlength="20000" rows="12" hidden>${esc(html)}</textarea>
    </div>
    <span class="hint">Nadpisy, seznamy, tučné, kurzíva, podtržení, citace a odkazy. Adresa začíná na https://, http://, mailto: nebo /.</span>
  </div>`;
}

function articleFields(source, rubrics, { publish } = {}) {
  return `<div class="form-cols">
    <div class="form-col-main">
      ${field("Nadpis", `<input class="${input} control-lg" name="title" required maxlength="160" value="${esc(source?.title ?? "")}">`)}
      ${field("Perex", `<textarea class="${input}" name="excerpt" required maxlength="320" rows="3" data-count>${esc(source?.excerpt ?? "")}</textarea>`, "Krátké shrnutí do přehledu zpráv. Nejvýš 320 znaků.")}
      ${richTextField(source?.body ?? "")}
    </div>
    <div class="form-col-side">
      ${field("Rubrika", `<select class="${input}" name="rubric_id">${rubricOptions(rubrics, source)}</select>`, "Podrubrika je pod svou rubrikou, třeba Fotbal pod Sportem.")}
      ${photoControl(source)}
      ${publish ? `<div class="field"><span>Viditelnost</span>${check("published", "1", publish.checked, "Zveřejnit na webu")}</div>` : ""}
    </div>
  </div>`;
}

function proposalKind(proposal) {
  return proposal.articleId ? "Návrh úpravy" : "Nový příspěvek";
}

function articleForm(data, editing, close) {
  const help = !editing
    ? `Jde na web hned a podepíše se jako ${esc(byline(data.user) || "Redakce")}.`
    : credit(editing) && editing.authorId !== data.user?.id
      ? `Autor zůstává ${esc(credit(editing))}. Když změníte text, na webu se objeví nanejvýš slovo Redigováno.`
      : "Úprava jde na web hned.";
  return `<form class="form" method="post" action="${BASE}/ulozit" enctype="multipart/form-data">
    ${callout(help)}
    ${editing ? hidden("id", editing.id) : ""}
    ${articleFields(editing, data.rubrics, { publish: { checked: editing ? editing.published : true } })}
    ${formFoot("Uložit", cancelLink(close))}
  </form>`;
}

function reviewForm(data, proposal) {
  return `<form class="form" method="post" action="${BASE}/schvalit" enctype="multipart/form-data">
      ${callout(`Autor na webu: <b>${esc(credit(proposal))}</b>. Text můžete před schválením upravit, typicky češtinu. Ven se neukáže, co se měnilo. Když se znění liší od návrhu, u autora bude nanejvýš slovo Redigováno.${
        proposal.articleTitle ? `<br>Ke zprávě: <b>${esc(proposal.articleTitle)}</b>` : ""
      }`)}
      ${hidden("id", proposal.id)}
      ${articleFields(proposal, data.rubrics)}
      ${formFoot("Schválit a zveřejnit", `<button class="btn btn-line" type="button" data-toggle="vratit-${proposal.id}">Vrátit autorovi…</button>`)}
    </form>
    <form class="form return-form" id="vratit-${proposal.id}" method="post" action="${BASE}/vratit" data-toggled>
      ${hidden("id", proposal.id)}
      ${field("Poznámka pro autora", `<textarea class="${input}" name="note" maxlength="400" rows="3" placeholder="Co má dopracovat. Může zůstat prázdné."></textarea>`)}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-line" type="submit">Vrátit</button></div>
    </form>`;
}

function chiefArticles(ctx, data, message, query) {
  const proposal = data.proposals.find((row) => row.id === query.proposalId) ?? null;
  const editing = proposal ? null : (data.articles.find((row) => row.id === query.editingId) ?? null);
  const removing = data.articles.find((row) => row.id === query.confirmId) ?? null;
  const pending = data.proposals.filter((row) => row.status === "pending");

  const queue = pending.map((row) =>
    item({
      title: row.title,
      meta: `${proposalKind(row)} · ${esc(credit(row))}${row.articleTitle ? ` · ke zprávě ${esc(row.articleTitle)}` : ""}`,
      badges: badge("Čeká", "warn"),
      actions: modalLink(`${BASE}?navrh=${row.id}`, "Posoudit", "btn-primary"),
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
      open: Boolean(query.fresh) && !proposal && !editing && !removing,
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
  if (removing && !editing && !proposal) {
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
    ${articleFields(formSource, data.rubrics)}
    ${formFoot(submit, cancelLink(BASE))}
  </form>`;
}

function contributorHeading(data, proposal, target, linked) {
  const editingArticle = Boolean(proposal?.articleId || target);
  if (!editingArticle) return proposal ? "Váš příspěvek" : "Nový příspěvek";
  return linked && linked.authorId === data.user?.id ? "Úprava vaší zprávy" : "Návrh úpravy";
}

function contributorArticles(ctx, data, message, query) {
  const opened = data.proposals.find((row) => row.id === query.proposalId) ?? null;
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
      open: Boolean(query.fresh) && !proposal && !target && !withdrawing,
      body: contributorForm(data, {}),
    }),
  ];
  if (proposal || target) {
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
    ${panel({ id: "moje-navrhy", title: "Moje návrhy", count: own.length, body: list(own, "Zatím tu nic nečeká.") })}
    ${panel({ id: "na-webu", title: "Zprávy na webu", count: published.length, filter: "Hledat ve zprávách…", body: list(published, "Na webu zatím nic není.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "zpravy", message, body, { rich: true, title: "Zprávy" });
}

export function adminArticles(ctx, data, message, query = {}) {
  if (data.user?.role === "hlavni") return chiefArticles(ctx, data, message, query);
  return contributorArticles(ctx, data, message, query);
}
