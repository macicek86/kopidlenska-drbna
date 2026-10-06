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
import { authVerdict, automatic, freshText } from "../src/mailin/parse.js";
import { receiveMail } from "../src/mailin/run.js";
import { ensureMailinTables, loadMailAdmin, saveSender } from "../src/mailin/store.js";
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

// Hlavička, kterou Cloudflare přidá nad Received, když odesílatel prošel ověřením.
const PASSED = "ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass header.d=kopidlno.cz header.s=s1; dmarc=pass header.from=kopidlno.cz policy.dmarc=none; spf=pass smtp.mailfrom=knihovna@kopidlno.cz";

function rawMail({ from = "knihovna@kopidlno.cz", subject = "Zavřeno", text = "15.8 kvc zavřeno", auth = PASSED, extra = "" } = {}) {
  const headers = [auth, "Received: from mail.kopidlno.cz by mx.cloudflare.net", extra, `From: Knihovna <${from}>`, "To: oteviracidoba@kopidlenskadrbna.org", `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8"];
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

test("ověření bere jen hlavičku Cloudflare nad Received a doménu odesílatele", () => {
  const headers = (auth) => [{ key: "arc-authentication-results", value: auth }, { key: "received", value: "by mx.cloudflare.net" }];
  assert.equal(authVerdict(headers(PASSED.slice(PASSED.indexOf(":") + 2)), "knihovna@kopidlno.cz").verified, true);
  assert.equal(authVerdict(headers("i=1; mx.cloudflare.net; dmarc=pass header.from=jinde.cz"), "knihovna@kopidlno.cz").verified, false);
  // Podvržená hlavička pod Received (napsal ji odesílatel) se nepočítá.
  const forged = [{ key: "received", value: "by mx.cloudflare.net" }, { key: "authentication-results", value: "mx.cloudflare.net; dmarc=pass header.from=kopidlno.cz" }];
  assert.equal(authVerdict(forged, "knihovna@kopidlno.cz").verified, false);
});

test("automatické odpovědi pozná", () => {
  assert.equal(automatic([{ key: "auto-submitted", value: "auto-replied" }], "a@b.cz"), true);
  assert.equal(automatic([], "mailer-daemon@b.cz"), true);
  assert.equal(automatic([{ key: "auto-submitted", value: "no" }], "a@b.cz"), false);
});

test("změna z odpovědi: jen povolené řádky, dvůr bez dočasné doby", () => {
  const tags = new Set(["misto:1", "dvur:2"]);
  assert.match(changeInput({ target: "misto:9", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "", slots: [] }, tags).error, /nejde/);
  const place = changeInput({ target: "[misto:1]", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "", slots: [] }, tags);
  assert.equal(place.section, "oteviraci-doba");
  assert.equal(place.input.changeNote, "Mimořádně zavřeno");
  assert.equal(place.input.endsOn, "2026-08-15");
  assert.match(changeInput({ target: "dvur:2", kind: "docasna", starts_on: "2026-08-15", ends_on: "", note: "", slots: [{ day: "pa", from: "8:00", to: "12:00", note: "" }] }, tags).error, /sběrného dvora/);
  const yard = changeInput({ target: "dvur:2", kind: "trvala", starts_on: "2026-08-15", ends_on: "", note: "", slots: [{ day: "pa", from: "8:00", to: "12:00", note: "" }, { day: "pa", from: "13:00", to: "17:00", note: "" }] }, tags);
  assert.deepEqual(yard.input.week, [{ day: 5, open: true, from: "08:00", to: "17:00" }]);
});

test("e-mail od povolené adresy se zapíše rovnou a odesílatel dostane odpověď", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [{ target: "misto:1", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "dovolená", slots: [] }] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    assert.equal(place.id, 1);
    assert.equal((await saveSender(env, chief(), { email: "Knihovna@Kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] })).ok, true);
    await receiveMail(message(rawMail()), env);

    const change = await env.DB.prepare("select starts_on, ends_on, note from place_changes").first();
    assert.deepEqual({ ...change }, { starts_on: "2026-08-15", ends_on: "2026-08-15", note: "dovolená" });
    const prompt = JSON.stringify(claude.seen[0]);
    assert.match(prompt, /claude-haiku-4-5/);
    assert.match(prompt, /15\.8 kvc zavřeno/);
    assert.match(prompt, new RegExp(`misto:${place.id}`));
    assert.doesNotMatch(prompt, /misto:2\]/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "knihovna@kopidlno.cz");
    assert.match(sent[0].text, /Zapsala jsem na web/);
    const audit = await env.DB.prepare("select user_name, section from audit_log").first();
    assert.deepEqual({ ...audit }, { user_name: "knihovna (e-mail)", section: "oteviraci-doba" });
    const { log } = await loadMailAdmin(env);
    assert.equal(log[0].status, "zapsano");
    assert.equal(log[0].verified, true);
  } finally {
    claude.close();
  }
});

test("neověřený e-mail jde ke schválení i s přepínačem rovnou", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [{ target: "misto:1", kind: "zavreno", starts_on: "2026-08-15", ends_on: "", note: "", slots: [] }] });
  try {
    const { env, sent, place } = await freshEnv(claude.url);
    await saveSender(env, chief(), { email: "knihovna@kopidlno.cz", label: "knihovna", direct: true, targets: [`oteviraci-doba:${place.id}`] });
    await receiveMail(message(rawMail({ auth: "X-Other: 1" })), env);
    assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);
    const [request] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"];
    assert.equal(request.author, "knihovna (e-mail)");
    assert.match(sent.at(-1).text, /ověřit/);
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

test("neznámé adrese odpoví jednou za den a jen ověřené; Claude se neptá", async () => {
  const claude = await fakeClaude({ verdict: "zmeny", question: "", changes: [] });
  try {
    const { env, sent } = await freshEnv(claude.url);
    await receiveMail(message(rawMail()), env);
    await receiveMail(message(rawMail()), env);
    await receiveMail(message(rawMail({ from: "cizi@jinde.cz" })), env);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /nemůžou psát|můžou psát jen/);
    assert.equal(claude.seen.length, 0);
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
    const change = await env.DB.prepare("select starts_on, ends_on from place_changes").first();
    assert.deepEqual({ ...change }, { starts_on: "2026-10-12", ends_on: "2026-10-18" });
    assert.equal(replies()[1].subject, "Re: Duhovka");
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
    assert.match(replies()[0].text, /ke schválení/);
    assert.match(replies()[0].text, /pondělí 12\. října až neděle 18\. října, zavřeno \(dovolená\)/);

    const chiefUser = { id: 1, role: "hlavni", permissions: [] };
    let [request] = (await loadRequests(env, chiefUser))["oteviraci-doba"];
    const input = { kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-16", changeNote: "dovolená", doctorWeek: [], placeId: place.id };
    assert.equal((await approveRequest(env, chief(), { section: "oteviraci-doba", actions: PLACE_ACTIONS, id: request.id, input })).ok, true);
    const approved = replies()[1];
    assert.match(approved.text, /Redakce změnu schválila/);
    // Redakce období zkrátila: odpověď říká, co se opravdu zapsalo.
    assert.match(approved.text, /pátek 16\. října/);
    assert.equal(approved.subject, "Re: Duhovka");
    assert.match(approved.headers["In-Reply-To"], /@kopidlno\.cz>$/);

    await receiveMail(message(rawMail({ subject: "Duhovka" })), env);
    [request] = (await loadRequests(env, chiefUser))["oteviraci-doba"];
    assert.equal((await rejectRequest(env, chief(), { section: "oteviraci-doba", id: request.id, reply: "Už je zapsané." })).ok, true);
    assert.match(replies().at(-1).text, /nezapsala[\s\S]*Důvod: Už je zapsané\./);
  } finally {
    claude.close();
  }
});
