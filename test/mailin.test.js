import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureAuditTables } from "../src/audit-db.js";
import { approveRequest, ensureRequestTables, loadRequests, rejectRequest } from "../src/hours-requests-db.js";
import { PLACE_ACTIONS } from "../src/places-db.js";
import { ensureLinkTables } from "../src/hours-links-db.js";
import { ensureLoginTables, sha256 } from "../src/login-db.js";
import { calendarText, changeInput } from "../src/mailin/ai.js";
import { describeChange, weekText } from "../src/mailin/describe.js";
import { authTrace } from "../src/mailin/parse.js";
import { normalizeWeek } from "../src/doctors.js";
import { authVerdict, automatic, freshText } from "../src/mailin/parse.js";
import { receiveMail, replayRequest } from "../src/mailin/run.js";
import { ensureMailinTables, loadMailAdmin, saveSender } from "../src/mailin/store.js";
import { confirmGet, confirmPost } from "../src/mailin/confirm.js";
import { applyDue } from "../src/mailin/pending.js";
import { refuseRequest, waitingRequests } from "../src/mailin/register.js";
import { linkByToken } from "../src/hours-links-db.js";
import { handleQueue } from "../src/queue-run.js";
import { ensureNotifyTables } from "../src/notify.js";
import { ensurePlaceTables } from "../src/places-db.js";
import { adminMailin } from "../src/admin/mailin.js";

function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { results: [], meta: { changes: result.changes ?? 0, last_row_id: Number(result.lastInsertRowid) } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((item) => item.run())) };
}

const CHIEF = "token-hlavni-0000000000";
const chief = () => new Request("http://drbna.test/", { headers: { cookie: `drbna_editor=${CHIEF}` } });

// Výsledek kontroly, který Cloudflare přidá pod svou hlavičku Received, když odesílatel prošel ověřením.
const passedFor = (domain) => `Authentication-Results: mx.cloudflare.net; dkim=pass header.d=${domain} header.s=s1; dmarc=pass header.from=${domain} policy.dmarc=none; spf=pass smtp.mailfrom=x@${domain}`;
const PASSED = "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=kopidlno.cz header.s=s1; dmarc=pass header.from=kopidlno.cz policy.dmarc=none; spf=pass smtp.mailfrom=knihovna@kopidlno.cz";

