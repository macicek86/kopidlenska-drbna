import { userCan } from "../db.js";
import { formatLong } from "../format.js";
import { credit, esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, icon, item, list, modalLink, pageHead, panel } from "./ui.js";

function stat(href, glyph, value, label, tone = "") {
  return `<a class="stat${tone ? ` stat-${tone}` : ""}" href="${href}">${icon(glyph)}<b>${esc(value)}</b><span>${esc(label)}</span></a>`;
}

function quick(href, label) {
  return `<a class="btn btn-line" href="${href}">${icon("plus")}<span>${esc(label)}</span></a>`;
}

export function adminOverview(ctx, data, message) {
  const chief = data.user?.role === "hlavni";
  const today = data.waste?.today ?? "";
  const pending = (data.proposals ?? []).filter((row) => row.status === "pending");
  const adPending = (data.adProposals ?? []).filter((row) => row.status === "pending");
  const returned = (data.proposals ?? []).filter((row) => row.status === "rejected");
  const adReturned = (data.adProposals ?? []).filter((row) => row.status === "rejected");
  const upcoming = (data.events ?? []).filter((row) => !today || row.startsOn >= today);
  const hiddenArticles = (data.articles ?? []).filter((row) => !row.published).length;
  const closures = (data.yards ?? []).flatMap((yard) => yard.closures.map((closure) => ({ yard, closure })));
  const changes = (data.doctors ?? []).flatMap((doctor) => doctor.changes.map((change) => ({ doctor, change })));

  const first = (data.user?.name ?? "").split(" ")[0];
  const stats = chief
    ? [
        stat("/redakce/zpravy", "news", pending.length + adPending.length, "čeká na schválení", pending.length + adPending.length ? "warn" : ""),
        stat("/redakce/zpravy", "news", (data.articles ?? []).length, hiddenArticles ? `zpráv, ${hiddenArticles} skrytých` : "zpráv na webu"),
        stat("/redakce/akce", "calendar", upcoming.length, "chystaných akcí"),
        stat("/redakce/odstavky", "bolt", data.outages?.items?.length ?? 0, "odstávek v přehledu"),
      ]
    : [
        stat("/redakce/zpravy", "news", pending.length + adPending.length, "návrhů čeká"),
        stat("/redakce/zpravy", "x", returned.length + adReturned.length, "vráceno k úpravě", returned.length + adReturned.length ? "bad" : ""),
        stat("/redakce/zpravy", "news", (data.articles ?? []).filter((row) => row.authorId === data.user?.id).length, "mých zpráv na webu"),
      ];

  const queueItems = chief
    ? [
        ...pending.map((row) =>
          item({
            title: row.title,
            meta: `${row.articleId ? "Návrh úpravy zprávy" : "Nový příspěvek"} · ${esc(credit(row))}`,
            badges: badge("Zpráva"),
            actions: modalLink(`/redakce/zpravy?navrh=${row.id}`, "Posoudit", "btn-primary"),
          }),
        ),
        ...adPending.map((row) =>
          item({
            title: row.title,
            meta: `${row.adId ? "Úprava nabídky" : "Nová nabídka"} · ${esc(credit(row))}`,
            badges: badge("Reklama"),
            actions: modalLink(`/redakce/reklamy?navrh=${row.id}`, "Posoudit", "btn-primary"),
          }),
        ),
      ]
    : [
        ...(data.proposals ?? []).map((row) =>
          item({
            title: row.title,
            meta: row.note ? esc(row.note) : row.articleId ? "Návrh úpravy zprávy" : "Nový příspěvek",
            badges: row.status === "rejected" ? badge("Vráceno", "bad") : badge("Čeká", "warn"),
            actions: modalLink(`/redakce/zpravy?navrh=${row.id}`, "Otevřít"),
          }),
        ),
        ...(data.adProposals ?? []).map((row) =>
          item({
            title: row.title,
            meta: row.note ? esc(row.note) : "Nabídka",
            badges: row.status === "rejected" ? badge("Vráceno", "bad") : badge("Čeká", "warn"),
            actions: modalLink(`/redakce/reklamy?navrh=${row.id}`, "Otevřít"),
          }),
        ),
      ];

  const soon = [
    ...upcoming.slice(0, 5).map((row) =>
      item({ title: row.title, meta: `${esc(formatLong(row.startsOn))}${row.startsTime ? ` v ${esc(row.startsTime)}` : ""} · ${esc(row.place)}`, badges: badge("Akce") }),
    ),
    ...closures.map(({ yard, closure }) =>
      item({ title: yard.name, meta: `${esc(formatLong(closure.startsOn))}${closure.endsOn !== closure.startsOn ? ` – ${esc(formatLong(closure.endsOn))}` : ""} · ${esc(closure.reason)}`, badges: badge("Uzavření dvora", "warn") }),
    ),
    ...changes.map(({ doctor, change }) =>
      item({ title: doctor.name, meta: `${esc(formatLong(change.startsOn))}${change.endsOn !== change.startsOn ? ` – ${esc(formatLong(change.endsOn))}` : ""} · ${esc(change.note)}`, badges: badge("Změna u lékaře", "warn") }),
    ),
  ];

  const actions = [
    quick("/redakce/zpravy?novy=1", chief ? "Nová zpráva" : "Nový příspěvek"),
    chief ? quick("/redakce/akce?novy=1", "Nová akce") : "",
    quick("/redakce/reklamy?novy=1", "Nová nabídka"),
    userCan(data.user, "sberny_dvur") || chief ? `<a class="btn btn-line" href="/redakce/dvory">${icon("recycle")}<span>Uzavření dvora</span></a>` : "",
  ].join("");

  const fresh = data.newMessages ?? 0;
  const messages = fresh
    ? callout(`Drběna vám z chatu předala ${fresh === 1 ? "1 nový vzkaz" : fresh < 5 ? `${fresh} nové vzkazy` : `${fresh} nových vzkazů`}. <a href="/redakce/vzkazy">Přečíst</a>`, "warn")
    : "";

  const body = `${pageHead(first ? `Ahoj, ${first}` : "Přehled", chief ? "Co čeká na vás a co se chystá." : "Vaše návrhy a co se chystá.")}
    ${messages}
    <div class="stats">${stats.join("")}</div>
    <div class="quick">${actions}</div>
    <div class="cards-2">
      ${panel({ id: "fronta", title: chief ? "Ke schválení" : "Moje návrhy", count: queueItems.length, body: list(queueItems, chief ? "Nic nečeká. Hezký den." : "Nemáte žádný rozpracovaný návrh."), tone: queueItems.length && chief ? "warn" : "" })}
      ${panel({ id: "brzy", title: "Chystá se", count: soon.length, body: list(soon, "Nic zvláštního se nechystá.") })}
    </div>`;
  return adminShell(ctx, data, "prehled", message, body, { title: "Přehled", rich: true });
}
