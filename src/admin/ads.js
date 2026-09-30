import { PANEL_BYTES, PANEL_EDGE } from "../ads.js";
import { byline } from "../db.js";
import { adPanel, credit, esc } from "../view.js";
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
  postButton,
} from "./ui.js";

const BASE = "/redakce/reklamy";

function adDraft(source, user, sample) {
  return {
    title: source?.title ?? "",
    body: source?.body ?? "",
    place: source?.place ?? "",
    link: source?.link ?? "",
    imageKey: source?.imageKey ?? null,
    sample: Boolean(sample && source?.sample),
    slug: "",
    createdOn: source?.createdOn ?? "",
    authorName: source?.authorName ?? user?.name ?? "",
    authorAlias: source?.authorAlias ?? user?.alias ?? "",
    enabled: source ? Boolean(source.enabled) : true,
  };
}

function adEditorForm(ctx, { action, help, banner = "", hiddenFields = "", draft, submit, aside = "", after = "" }) {
  return `<form class="ad-editor form" data-ad-form method="post" action="${action}" enctype="multipart/form-data">
      <div class="ad-fields">
        ${banner}
        ${callout(help)}
        ${hiddenFields}
        ${field("Název", `<input class="${input}" name="title" required maxlength="80" value="${esc(draft.title)}">`)}
        ${field("Text", `<textarea class="${input}" name="body" required maxlength="320" rows="4" data-count>${esc(draft.body)}</textarea>`)}
        <div class="pair">
          ${field("Místo", `<input class="${input}" name="place" maxlength="80" value="${esc(draft.place)}" placeholder="třeba Mlýnec">`)}
          ${field("Odkaz", `<input class="${input}" name="link" maxlength="240" value="${esc(draft.link)}" placeholder="https://… nebo /cesta" inputmode="url">`)}
        </div>
        <span class="hint">Odkaz je volitelný. Na panelu se ukáže jako Víc. Adresa začíná na https://, http://, mailto: nebo /.</span>
        ${field(
          "Fotka",
          `<input class="${input}" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" data-edge="${PANEL_EDGE}" data-bytes="${PANEL_BYTES}">`,
          `Volitelná. Před odesláním se v prohlížeči zmenší a uloží jako WEBP. Delší strana nejvýš ${PANEL_EDGE} px.${draft.imageKey ? " Nová fotka nahradí tu současnou." : ""}`,
        )}
        ${check("enabled", "1", draft.enabled, "Zobrazovat na webu")}
      </div>
      <div class="ad-stage">
        <p class="stage-label">Náhled na webu</p>
        ${adPanel(draft, ctx.copy, { preview: true })}
        <p class="hint" data-ad="link-note"${draft.link ? "" : " hidden"}>${esc(draft.link)}</p>
        <p class="hint" data-ad="off"${draft.enabled ? " hidden" : ""}>Tahle nabídka je vypnutá a na webu se neukáže.</p>
      </div>
      ${formFoot(submit, aside)}
    </form>${after}`;
}

function adProposalKind(row) {
  return row.adId ? "Úprava nabídky" : "Nová nabídka";
}

function liveAdItems(ads, data, { chief }) {
  const manageable = (ad) => chief || ad.authorId === data.user?.id;
  return ads.map((row) => {
    const own = manageable(row);
    const waiting = (data.adProposals ?? []).some((proposal) => proposal.adId === row.id && proposal.status === "pending");
    const actions = own
      ? `${modalLink(`${BASE}?id=${row.id}`, "Upravit")}
         ${postButton(`${BASE}/stav`, { id: row.id, enabled: row.enabled ? "0" : "1" }, row.enabled ? "Vypnout" : "Zapnout", "btn-ghost")}
         ${modalLink(`${BASE}?smazat=${row.id}`, "Smazat", "btn-ghost btn-danger-text")}`
      : "";
    return item({
      title: row.title,
      meta: [esc(row.body)].concat(row.place ? [esc(row.place)] : []).concat(credit(row) ? [esc(credit(row))] : []).join(" · "),
      badges: `${row.enabled ? badge("Zapnutá", "ok") : badge("Vypnutá", "off")}${row.sample ? badge("Ukázka") : ""}${waiting ? badge("Úprava čeká", "warn") : ""}`,
      actions,
    });
  });
}

function deleteDialog(removing) {
  return modal({
    id: "okno",
    title: "Smazat nabídku",
    close: BASE,
    open: true,
    body: confirmForm({
      action: `${BASE}/smazat`,
      id: removing.id,
      text: `Nabídka <b>${esc(removing.title)}</b> zmizí z webu. Když ji chcete jen schovat, stačí ji vypnout.`,
      submit: "Smazat",
      close: BASE,
    }),
  });
}

function chiefAds(ctx, data, message, query) {
  const ads = data.ads ?? [];
  const proposals = data.adProposals ?? [];
  const proposal = proposals.find((row) => row.id === query.proposalId) ?? null;
  const editing = proposal ? null : (ads.find((row) => row.id === query.editingId) ?? null);
  const removing = proposal || editing ? null : (ads.find((row) => row.id === query.confirmId) ?? null);

  const dialogs = [
    modal({
      id: "nova-nabidka",
      title: "Nová nabídka",
      size: "wide",
      close: BASE,
      open: Boolean(query.fresh) && !proposal && !editing && !removing,
      body: adEditorForm(ctx, {
        action: `${BASE}/ulozit`,
        help: `Jde na web hned a podepíše se jako ${esc(byline(data.user) || "Redakce")}. Návrh přispěvatele schvalujete vy.`,
        draft: adDraft(null, data.user, true),
        submit: "Uložit",
        aside: cancelLink(BASE),
      }),
    }),
  ];
  if (editing) {
    const draft = adDraft(editing, data.user, true);
    dialogs.push(
      modal({
        id: "okno",
        title: "Upravit nabídku",
        size: "wide",
        close: BASE,
        open: true,
        body: adEditorForm(ctx, {
          action: `${BASE}/ulozit`,
          help: "Úprava jde na web hned. Vypnout jde v seznamu zvlášť, text se tím nemění.",
          hiddenFields: hidden("id", editing.id),
          draft,
          submit: "Uložit",
          aside: cancelLink(BASE),
        }),
      }),
    );
  }
  if (proposal) {
    dialogs.push(
      modal({
        id: "okno",
        title: proposal.adId ? "Schválit úpravu" : "Schválit nabídku",
        size: "wide",
        close: BASE,
        open: true,
        body: adEditorForm(ctx, {
          action: `${BASE}/schvalit`,
          help: proposal.adId
            ? `Autor na webu: ${esc(credit(proposal))}. Text můžete před schválením upravit. Veřejné znění se změní, až úpravu schválíte.`
            : `Autor na webu: ${esc(credit(proposal))}. Text můžete před schválením upravit. Na web přijde, až ji schválíte.`,
          hiddenFields: hidden("id", proposal.id),
          draft: adDraft(proposal, proposal, false),
          submit: "Schválit a zveřejnit",
          aside: `<button class="btn btn-line" type="button" data-toggle="vratit-nabidku-${proposal.id}">Vrátit autorovi…</button>`,
          after: `<form class="form return-form" id="vratit-nabidku-${proposal.id}" method="post" action="${BASE}/vratit" data-toggled>
            ${hidden("id", proposal.id)}
            ${field("Poznámka pro autora", `<textarea class="${input}" name="note" maxlength="400" rows="3" placeholder="Co má dopracovat. Může zůstat prázdné."></textarea>`)}
            <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-line" type="submit">Vrátit</button></div>
          </form>`,
        }),
      }),
    );
  }
  if (removing) dialogs.push(deleteDialog(removing));

  const queue = proposals.map((row) =>
    item({
      title: row.title,
      meta: `${adProposalKind(row)} · ${esc(credit(row))}${row.adTitle ? ` · k nabídce ${esc(row.adTitle)}` : ""}`,
      badges: badge("Čeká", "warn"),
      actions: modalLink(`${BASE}?navrh=${row.id}`, "Posoudit", "btn-primary"),
      tone: "warn",
    }),
  );
  const body = `${pageHead(
    "Reklamy",
    "Místní nabídky na panelu mezi zprávami. Každou jde vypnout zvlášť, text se tím nemění.",
    openButton("nova-nabidka", `${BASE}?novy=1`, "Nová nabídka"),
  )}
    ${queue.length ? panel({ id: "ke-schvaleni", title: "Ke schválení", count: queue.length, body: list(queue, ""), tone: "warn" }) : ""}
    ${panel({ id: "nabidky", title: "Nabídky", count: ads.length, filter: "Hledat v nabídkách…", body: list(liveAdItems(ads, data, { chief: true }), "Zatím žádná nabídka.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "reklamy", message, body, { title: "Reklamy" });
}

function contributorAds(ctx, data, message, query) {
  const ads = data.ads ?? [];
  const proposals = data.adProposals ?? [];
  const opened = proposals.find((row) => row.id === query.proposalId) ?? null;
  const target = ads.find((row) => row.id === query.editingId && row.authorId === data.user?.id) ?? null;
  const existingForTarget = target ? (proposals.find((row) => row.adId === target.id) ?? null) : null;
  const proposal = opened ?? existingForTarget;
  const withdrawing = proposals.find((row) => row.id === query.withdrawId) ?? null;
  const removing = ads.find((row) => row.id === query.confirmId && row.authorId === data.user?.id) ?? null;

  const editorFor = (source) => {
    const draft = adDraft(source.proposal ?? source.target, data.user, false);
    if (!source.proposal && source.target?.imageKey) draft.imageKey = source.target.imageKey;
    const editingAd = Boolean(source.proposal?.adId || source.target);
    const returned =
      source.proposal?.status === "rejected"
        ? callout(source.proposal.note ? `<b>Vráceno:</b> ${esc(source.proposal.note)}` : "Hlavní redaktor návrh vrátil. Upravte ho a pošlete znovu.", "bad")
        : "";
    return adEditorForm(ctx, {
      action: `${BASE}/navrh`,
      help: editingAd
        ? "Veřejné znění se nezmění, dokud úpravu neschválí hlavní redaktor. Vypnout už zveřejněnou nabídku jde v seznamu hned."
        : `Na web to přijde, až to schválí hlavní redaktor. Do té doby to tu můžete měnit. Podepíše se jako ${esc(byline(data.user) || "Redakce")}.`,
      banner: returned,
      hiddenFields: `${source.proposal ? hidden("id", source.proposal.id) : ""}${source.target && !source.proposal ? hidden("nabidka", source.target.id) : ""}`,
      draft,
      submit: source.proposal ? "Uložit návrh" : source.target ? "Poslat návrh" : "Poslat ke schválení",
      aside: cancelLink(BASE),
    });
  };

  const dialogs = [
    modal({
      id: "nova-nabidka",
      title: "Nová nabídka",
      size: "wide",
      close: BASE,
      open: Boolean(query.fresh) && !proposal && !target && !withdrawing && !removing,
      body: editorFor({}),
    }),
  ];
  if (proposal || target) {
    dialogs.push(
      modal({
        id: "okno",
        title: proposal?.adId || target ? "Úprava vaší nabídky" : "Váš návrh",
        size: "wide",
        close: BASE,
        open: true,
        body: editorFor({ proposal, target }),
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
  } else if (removing) {
    dialogs.push(deleteDialog(removing));
  }

  const own = proposals.map((row) =>
    item({
      title: row.title,
      meta: `${adProposalKind(row)}${row.note ? ` · ${esc(row.note)}` : ""}`,
      badges: row.status === "rejected" ? badge("Vráceno", "bad") : badge("Čeká na schválení", "warn"),
      actions: `${modalLink(`${BASE}?navrh=${row.id}`, "Upravit")}${modalLink(`${BASE}?stahnout=${row.id}`, "Stáhnout", "btn-ghost btn-danger-text")}`,
      tone: row.status === "rejected" ? "bad" : "",
    }),
  );
  const body = `${pageHead("Reklamy", "Nabídku může navrhnout každý přihlášený. Na web přijde, až ji schválí hlavní redaktor.", openButton("nova-nabidka", `${BASE}?novy=1`, "Nová nabídka"))}
    ${panel({ id: "moje-navrhy", title: "Moje návrhy", count: own.length, body: list(own, "Zatím tu nic nečeká.") })}
    ${panel({ id: "nabidky", title: "Nabídky na webu", count: ads.length, filter: "Hledat v nabídkách…", body: list(liveAdItems(ads, data, { chief: false }), "Zatím žádná nabídka.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "reklamy", message, body, { title: "Reklamy" });
}

export function adminAds(ctx, data, message, query = {}) {
  if (data.user?.role === "hlavni") return chiefAds(ctx, data, message, query);
  return contributorAds(ctx, data, message, query);
}
