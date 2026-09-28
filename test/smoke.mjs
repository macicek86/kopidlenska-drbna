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
  body: "password=spatne",
  redirect: "manual",
});
assert(bad.status === 303, `bad login ${bad.status}`);

const good = await fetch(base + "/redakce/prihlasit", {
  method: "POST",
  headers: { origin: base, "content-type": "application/x-www-form-urlencoded" },
  body: "password=Drbna2026",
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

console.log("smoke ok");
