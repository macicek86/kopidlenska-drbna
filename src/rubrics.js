export const SEED_RUBRICS = [
  { name: "Zprávy", slug: "zpravy", sortOrder: 10 },
  { name: "Komunita", slug: "komunita", sortOrder: 20 },
  { name: "Kultura", slug: "kultura", sortOrder: 30 },
  { name: "Praktické", slug: "prakticke", sortOrder: 40 },
  { name: "Sport", slug: "sport", sortOrder: 50 },
];

export function rubricsFrom(data) {
  if (Array.isArray(data?.rubrics)) return data.rubrics;
  return SEED_RUBRICS.map((item) => ({
    id: item.sortOrder,
    parentId: null,
    name: item.name,
    slug: item.name,
    sortOrder: item.sortOrder,
    articleCount: 0,
  }));
}

export function findRubric(rubrics, query) {
  const needle = String(query ?? "").trim();
  if (!needle || needle === "Vše") return null;
  const exact = rubrics.find((item) => item.slug === needle || item.name === needle);
  if (exact) return exact;
  const lower = needle.toLocaleLowerCase("cs");
  return (
    rubrics.find(
      (item) => item.slug.toLocaleLowerCase("cs") === lower || item.name.toLocaleLowerCase("cs") === lower,
    ) ?? null
  );
}

export function articleInRubric(article, selected, rubrics) {
  if (!selected) return true;
  const ids = new Set([selected.id]);
  if (!selected.parentId) {
    for (const item of rubrics) {
      if (item.parentId === selected.id) ids.add(item.id);
    }
  }
  if (article?.rubricId && ids.has(Number(article.rubricId))) return true;
  if (!article?.rubricId) {
    const names = new Set(rubrics.filter((item) => ids.has(item.id)).map((item) => item.name));
    if (names.has(article?.category)) return true;
  }
  return false;
}

export function rubricLabel(article) {
  const name = String(article?.category ?? "");
  const parent = String(article?.parentName ?? "").trim();
  if (parent && name && parent !== name) return `${parent} · ${name}`;
  return name;
}

export function rubricScope(rubrics, selected) {
  if (!selected) return null;
  if (!selected.parentId) return selected;
  return rubrics.find((item) => item.id === selected.parentId) ?? null;
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export function parseRubricInput(input, rubrics = []) {
  const name = cleanName(input?.name);
  if (name.length < 2) return { error: "Doplňte název rubriky." };
  const sortOrder = Number(String(input?.sortOrder ?? "").trim());
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { error: "Pořadí je číslo od 0 do 999." };
  }
  const parentId = input?.parentId ? Number(input.parentId) : null;
  const selfId = input?.id ? Number(input.id) : null;
  if (parentId && parentId === selfId) return { error: "Rubrika nemůže patřit sama pod sebe." };
  if (parentId) {
    const parent = rubrics.find((item) => item.id === parentId);
    if (!parent || parent.parentId) return { error: "Podrubrika může patřit jen pod hlavní rubriku." };
  }
  if (selfId && parentId && rubrics.some((item) => item.parentId === selfId)) {
    return { error: "Rubrika s podrubrikami nemůže být sama podrubrikou." };
  }
  const lower = name.toLocaleLowerCase("cs");
  if (rubrics.some((item) => item.id !== selfId && item.name.toLocaleLowerCase("cs") === lower)) {
    return { error: "Rubrika s tímhle názvem už je." };
  }
  return { name, parentId, sortOrder };
}

export function deleteRubricError(rubric, counts) {
  if (!rubric) return "Tahle rubrika už tu není.";
  if (Number(counts.children) > 0) return "Nejdřív odeberte podrubriky.";
  if (Number(counts.articles) > 0 || Number(counts.proposals) > 0) {
    return "V téhle rubrice jsou zprávy nebo návrhy. Nejdřív je přesuňte jinam.";
  }
  if (!rubric.parentId && Number(counts.topLevel) <= 1) return "Aspoň jedna rubrika musí zůstat.";
  return "";
}
