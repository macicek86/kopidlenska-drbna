import { esc } from "../html.js";
import { KEEP_DAYS } from "../facebook/store.js";
import { stamp, textBlock } from "./imports.js";
import { adminShell } from "./shell.js";
import { badge, callout, confirmForm, field, formFoot, input, item, list, modal, pageHead, panel } from "./ui.js";

const BASE = "/redakce/facebook";
const outside = (url, label) => `<a class="btn btn-sm btn-line" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
function button(action, id, label, busy, disabled = false) {
  return `<form method="post" action="${BASE}/${action}"><input type="hidden" name="id" value="${Number(id)}"><button class="btn btn-sm btn-line" type="submit" data-busy="${esc(busy)}"${disabled ? " disabled" : ""}>${label}</button></form>`;
}

export function adminFacebook(ctx, data, message, query = {}) {
  const fb = data.facebook ?? { pages: [], posts: [], ready: false, aiReady: false };
  const sourceItems = fb.pages.map((page) => item({
    title: page.name || page.identifier,
    meta: esc(page.checked_at ? `Naposledy načteno ${stamp(page.checked_at)}.` : "Ještě se nenačítalo."),
    extra: page.error ? callout(esc(page.error), "warn") : "",
    actions: button("nacist", page.id, "Načíst příspěvky", "Načítám…", !fb.ready)
      + outside(`https://www.facebook.com/${encodeURIComponent(page.identifier)}`, "Page")
      + `<a class="btn btn-sm btn-ghost" href="${BASE}?smazat=${page.id}">Odebrat</a>`,
  }));
  const postItems = fb.posts.map((post) => {
    const made = post.article_id ? `<a class="btn btn-sm btn-line" href="/redakce/zpravy?id=${post.article_id}">Článek</a>`
      : post.draft_id ? `<a class="btn btn-sm btn-line" href="/redakce/zpravy?navrh=${post.draft_id}">Návrh</a>` : "";
    const locked = Boolean(post.processing_token) && Date.parse(`${post.processing_at}Z`) >= Date.now() - 30 * 60_000;
    return item({
      title: post.text.replace(/\s+/g, " ").slice(0, 100),
      meta: esc(`${post.page_name} · ${stamp(post.published_at)}`),
      badges: made ? badge("Shrnutí připravené", "ok") : locked ? badge("Drběna připravuje návrh", "info") : "",
      actions: made || button("navrh", post.id, "Připravit shrnutí", "Drběna píše návrh…", !fb.aiReady || locked),
      extra: `<details><summary>Podklad a původní zdroj</summary>${textBlock(post.text)}<div class="row">${outside(post.link, "Původní příspěvek")}<a class="btn btn-sm btn-ghost" href="${BASE}?zprava=${post.id}">Smazat podklad</a></div></details>`,
    });
  });
  const page = fb.pages.find((row) => row.id === query.confirmId);
  const post = fb.posts.find((row) => row.id === query.importId);
  const confirmation = page || post ? modal({
    id: "smazat-facebook", title: page ? "Odebrat zdrojovou Page?" : "Smazat načtený podklad?", close: BASE, open: true,
    body: confirmForm({ action: `${BASE}/${page ? "smazat" : "vymazat"}`, id: (page || post).id, close: BASE,
      text: "Načtený text se smaže. Případné redakční návrhy a články zůstávají v sekci Zprávy; ty zkontrolujte a smažte samostatně.", submit: "Smazat" }),
  }) : "";
  const body = `${pageHead("Facebook Pages", "Veřejná oznámení vybraných stránek měst a organizací. Vyberte podklad a připravte krátké shrnutí s odkazem na původní příspěvek. Každý návrh čeká na schválení v sekci Zprávy.")}
    ${!fb.ready ? callout("Přístup k Facebooku ještě není nastavený. Pro cizí Pages musí Meta schválit Page Public Content Access. Před schválením lze zkoušet Page, kterou spravuje také správce aplikace.", "warn") : ""}
    ${!fb.aiReady ? callout("Příprava shrnutí ještě není nastavená. Načtené podklady lze prohlížet a zpracovat ručně.", "warn") : ""}
    ${panel({ title: "Zdrojové Pages", count: fb.pages.length, body: list(sourceItems, "Přidejte první zdrojovou Page."), id: "facebook-zdroje" })}
    ${panel({ title: "Přidat Page", body: `<form class="form" method="post" action="${BASE}/pridat">${field("Odkaz nebo ID Page", `<input class="${input}" name="link" required maxlength="300" placeholder="https://www.facebook.com/nazev-stranky">`, "Vyberte oficiální stránku města nebo organizace, která zveřejňuje informace pro místní obyvatele.")}${formFoot("Přidat zdroj")}</form>`, id: "facebook-pridat" })}
    <p class="hint">Načítá se nejvýš 50 posledních textových příspěvků z jedné Page. Obrázky, komentáře a reakce se nestahují. Podklady se uklízejí ${KEEP_DAYS} dní po posledním načtení; návrhy a články spravuje redakce.</p>
    ${panel({ title: "Načtené příspěvky", count: fb.posts.length, body: list(postItems, "Zatím tu nejsou načtené příspěvky."), filter: "Hledat v podkladech", id: "facebook-prispevky" })}${confirmation}`;
  return adminShell(ctx, data, "facebook", message, body, { title: "Facebook Pages" });
}