function rawMail({ from = "knihovna@kopidlno.cz", subject = "Zavřeno", text = "15.8 kvc zavřeno", auth = PASSED, extra = "" } = {}) {
  const headers = ["Received: from mail.kopidlno.cz by mx.cloudflare.net", auth, "Received: by mail.kopidlno.cz", extra, `From: Knihovna <${from}>`, "To: oteviracidoba@kopidlenskadrbna.org", `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8"];
  headers.push(`Message-ID: <${subject.length}-${text.length}@kopidlno.cz>`);
  return `${headers.filter(Boolean).join("\r\n")}\r\n\r\n${text}`;
}

function message(raw, to = "oteviracidoba@kopidlenskadrbna.org") {
  return { to, from: "knihovna@kopidlno.cz", raw, rawSize: raw.length, rejected: "", setReject(reason) { this.rejected = reason; } };
}

// Falešný Claude: na každý dotaz vrátí připravenou odpověď a dotaz si zapamatuje.
async function fakeClaude(answer) {
  const answers = Array.isArray(answer) ? [...answer] : null;
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push(JSON.parse(body));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answers ? answers.shift() : answer) }], usage: { input_tokens: 10, output_tokens: 10 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

async function freshEnv(claudeUrl) {
  const sent = [];
  const env = { DB: d1(), ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: claudeUrl, EMAIL: { send: async (mail) => sent.push(mail) } };
  const run = (sql, ...values) => env.DB.prepare(sql).bind(...values).run();
  await run("create table users (id integer primary key, login text, name text, alias text default '', email text default '', role text, active integer default 1)");
  await run("create table user_permissions (user_id integer, code text)");
  await ensurePlaceTables(env);
  await ensureRequestTables(env);
  await ensureLinkTables(env);
  await ensureLoginTables(env);
  await ensureAuditTables(env);
  await ensureNotifyTables(env);
  await ensureMailinTables(env);
  await run("insert into users (id, login, name, role, email) values (1, 'hlavni', 'Hlavní', 'hlavni', 'hlavni@example.cz')");
  await run("insert into sessions (user_id, token_hash, created_at, last_seen) values (?, ?, ?, ?)", 1, await sha256(CHIEF), Date.now(), Date.now());
  const place = await env.DB.prepare("select id, name from places order by id limit 1").first();
  return { env, sent, place };
}

test("text bez citace a podpisu", () => {
  const text = "15.8 zavřeno\n\n-- \nJana\n\nDne 1. 8. 2026 napsal Drběna:\n> stará zpráva";
  assert.equal(freshText(text), "15.8 zavřeno");
  assert.equal(freshText("nahoře\n> citace\ndole"), "nahoře\ndole");
});

test("ověření bere jen první Authentication-Results od Cloudflare a doménu odesílatele", () => {
  // Pořadí jako u skutečného e-mailu z Gmailu, který prošel Cloudflare.
  const cloudflare = (result) => [
    { key: "received", value: "from mail-ot1.google.com by mx.cloudflare.net" },
    { key: "arc-authentication-results", value: `i=2; mx.cloudflare.net; ${result}` },
    { key: "authentication-results", value: `mx.cloudflare.net; ${result}` },
    { key: "received", value: "by 2002:a05 with SMTP" },
  ];
  const pass = "dkim=pass header.d=gmail.com header.s=20251104; dmarc=pass header.from=gmail.com policy.dmarc=none; spf=pass smtp.mailfrom=jana@gmail.com";
  assert.equal(authVerdict(cloudflare(pass), "jana@gmail.com").verified, true);
  assert.equal(authVerdict(cloudflare(pass), "jana@kopidlno.cz").verified, false);
  // Podvržený e-mail: Cloudflare napíše fail, odesílatelova vlastní hlavička pod ním se nepočítá.
  const forged = [...cloudflare("dkim=none; dmarc=fail header.from=gmail.com"), { key: "authentication-results", value: `mx.cloudflare.net; ${pass}` }];
  assert.equal(authVerdict(forged, "jana@gmail.com").verified, false);
  // Bez hlavičky od Cloudflare nic.
  assert.equal(authVerdict([{ key: "authentication-results", value: `mx.google.com; ${pass}` }], "jana@gmail.com").verified, false);
});

test("automatické odpovědi pozná", () => {
  assert.equal(automatic([{ key: "auto-submitted", value: "auto-replied" }], "a@b.cz"), true);
  assert.equal(automatic([], "mailer-daemon@b.cz"), true);
  assert.equal(automatic([{ key: "auto-submitted", value: "no" }], "a@b.cz"), false);
});

test("změna z odpovědi: jen povolené řádky, dvůr bez dočasné doby", () => {
  const tags = new Map([["misto:1", []], ["dvur:2", null]]);
  assert.match(changeInput({ target: "misto:9", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "", slots: [] }, tags).error, /nejde/);
  const place = changeInput({ target: "[misto:1]", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "", slots: [] }, tags);
  assert.equal(place.section, "oteviraci-doba");
  assert.equal(place.input.changeNote, "Mimořádně zavřeno");
  assert.equal(place.input.endsOn, "2026-08-15");
  assert.match(changeInput({ target: "dvur:2", kind: "docasna", starts_on: "2026-08-15", ends_on: "", note: "", slots: [{ day: "pa", from: "8:00", to: "12:00", note: "" }] }, tags).error, /sběrného dvora/);
  const yard = changeInput({ target: "dvur:2", kind: "trvala", starts_on: "2026-08-15", ends_on: "", note: "", slots: [{ day: "pa", from: "8:00", to: "12:00", note: "" }, { day: "pa", from: "13:00", to: "17:00", note: "" }] }, tags);
  assert.deepEqual(yard.input.week, [{ day: 5, open: true, from: "08:00", to: "17:00" }]);
});

const CLOSED = { verdict: "zmeny", question: "", changes: [{ target: "misto:1", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "dovolená", slots: [] }] };

async function pendingToken(env) {
  return String((await env.DB.prepare("select token from mail_pending order by id desc limit 1").first()).token);
}

const get = (env, token, query = "") => confirmGet(`/zmena/${token}`, env, new URL(`http://drbna.test/zmena/${token}${query}`));
const post = (env, token, action, fields = {}) => confirmPost(`/zmena/${token}/${action}`, env, fields);

test("e-mail od povolené adresy: náhled s tlačítky, zápis po schválení a odpověď", async () => {
  const claude = await fakeClaude(CLOSED);
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    assert.equal(place.id, 1);
    assert.equal((await saveSender(env, chief(), { email: "Knihovna@Kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] })).ok, true);
    await receiveMail(message(rawMail()), env);

    // Napřed jen náhled: nic se nezapsalo, odesílatel dostal tlačítka.
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);
    const prompt = JSON.stringify(claude.seen[0]);
    assert.match(prompt, /claude-haiku-4-5/);
    assert.match(prompt, /15\.8 kvc zavřeno/);
    assert.match(prompt, new RegExp(`misto:${place.id}`));
    assert.doesNotMatch(prompt, /misto:2\]/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "knihovna@kopidlno.cz");
    assert.match(sent[0].text, /Rozumím tomu takhle/);
    assert.match(sent[0].html, /Schválit hned/);
    assert.match(sent[0].html, /Zamítnout/);
    assert.match(sent[0].html, /Upravit čas na webu/);
    const token = await pendingToken(env);
    assert.match(sent[0].html, new RegExp(`/zmena/${token}\\?akce=schvalit`));
    assert.equal((await loadMailAdmin(env)).log[0].status, "ceka");

    // Odkaz z e-mailu jen ukáže stránku, nic nemění.
    const page = await (await get(env, token, "?akce=schvalit")).text();
    assert.match(page, /Zapsat změnu na web hned/);
    assert.equal((await env.DB.prepare("select status from mail_pending").first()).status, "ceka");

    await post(env, token, "schvalit");
    const change = await env.DB.prepare("select starts_on, ends_on, note from place_changes").first();
    assert.deepEqual({ ...change }, { starts_on: "2026-08-15", ends_on: "2026-08-15", note: "dovolená" });
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /Zapsala jsem na web/);
    const audit = await env.DB.prepare("select user_name, section from audit_log").first();
    assert.deepEqual({ ...audit }, { user_name: "knihovna (e-mail)", section: "oteviraci-doba" });
    const { log } = await loadMailAdmin(env);
    assert.equal(log[0].status, "zapsano");
    assert.equal(log[0].verified, true);
    // Podruhé se nic nezapíše ani neodešle.
    await post(env, token, "schvalit");
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);
    assert.equal(sent.length, 2);
    assert.match(await (await get(env, token)).text(), /Změna je na webu/);
  } finally {
    claude.close();
  }
});

test("bez reakce se změna zapíše sama po čekání (cron, záloha fronty) a fronta dostane zprávu se zpožděním", async () => {
  const claude = await fakeClaude(CLOSED);
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    const queued = [];
    env.JOBS = { send: async (body, options) => queued.push({ body, options }) };
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail()), env);
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].body, { type: "mailin.apply", id: 1 });
    assert.equal(queued[0].options.delaySeconds, 600);

    // Cron před vypršením nic nezapíše.
    assert.equal(await applyDue(env), 0);
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);

    // Fronta doručí zprávu: zapíše; cron potom už nic.
    let acked = 0;
    await handleQueue({ messages: [{ body: queued[0].body, ack: () => (acked += 1), retry: () => {} }] }, env);
    assert.equal(acked, 1);
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);
    await env.DB.prepare("update mail_pending set due_at = datetime('now', '-1 minutes')").run();
    assert.equal(await applyDue(env), 0);
    assert.equal(sent.length, 2);
  } finally {
    claude.close();
  }
});

