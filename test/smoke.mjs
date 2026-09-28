const base = process.env.BASE ?? "http://127.0.0.1:8787";

async function get(path) {
  const response = await fetch(base + path);
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const home = await get("/");
assert(home.status === 200, `home ${home.status}`);
assert(home.text.includes("Kopidlenská"), "home title missing");
assert(home.text.includes("Popelnice"), "waste teaser missing");
assert(/Svoz je dnes|Svoz je zítra|Za \d+ dn/.test(home.text), "countdown missing");
assert(home.text.includes("/kozel-maskot.webp"), "mascot missing");
assert(!home.text.includes("<script"), "unexpected script");

const css = await get("/site.css");
assert(css.status === 200 && css.text.includes("--brand"), "css missing");

const article = await get("/zpravy/vitejte");
assert(article.status === 200 && article.text.includes("neoficiální"), "article missing");

const bins = await get("/popelnice");
assert(bins.status === 200 && bins.text.includes("Nejbližší svoz"), "bins missing");

const login = await get("/redakce/zpravy");
assert(login.status === 200 && login.text.includes("Drbna2026"), "default password hint missing");

const bad = await fetch(base + "/redakce/prihlasit", {
  method: "POST",
  headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
  body: "login=redakce&password=spatne",
  redirect: "manual",
});
assert(bad.status === 303, `bad login ${bad.status}`);

const good = await fetch(base + "/redakce/prihlasit", {
  method: "POST",
  headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
  body: "login=redakce&password=Drbna2026",
  redirect: "manual",
});
assert(good.status === 303, `login ${good.status}`);
const cookie = good.headers.get("set-cookie") ?? "";
assert(cookie.includes("drbna_editor="), "session cookie missing");

const editor = await fetch(base + "/redakce/zpravy", { headers: { cookie: cookie.split(";")[0] } });
const editorHtml = await editor.text();
assert(editor.status === 200 && editorHtml.includes("Nová zpráva"), "editor not signed in");

const body = new URLSearchParams({
  title: "Zkouška z návsi",
  excerpt: "Krátký perex pro sousedy.",
  body: "Text zprávy, který má víc než tři znaky.",
  category: "Zprávy",
  published: "1",
});
const saved = await fetch(base + "/redakce/zpravy/ulozit", {
  method: "POST",
  headers: {
    origin: base,
    cookie: cookie.split(";")[0],
    "content-type": "application/x-www-form-urlencoded",
  },
  body,
  redirect: "manual",
});
assert(saved.status === 303 && (saved.headers.get("location") ?? "").includes("ok=zprava"), saved.headers.get("location") ?? "");

const after = await get("/");
assert(after.text.includes("Zkouška z návsi"), "saved article not public");

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00,
  0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const form = new FormData();
form.set("title", "Fotka z náměstí");
form.set("excerpt", "Perex k nahrané fotce.");
form.set("body", "Text s fotkou v bucketu.");
form.set("category", "Komunita");
form.set("published", "1");
form.set("image", new File([png], "namesti.png", { type: "image/png" }));
const uploaded = await fetch(base + "/redakce/zpravy/ulozit", {
  method: "POST",
  headers: { origin: base, cookie: cookie.split(";")[0] },
  body: form,
  redirect: "manual",
});
assert(uploaded.status === 303, `upload ${uploaded.status} ${uploaded.headers.get("location")}`);
const withPhoto = await get("/zpravy");
const match = withPhoto.text.match(/\/media\/clanky\/[^"]+\.png/);
assert(match, "uploaded image url missing");
const photo = await get(match[0]);
assert(photo.status === 200 && photo.headers.get("content-type")?.includes("image/png"), "r2 image not served");

function cookieOf(response) {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function postForm(path, cookie, body) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      origin: base,
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    redirect: "manual",
  });
}

async function signIn(login, password) {
  const response = await postForm("/redakce/prihlasit", "", { login, password });
  assert(response.status === 303, `login ${login} ${response.status}`);
  const cookie = cookieOf(response);
  assert(cookie.includes("drbna_editor="), `cookie for ${login}`);
  return cookie;
}

const stamp = Date.now().toString(36);
const contributorLogin = `jana${stamp}`.replace(/[^a-z0-9]/g, "").slice(0, 32);
const draftTitle = `Trh ${stamp}`;
const draftBody = "Sousede, v sobotu je u zamku trh.";
const proposedBody = "Sousede, v sobotu je u zamku trh a kavarne ma otevreno.";
const correctedBody = "Sousedé, v sobotu je u zámku trh. Kavárna má otevřeno.";

const chief = cookie.split(";")[0];
const created = await postForm("/redakce/lide/ulozit", chief, {
  name: "Jana Nováková",
  login: contributorLogin,
  password: "hesloheslo",
});
assert(
  created.status === 303 && (created.headers.get("location") ?? "").includes("ok=clovek"),
  created.headers.get("location") ?? "contributor was not created",
);

await postForm("/redakce/odhlasit", chief, {});
const jana = await signIn(contributorLogin, "hesloheslo");
const people = await fetch(base + "/redakce/lide", { headers: { cookie: jana }, redirect: "manual" });
assert(people.status === 303 && (people.headers.get("location") ?? "").includes("chyba"), "contributor opened people");

const sent = await postForm("/redakce/zpravy/navrh", jana, {
  title: draftTitle,
  excerpt: "Perex od Jany pro sousedy.",
  body: draftBody,
  category: "Zprávy",
});
assert(
  sent.status === 303 && (sent.headers.get("location") ?? "").includes("ok=navrh"),
  sent.headers.get("location") ?? "proposal was not saved",
);
const hidden = await get("/");
assert(!hidden.text.includes(draftTitle), "proposal is public before approval");

const direct = await postForm("/redakce/zpravy/ulozit", jana, {
  id: "1",
  title: "Cizi zasah do zpravy",
  excerpt: "Perex který nemá projít.",
  body: "Text který přispěvatel posílá přímo.",
  category: "Zprávy",
  published: "1",
});
assert((direct.headers.get("location") ?? "").includes("chyba"), direct.headers.get("location") ?? "direct save allowed");
const vitejte = await get("/zpravy/vitejte");
assert(vitejte.text.includes("neoficiální") && !vitejte.text.includes("Cizi zasah"), "foreign article changed");

const eventAttempt = await postForm("/redakce/akce/ulozit", jana, {
  title: "Tajná akce přispěvatele",
  place: "Náměstí",
  startsOn: "2026-10-05",
  description: "Nemá se uložit.",
  published: "1",
});
assert((eventAttempt.headers.get("location") ?? "").includes("chyba"), "contributor saved an event");

await postForm("/redakce/odhlasit", jana, {});
const chiefAgain = await signIn("redakce", "Drbna2026");
const desk = await fetch(base + "/redakce/zpravy", { headers: { cookie: chiefAgain } });
const deskHtml = await desk.text();
const titlePattern = draftTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const proposalMatch = deskHtml.match(new RegExp(`<h3>${titlePattern}</h3>[\\s\\S]{0,400}?/redakce/zpravy\\?navrh=(\\d+)`));
assert(proposalMatch, "proposal missing from the desk");
const approved = await postForm("/redakce/zpravy/schvalit", chiefAgain, {
  id: proposalMatch[1],
  title: draftTitle,
  excerpt: "Perex od Jany pro sousedy.",
  body: draftBody,
  category: "Zprávy",
});
assert(
  approved.status === 303 && (approved.headers.get("location") ?? "").includes("ok=schvaleno"),
  approved.headers.get("location") ?? "approval failed",
);

const listed = await get("/zpravy");
const slugMatch = listed.text.match(new RegExp(`href="/zpravy/([a-z0-9-]+)"[\\s\\S]{0,220}<h2>${titlePattern}</h2>`));
assert(slugMatch, "approved article missing from the news list");
const published = await get(`/zpravy/${slugMatch[1]}`);
assert(published.text.includes("Jana Nováková"), "author missing");
assert(published.text.includes(draftBody), "approved text missing");
assert(!published.text.includes("Redigováno"), "unchanged approval marked as redacted");

await postForm("/redakce/odhlasit", chiefAgain, {});
const janaAgain = await signIn(contributorLogin, "hesloheslo");
const deskForId = await fetch(base + "/redakce/zpravy", { headers: { cookie: janaAgain } });
const idMatch = (await deskForId.text()).match(
  new RegExp(`<h3>${titlePattern}</h3>[\\s\\S]{0,250}?/redakce/zpravy\\?clanek=(\\d+)`),
);
assert(idMatch, "contributor cannot open their article");
const edited = await postForm("/redakce/zpravy/navrh", janaAgain, {
  clanek: idMatch[1],
  title: draftTitle,
  excerpt: "Perex od Jany pro sousedy.",
  body: proposedBody,
  category: "Zprávy",
});
assert((edited.headers.get("location") ?? "").includes("ok=navrh"), edited.headers.get("location") ?? "edit proposal failed");
const duringReview = await get(`/zpravy/${slugMatch[1]}`);
assert(duringReview.text.includes(draftBody) && !duringReview.text.includes(proposedBody), "edit went live before approval");

await postForm("/redakce/odhlasit", janaAgain, {});
const editorAgain = await signIn("redakce", "Drbna2026");
const reviewDesk = await (await fetch(base + "/redakce/zpravy", { headers: { cookie: editorAgain } })).text();
const reviewMatch = reviewDesk.match(new RegExp(`<h3>${titlePattern}</h3>[\\s\\S]{0,400}?/redakce/zpravy\\?navrh=(\\d+)`));
assert(reviewMatch, "edit proposal missing");
const fixed = await postForm("/redakce/zpravy/schvalit", editorAgain, {
  id: reviewMatch[1],
  title: draftTitle,
  excerpt: "Perex od Jany pro sousedy.",
  body: correctedBody,
  category: "Zprávy",
});
assert((fixed.headers.get("location") ?? "").includes("ok=schvaleno"), fixed.headers.get("location") ?? "corrected approval failed");
const afterFix = await get(`/zpravy/${slugMatch[1]}`);
assert(afterFix.text.includes(correctedBody), "corrected text missing");
assert(afterFix.text.includes("Jana Nováková"), "author lost after redaction");
assert(afterFix.text.includes("Redigováno"), "redaction mark missing");
assert(!afterFix.text.includes(proposedBody), "unapproved wording is public");
assert(!afterFix.text.includes("upraveno"), "edit is described in public");

console.log("smoke ok");
