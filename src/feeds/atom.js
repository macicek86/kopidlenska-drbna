// Atom 1.0 (RFC 4287): kostra feedu a položky. Data dodávají moduly feedů v src/feeds/.
import { esc } from "../html.js";
import { pragueOffset } from "../seo.js";

// Stálý základ identifikátorů (tag URI): nezmění se se slugem ani s adresou webu.
export const TAG = "tag:kopidlenskadrbna.org,2026:";
// Prázdný feed má pevné datum, ať se mu nemění ETag.
const EMPTY_UPDATED = "2026-01-01T00:00:00Z";

// XML 1.0 nepustí řídicí znaky, které v textech z cizích zdrojů občas jsou.
export function xmlText(value) {
  return esc(String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ""));
}

// Den bez času (YYYY-MM-DD) jako začátek dne v Praze, SQL čas UTC („YYYY-MM-DD HH:MM:SS“) i ISO s pásmem jako RFC 3339.
export function atomDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00${pragueOffset(text) || "Z"}`;
  const sql = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(text);
  if (sql) return `${sql[1]}T${sql[2]}Z`;
  const date = new Date(text);
  return text && !Number.isNaN(date.getTime()) ? date.toISOString().replace(/\.\d{3}Z$/, "Z") : "";
}

function stamp(value) {
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : 0;
}

// Odkazy a obrázky v HTML z webu jsou relativní („/zpravy/…“), čtečka potřebuje celou adresu.
export function absoluteHtml(html, base) {
  return String(html ?? "").replace(/(\s(?:href|src))="\/(?!\/)/g, `$1="${base}/`);
}

export function imageType(key) {
  const ext = /\.([a-z0-9]+)$/i.exec(String(key ?? ""))?.[1]?.toLowerCase() ?? "";
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" }[ext] ?? "image/jpeg";
}

function entryXml(entry) {
  const updated = atomDate(entry.updated);
  const published = entry.published ? atomDate(entry.published) : "";
  const authors = (entry.authors ?? []).filter(Boolean).map((name) => `<author><name>${xmlText(name)}</name></author>`);
  const categories = (entry.categories ?? []).map(
    (item) => `<category term="${xmlText(item.term)}"${item.label ? ` label="${xmlText(item.label)}"` : ""}/>`,
  );
  const image = entry.image
    ? [
        `<link rel="enclosure" type="${imageType(entry.image)}" href="${xmlText(entry.image)}"/>`,
        `<media:thumbnail url="${xmlText(entry.image)}"/>`,
      ]
    : [];
  return `  <entry>
    <id>${xmlText(entry.id)}</id>
    <title>${xmlText(entry.title)}</title>
    <link rel="alternate" type="text/html" href="${xmlText(entry.url)}"/>
    ${[
      `<updated>${updated}</updated>`,
      published ? `<published>${published}</published>` : "",
      ...authors,
      ...categories,
      ...image,
      entry.summary ? `<summary>${xmlText(entry.summary)}</summary>` : "",
      entry.content ? `<content type="html">${xmlText(entry.content)}</content>` : "",
    ]
      .filter(Boolean)
      .join("\n    ")}
  </entry>`;
}

// feed: { id, title, subtitle, self, alternate, author, icon, logo, entries }. Položky se seřadí od nejnovější.
export function atomFeed(feed) {
  const entries = [...(feed.entries ?? [])].sort((a, b) => stamp(atomDate(b.updated)) - stamp(atomDate(a.updated)));
  const updated = entries.length ? atomDate(entries[0].updated) : EMPTY_UPDATED;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="cs">
  <id>${xmlText(feed.id)}</id>
  <title>${xmlText(feed.title)}</title>
  ${feed.subtitle ? `<subtitle>${xmlText(feed.subtitle)}</subtitle>\n  ` : ""}<updated>${updated}</updated>
  <link rel="self" type="application/atom+xml" href="${xmlText(feed.self)}"/>
  <link rel="alternate" type="text/html" href="${xmlText(feed.alternate)}"/>
  <author><name>${xmlText(feed.author)}</name></author>
  ${feed.icon ? `<icon>${xmlText(feed.icon)}</icon>\n  ` : ""}${feed.logo ? `<logo>${xmlText(feed.logo)}</logo>\n  ` : ""}<generator>Kopidlenská drbna</generator>
${entries.map(entryXml).join("\n")}
</feed>
`;
}