test("cron dožene změnu, kterou fronta nedoručila", async () => {
  const claude = await fakeClaude(CLOSED);
  try {
    const { env, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail()), env);
    await env.DB.prepare("update mail_pending set due_at = datetime('now', '-1 minutes')").run();
    assert.equal(await applyDue(env), 1);
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);
  } finally {
    claude.close();
  }
});

test("zamítnutí: nic se nezapíše a odesílatel to ví; později už nejde schválit", async () => {
  const claude = await fakeClaude(CLOSED);
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail()), env);
    const token = await pendingToken(env);
    await post(env, token, "zamitnout");
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);
    assert.match(sent.at(-1).text, /nic jsem nezapsala/);
    await post(env, token, "schvalit");
    await env.DB.prepare("update mail_pending set due_at = datetime('now', '-1 minutes')").run();
    assert.equal(await applyDue(env), 0);
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);
    assert.equal((await loadMailAdmin(env)).log[0].status, "zamitnuto");
  } finally {
    claude.close();
  }
});

test("úprava na webu: jednorázový odkaz pro ten řádek, změna z čekání se nezapíše, odkaz po použití zanikne", async () => {
  const claude = await fakeClaude(CLOSED);
  try {
    const { env, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail()), env);
    const token = await pendingToken(env);
    const response = await post(env, token, "upravit", { section: "oteviraci-doba", targetId: place.id });
    assert.equal(response.status, 303);
    const linkToken = response.headers.get("location").replace("/sprava/", "");
    const link = await linkByToken(env, linkToken);
    assert.equal(link.section, "oteviraci-doba");
    assert.equal(link.targetId, place.id);
    assert.equal(link.once, true);
    assert.equal(link.direct, true);
    assert.equal((await env.DB.prepare("select status from mail_pending").first()).status, "upraveno");
    await env.DB.prepare("update mail_pending set due_at = datetime('now', '-1 minutes')").run();
    assert.equal(await applyDue(env), 0);
    // Odkaz platí den: po vypršení ho web nezná.
    await env.DB.prepare("update hours_links set expires_at = datetime('now', '-1 minutes')").run();
    assert.equal(await linkByToken(env, linkToken), null);
    // Cizí řádek upravit nejde.
    const other = await post(env, token, "upravit", { section: "oteviraci-doba", targetId: 999 });
    assert.equal(other.headers.get("location"), `/zmena/${token}`);
  } finally {
    claude.close();
  }
});

