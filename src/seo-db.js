// Data pro sitemap.xml: jen adresy a data, bez těl zpráv.

export async function loadSitemap(env) {
  const articles = (
    await env.DB.prepare("select slug, created_at from articles where published = 1 order by created_at desc, id desc").all()
  ).results ?? [];
  const ads = (await env.DB.prepare("select slug, created_at from ads where enabled = 1 order by id desc").all()).results ?? [];
  const rubrics = (await env.DB.prepare("select slug from rubrics order by sort_order asc, id asc").all()).results ?? [];
  const entry = (row) => ({ slug: String(row.slug), createdOn: String(row.created_at ?? "").slice(0, 10) });
  return {
    articles: articles.map(entry),
    ads: ads.map(entry),
    rubrics: rubrics.map((row) => ({ slug: String(row.slug) })),
  };
}
