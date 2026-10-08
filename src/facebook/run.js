import { sourceEntry } from "../article-source.js";
import { saveBotArticle } from "../bot-article.js";
import { rubricMap } from "../import-context.js";
import { noteSource } from "../health/store.js";
import { fetchPagePosts } from "./api.js";
import { summarizePost } from "./ai.js";
import { claimPost, getPage, refreshClaim, releasePost, rememberPosts } from "./store.js";

export async function collectPage(env, id, { fetchImpl = fetch } = {}) {
  const page = await getPage(env, id);
  if (!page) return { ok: false, error: "Zdrojová Page už v seznamu není." };
  const result = await fetchPagePosts(env, page.identifier, { fetchImpl });
  if (!(await getPage(env, id))) return { ok: false, error: "Zdrojová Page byla během načítání odebrána." };
  if (result.ok) await rememberPosts(env, page, result);
  else await env.DB.prepare("update facebook_pages set checked_at = datetime('now'), error = ? where id = ?").bind(result.error, page.id).run();
  await noteSource(env, {
    key: `facebook:${page.id}`, label: result.name || page.name || page.identifier, page: "/redakce/facebook",
    items: result.ok ? result.items.length : null, error: result.error || "", everyHours: 0, allowEmpty: true,
  });
  return result;
}

export async function createDraft(env, id, { ask = summarizePost, save = saveBotArticle, loadRubrics = rubricMap } = {}) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "Správce ještě nenastavil přípravu shrnutí." };
  const token = crypto.randomUUID();
  const post = await claimPost(env, id, token);
  if (!post) return { ok: false, error: "Příspěvek už má návrh, právě se zpracovává nebo už není k dispozici." };
  try {
    const result = await ask(env, post, await loadRubrics(env));
    if (!result.ok) return result;
    // Po dlouhém volání AI už mohl zámek převzít nový pokus nebo mohl být starý podklad smazán.
    if (!(await refreshClaim(env, id, token))) return { ok: false, error: "Podklad už zpracovává jiný požadavek nebo byl smazán." };
    // Pouze návrh. Publikaci dál řídí stávající schvalování zpráv.
    const made = await save(env, {
      article: result.article, rubric: result.rubric, image: null, autoPublish: false,
      source: sourceEntry(`${post.page_name} (Facebook)`, post.link),
    });
    await releasePost(env, id, token, made.proposalId);
    return { ok: true, proposalId: made.proposalId };
  } catch {
    // Výjimka poskytovatele ani obsah zdroje se nedostanou do URL chyby nebo logu.
    return { ok: false, error: "Návrh se nepodařilo dokončit. Zkontrolujte seznam návrhů a zkuste to později." };
  } finally {
    await releasePost(env, id, token);
  }
}