test("spam od známé adresy: zaznamená se, redakce o něm ví jednou denně, nikdo neodpoví", async () => {
  const claude = await fakeClaude({ verdict: "spam", question: "", changes: [] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail({ subject: "Levné SEO", text: "Nabízíme SEO" })), env);
    await receiveMail(message(rawMail({ subject: "Levné SEO 2", text: "Nabízíme SEO ještě jednou" })), env);
    const { log } = await loadMailAdmin(env);
    assert.deepEqual(log.map((row) => row.status), ["spam", "spam"]);
    assert.equal(sent.filter((mail) => mail.to === "knihovna@kopidlno.cz").length, 0);
    const notices = sent.filter((mail) => /Spam na/.test(mail.subject));
    assert.equal(notices.length, 1);
    assert.equal(notices[0].to, "hlavni@example.cz");
  } finally {
    claude.close();
  }
});

test("neověřený e-mail: náhled, po potvrzení jde ke schválení i s přepínačem rovnou; redakce vidí původní text", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [{ target: "misto:1", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "", slots: [] }] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail({ auth: "X-Other: 1", text: "15.8 kvc zavřeno kvůli školení" })), env);
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);
    assert.match(sent.at(-1).text, /ověřit/);
    assert.match(sent.at(-1).html, /Poslat redakci hned/);
    const token = await pendingToken(env);
    await post(env, token, "schvalit");
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);
    const [request] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"];
    assert.equal(request.author, "knihovna (e-mail)");
    assert.equal(request.mail.text, "15.8 kvc zavřeno kvůli školení");
    assert.equal(request.mail.email, "knihovna@kopidlno.cz");
    // Upozornění pro redakci nese původní text.
    assert.equal(sent.some((mail) => mail.to === "hlavni@example.cz" && /kvůli školení/.test(mail.text)), true);
  } finally {
    claude.close();
  }
});

