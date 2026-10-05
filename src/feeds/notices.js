// Feed odstávek a uzavírek (/odstavky/feed.xml): voda a silnice od redakce i z NDIC a elektřina z ČEZ.
// Jen to, co je na webu a ještě neskončilo. Uzavírky z NDIC beze změny nesou větu o zdroji (podmínky ŘSD),
// přepsané Drběnou ji nést nesmí.
import { text as tx } from "../copy.js";
import { esc } from "../html.js";
import { NDIC_CREDIT } from "../outages-view.js";
import { withoutTracking } from "../rich.js";
import { TAG, atomFeed } from "./atom.js";

const KIND_LABEL = { voda: "Nepoteče voda", uzavirka: "Silnice" };

function placesHtml(item) {
  const labels = item.placeLabels ?? [];
  if (!labels.length) return "";
  const more = item.morePlaces ? `<li>a dalších ${esc(item.morePlaces)} míst</li>` : "";
  return `<ul>${labels.map((label) => `<li>${esc(label)}</li>`).join("")}${more}</ul>`;
}

function noticeEntry(base, item, fallbackAt) {
  const source = item.sourceUrl ? `<p><a href="${esc(withoutTracking(item.sourceUrl))}">Oznámení u zdroje</a></p>` : "";
  const credit = item.source === "ndic" ? `<p><small>${esc(NDIC_CREDIT)}</small></p>` : "";
  return {
    id: `${TAG}oznameni-${item.id}`,
    title: `${item.title}: ${item.when}`,
    url: `${base}/odstavky`,
    updated: item.addedAt || fallbackAt,
    categories: [{ term: item.kind, label: KIND_LABEL[item.kind] ?? item.kind }],
    summary: [item.when, (item.placeLabels ?? []).join(", ")].filter(Boolean).join(". "),
    content: `<p><strong>${esc(item.when)}</strong></p>${placesHtml(item)}${item.note ? `<p>${esc(item.note)}</p>` : ""}${source}${credit}`,
  };
}

function powerEntry(base, item, fallbackAt) {
  const pdf = item.announcementUrl ? `<p><a href="${esc(item.announcementUrl)}">Oznámení distributora (PDF)</a></p>` : "";
  const parcels = item.parcelLine ? `<p>${esc(item.parcelLine)}</p>` : "";
  return {
    id: `${TAG}elektrina-${item.id}`,
    title: `Nepůjde proud: ${item.areaName}, ${item.when}`,
    url: `${base}/odstavky`,
    updated: item.seenAt || fallbackAt,
    categories: [{ term: "elektrina", label: "Elektřina" }],
    summary: [item.when, (item.placeLabels ?? []).join(", ")].filter(Boolean).join(". "),
    content: `<p><strong>${esc(item.when)}</strong></p>${placesHtml(item)}${parcels}${pdf}`,
  };
}

// notices: loadNoticeBoard (zveřejněné, neproběhlé), power: loadOutageBoard. now: kdy feed vzniká (náhradní datum).
export function noticesFeed(base, { notices = [], power = null }, copy, now = new Date()) {
  const site = tx(copy, "site_name");
  const fallbackAt = power?.fetchedAt || now.toISOString();
  return atomFeed({
    id: `${TAG}odstavky`,
    title: `${site}: ${tx(copy, "outages_heading")}`,
    subtitle: tx(copy, "outages_description"),
    self: `${base}/odstavky/feed.xml`,
    alternate: `${base}/odstavky`,
    author: site,
    icon: `${base}/icon-192.png`,
    entries: [
      ...notices.map((item) => noticeEntry(base, item, fallbackAt)),
      ...(power?.items ?? []).map((item) => powerEntry(base, item, fallbackAt)),
    ],
  });
}
