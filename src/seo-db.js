// Data pro sitemap.xml: jen adresy a data, bez těl zpráv.
import { liveArticle } from "./db-core.js";

export async function loadSitemap(env) {
  const articles = (
    await env.DB.prepare(`select slug, created_at from articles a where ${liveArticle()} order by created_at desc, id desc`).all()
  ).results ?? [];
  const ads = (await env.DB.prepare("select slug, created_at from ads where enabled = 1 order by id desc").all()).results ?? [];
  const rubrics = (await env.DB.prepare("select slug from rubrics order by sort_order asc, id asc").all()).results ?? [];
  // Stránka Upozornění jen když ji redakce ukazuje na webu (zvoneček, src/push/store.js).
  const push = await env.DB.prepare("select enabled, promo from push_settings where id = 1").first().catch(() => null);
  const entry = (row) => ({ slug: String(row.slug), createdOn: String(row.created_at ?? "").slice(0, 10) });
  return {
    articles: articles.map(entry),
    ads: ads.map(entry),
    rubrics: rubrics.map((row) => ({ slug: String(row.slug) })),
    pushPage: Number(push?.enabled) === 1 && Number(push?.promo) === 1,
  };
}