test("e-mail, který není o otevírací době, dostane odpověď, kam psát", async () => {
  const claude = await fakeClaude({ verdict: "neni_doba", question: "", changes: [] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail({ text: "Pozvánka na besedu v pátek" })), env);
    assert.match(sent[0].text, /jen na změny otevírací doby/);
    assert.equal(sent[0].subject, "Re: Zavřeno");
  } finally {
    claude.close();
  }
});

test("neznámá ověřená adresa: e-mail čeká na povolení, odpoví se jednou; neověřené se neodpovídá", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [] });
  try {
    const { env, sent } = await freshEnv(claude.url);
    await receiveMail(message(rawMail()), env);
    await receiveMail(message(rawMail()), env);
    await receiveMail(message(rawMail({ from: "cizi@jinde.cz", auth: "X-Other: 1" })), env);
    const replies = sent.filter((mail) => mail.to === "knihovna@kopidlno.cz");
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /předala redakci/);
    assert.equal(sent.filter((mail) => /Nová adresa/.test(mail.subject)).length, 1);
    assert.equal(sent.some((mail) => mail.to === "cizi@jinde.cz"), false);
    // Model se zeptal jen u první ověřené adresy.
    assert.equal(claude.seen.length, 1);
    const [request] = await waitingRequests(env);
    assert.equal(request.email, "knihovna@kopidlno.cz");
    assert.equal(request.text, "15.8 kvc zavřeno");
    assert.equal((await loadMailAdmin(env)).requests.length, 1);
  } finally {
    claude.close();
  }
});

test("neověřený pokus z neznámé adresy nezablokuje pozdější ověřený e-mail z téže adresy", async () => {
  const claude = await fakeClaude({ verdict: "nejasne", question: "", changes: [] });
  try {
    const { env, sent } = await freshEnv(claude.url);
    await receiveMail(message(rawMail({ auth: "X-Other: 1" })), env);
    assert.equal(claude.seen.length, 0);
    await receiveMail(message(rawMail()), env);
    assert.equal(claude.seen.length, 1);
    assert.equal((await waitingRequests(env)).length, 1);
    assert.equal(sent.filter((mail) => mail.to === "knihovna@kopidlno.cz").length, 1);
    // Další ověřený e-mail týž den už Drběna nezkoumá.
    await receiveMail(message(rawMail({ text: "ještě jednou" })), env);
    assert.equal(claude.seen.length, 1);
  } finally {
    claude.close();
  }
});

test("strop zkoumaných neznámých adres se neucpe neověřenými e-maily", async () => {
  const claude = await fakeClaude({ verdict: "nejasne", question: "", changes: [] });
  try {
    const { env } = await freshEnv(claude.url);
    for (let i = 0; i < 40; i += 1) await receiveMail(message(rawMail({ from: `podvrh${i}@kopidlno.cz`, auth: "X-Other: 1" })), env);
    assert.equal(claude.seen.length, 0);
    await receiveMail(message(rawMail({ from: "skutecny@kopidlno.cz" })), env);
    assert.equal(claude.seen.length, 1);
    assert.equal((await waitingRequests(env)).length, 1);
  } finally {
    claude.close();
  }
});

test("neznámá adresa: spam se zahodí, e-mail mimo otevírací dobu dostane odpověď kam psát", async () => {
  const claude = await fakeClaude([{ verdict: "spam", question: "", changes: [] }, { verdict: "neni_doba", question: "", changes: [] }]);
  try {
    const { env, sent } = await freshEnv(claude.url);
    await receiveMail(message(rawMail({ from: "spam@jinde.cz", auth: passedFor("jinde.cz"), subject: "Výhra", text: "Vyhrál jste" })), env);
    assert.equal(sent.filter((mail) => mail.to === "spam@jinde.cz").length, 0);
    assert.equal((await waitingRequests(env)).length, 0);
    await receiveMail(message(rawMail({ from: "jana@jinde.cz", auth: passedFor("jinde.cz"), subject: "Tip", text: "V sobotu bude ples" })), env);
    const reply = sent.find((mail) => mail.to === "jana@jinde.cz");
    assert.match(reply.text, /můžou psát jen správci/);
    assert.equal((await waitingRequests(env)).length, 0);
    assert.deepEqual((await loadMailAdmin(env)).log.map((row) => row.status), ["neznamy", "spam"]);
  } finally {
    claude.close();
  }
});

test("povolení neznámé adresy: uložený e-mail se zpracuje; zamítnutí odepíše a adresa se 30 dní neozve", async () => {
  const claude = await fakeClaude([{ verdict: "zmeny", question: "", changes: [] }, CLOSED, { verdict: "nejasne", question: "", changes: [] }]);
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await receiveMail(message(rawMail()), env);
    const [request] = await waitingRequests(env);
    await saveSender(env, chief(), { email: request.email, label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    assert.equal(await replayRequest(env, request.id), true);
    assert.equal(await replayRequest(env, request.id), false);
    // Po povolení je e-mail zpracovaný jako od známé adresy: náhled s tlačítky.
    assert.match(sent.at(-1).html, /Schválit hned/);
    assert.equal((await waitingRequests(env)).length, 0);

    await receiveMail(message(rawMail({ from: "druha@kopidlno.cz" })), env);
    const [second] = await waitingRequests(env);
    assert.equal((await refuseRequest(env, chief(), second.id)).ok, true);
    assert.match(sent.at(-1).text, /zatím mezi správce/);
    assert.equal((await waitingRequests(env)).length, 0);
  } finally {
    claude.close();
  }
});

test("jiná adresa a automatická odpověď: nic se nezpracuje", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    const wrong = message(rawMail(), "info@kopidlenskadrbna.org");
    await receiveMail(wrong, env);
    assert.equal(wrong.rejected, "Neznámá adresa.");
    await receiveMail(message(rawMail({ extra: "Auto-Submitted: auto-replied" })), env);
    assert.equal(sent.length, 0);
    assert.equal(claude.seen.length, 0);
  } finally {
    claude.close();
  }
});

test("stránka redakce ukáže adresy a zaškrtnutá místa", async () => {
  const { env, place } = await freshEnv("http://127.0.0.1:9");
  await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: false, targets: [`oteviraci-doba:${place.id}`] });
  const mailin = await loadMailAdmin(env);
  const data = { signedIn: true, user: { id: 1, role: "hlavni", name: "Hlavní", permissions: [] }, places: [{ id: place.id, name: place.name }], doctors: [], yards: [], mailin, hoursRequests: {} };
  const page = adminMailin({ path: "/redakce/emaily", origin: "http://drbna.test" }, data, "", { editingId: mailin.senders[0].id });
  assert.match(page, /oteviracidoba@kopidlenskadrbna\.org/);
  assert.match(page, new RegExp(`value="oteviraci-doba:${place.id}" checked`));
  assert.match(page, /Ke schválení/);
});

test("kalendář: příští týden je pondělí až neděle", () => {
  // 2026-10-06 je úterý.
  const text = calendarText("2026-10-06", 2);
  assert.match(text, /Tento týden: 2026-10-06 až 2026-10-11\. Příští týden: 2026-10-12 až 2026-10-18\./);
  assert.match(text, /pátek 2026-10-09/);
  assert.match(calendarText("2026-10-11", 0), /Příští týden: 2026-10-12 až 2026-10-18/);
  assert.match(calendarText("2026-10-12", 1), /Příští týden: 2026-10-19 až 2026-10-25/);
});

test("odpověď na otázku Drběny: další e-mail dostane i předchozí a otázku; odpovídá z adresy na otevírací dobu ve vlákně", async () => {
  const claude = await fakeClaude([
    { verdict: "nejasne", question: "Který den bude zavřeno?", changes: [] },
    { verdict: "zmeny", question: "", changes: [{ target: "misto:1", kind: "zavreno", starts_on: "2026-10-12", ends_on: "2026-10-18", note: "", slots: [] }] },
  ]);
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "duhovka", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail({ subject: "Duhovka", text: "Dobrý den, příští týden bude mít duhovka zavřeno" })), env);
    // Napřed jde upozornění redakci, pak odpověď odesílateli.
    const replies = () => sent.filter((mail) => mail.to === "knihovna@kopidlno.cz");
    assert.equal(replies()[0].from.email, "oteviracidoba@kopidlenskadrbna.org");
    assert.match(replies()[0].headers["In-Reply-To"], /^<.+@kopidlno\.cz>$/);
    assert.match(replies()[0].text, /Který den/);

    await receiveMail(message(rawMail({ subject: "Re: Duhovka", text: "celý týden" })), env);
    const prompt = JSON.stringify(claude.seen[1]);
    assert.match(prompt, /příští týden bude mít duhovka zavřeno/);
    assert.match(prompt, /Moje otázka na něj: Který den/);
    assert.match(replies()[1].text, /Rozumím tomu takhle/);
    await post(env, await pendingToken(env), "schvalit");
    const change = await env.DB.prepare("select starts_on, ends_on from place_changes").first();
    assert.deepEqual({ ...change }, { starts_on: "2026-10-12", ends_on: "2026-10-18" });
    assert.equal(replies()[1].subject, "Re: Duhovka");
    assert.match(replies()[2].text, /Zapsala jsem na web/);
  } finally {
    claude.close();
  }
});

test("když Email Service adresu na otevírací dobu odmítne, odpoví redakce s Odpovědět na ni", async () => {
  const claude = await fakeClaude({ verdict: "neni_doba", question: "", changes: [] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    env.EMAIL.send = async (mail) => {
      if (mail.from.email !== "redakce@kopidlenskadrbna.org") throw Object.assign(new Error("no"), { code: "E_SENDER_NOT_VERIFIED" });
      sent.push(mail);
    };
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail({ text: "Pozvánka" })), env);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].replyTo, "oteviracidoba@kopidlenskadrbna.org");
    assert.equal(sent[0].headers, undefined);
  } finally {
    claude.close();
  }
});

test("změna z e-mailu ke schválení: po schválení i zamítnutí přijde odesílateli odpověď ve vlákně", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [{ target: "misto:1", kind: "zavreno", starts_on: "2026-10-12", ends_on: "2026-10-18", note: "dovolená", slots: [] }] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "duhovka", direct: false, targets: [`oteviraci-doba:${place.id}`] });
    const replies = () => sent.filter((mail) => mail.to === "knihovna@kopidlno.cz");
    await receiveMail(message(rawMail({ subject: "Duhovka" })), env);
    // Napřed náhled s tlačítky, po potvrzení jde změna k redakci.
    assert.match(replies()[0].text, /pošlu redakci ke schválení/);
    assert.match(replies()[0].html, /Poslat redakci hned/);
    assert.match(replies()[0].text, /pondělí 12\. října až neděle 18\. října, zavřeno \(dovolená\)/);
    await post(env, await pendingToken(env), "schvalit");
    assert.match(replies()[1].text, /ke schválení/);

    const chiefUser = { id: 1, role: "hlavni", permissions: [] };
    let [request] = (await loadRequests(env, chiefUser))["oteviraci-doba"];
    const input = { kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-16", changeNote: "dovolená", doctorWeek: [], placeId: place.id };
    assert.equal((await approveRequest(env, chief(), { section: "oteviraci-doba", actions: PLACE_ACTIONS, id: request.id, input })).ok, true);
    const approved = replies()[2];
    assert.match(approved.text, /Redakce změnu schválila/);
    // Redakce období zkrátila: odpověď říká, co se opravdu zapsalo.
    assert.match(approved.text, /pátek 16\. října/);
    assert.equal(approved.subject, "Re: Duhovka");
    assert.match(approved.headers["In-Reply-To"], /@kopidlno\.cz>$/);

    await receiveMail(message(rawMail({ subject: "Duhovka" })), env);
    await post(env, await pendingToken(env), "schvalit");
    [request] = (await loadRequests(env, chiefUser))["oteviraci-doba"];
    assert.equal((await rejectRequest(env, chief(), { section: "oteviraci-doba", id: request.id, reply: "Už je zapsané." })).ok, true);
    assert.match(replies().at(-1).text, /nezapsala[\s\S]*Důvod: Už je zapsané\./);
  } finally {
    claude.close();
  }
});

const part = (from, to) => ({ open: true, from, to, note: "" });
// Duhovka: po–pá 7:30–12:00 a 13:00–16:00, v úterý jen 7:30–14:00.
const duhovka = normalizeWeek([
  ...[1, 3, 4, 5].map((day) => ({ day, morning: part("07:30", "12:00"), afternoon: part("13:00", "16:00") })),
  { day: 2, morning: part("07:30", "14:00") },
]).week;

test("„zavřeno od 14“: běžné hodiny se jen oříznou, polední pauza zůstane", () => {
  const regular = new Map([["misto:8", duhovka]]);
  const raw = { target: "misto:8", kind: "docasna", starts_on: "2026-10-12", ends_on: "2026-10-16", open_from: "", close_at: "14:00", note: "", slots: [] };
  const change = changeInput(raw, regular);
  assert.equal(change.input.changeNote, "Zavírá už v 14:00");
  const monday = change.input.doctorWeek.find((slot) => slot.day === 1);
  assert.deepEqual([monday.morning.from, monday.morning.to, monday.afternoon.from, monday.afternoon.to, monday.afternoon.open], ["07:30", "12:00", "13:00", "14:00", true]);
  const line = describeChange("oteviraci-doba", "zmena", { kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-16", note: "", week: change.input.doctorWeek }, "Duhovka");
  assert.equal(line, "Duhovka: pondělí 12. října až pátek 16. října, otevřeno po 7:30–12:00 a 13:00–14:00, út 7:30–14:00, st–pá 7:30–12:00 a 13:00–14:00");
  // Otevírá později: dopoledne začne v 10, zbytek beze změny.
  const late = changeInput({ ...raw, close_at: "", open_from: "10:00" }, regular);
  assert.equal(late.input.doctorWeek.find((slot) => slot.day === 3).morning.from, "10:00");
});

test("výpis týdne slučuje stejné dny a jednodenní změna ukáže jen svůj den", () => {
  assert.equal(weekText(duhovka), "po 7:30–12:00 a 13:00–16:00, út 7:30–14:00, st–pá 7:30–12:00 a 13:00–16:00");
  assert.equal(describeChange("oteviraci-doba", "zmena", { kind: "docasna", startsOn: "2026-10-09", endsOn: "2026-10-09", note: "", week: duhovka }, ""), "pátek 9. října, otevřeno pá 7:30–12:00 a 13:00–16:00");
});

test("záznam hlaviček pro ověření: pořadí a hlavičky s výsledkem kontroly", () => {
  const headers = [
    { key: "received", value: "from mail-x.google.com by mx.cloudflare.net" },
    { key: "authentication-results", value: "mx.cloudflare.net; dkim=pass header.d=gmail.com" },
    { key: "dkim-signature", value: "v=1; a=rsa-sha256; d=gmail.com; s=20230601; b=abc" },
  ];
  const trace = authTrace(headers, new Headers({ "x-cf-spamh-score": "0" }));
  assert.match(trace, /pořadí: received, authentication-results, dkim-signature/);
  assert.match(trace, /authentication-results: mx\.cloudflare\.net; dkim=pass/);
  assert.match(trace, /dkim-signature d=gmail\.com/);
  assert.match(trace, /worker x-cf-spamh-score: 0/);
});
