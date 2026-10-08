// Které formuláře redakce jdou do historie změn (src/audit.js) a které záznamy se u nich porovnají.
// Cíl `{ table, id }` vyfotí řádek podle id; když id chybí, hledá nově založený řádek (`existing` to vypne).
// Cíl `{ label, read }` vyfotí hodnotu nebo { klíč: hodnota } (oprávnění, texty webu).
// `always`: zapsat i bez změněných hodnot (načtení, spuštění Drběny, odhlášení zařízení). Ostatní se zapíšou jen se změnou.
import { SCHOOL_LIST } from "./skola/sources.js";

const num = (value) => Number(value) || 0;
const by = (table, field, label = table, extra = {}) => ({ table, label, id: ({ fields }) => num(fields[field]), ...extra });
const existing = (table, field, label) => by(table, field, label, { existing: true });
const fresh = (table, label = table) => ({ table, label, id: () => 0 });
const single = (table, label = table) => ({ table, label, id: () => 1 });

async function first(env, sql, ...binds) {
  return env.DB.prepare(sql).bind(...binds).first();
}

// Návrh úpravy zprávy nebo reklamy bez id: přepíše se čekající či vrácený návrh téhož autora.
const ownProposal = (table, parent) => ({
  table,
  label: table,
  async id({ env, fields, user }) {
    if (num(fields.id)) return num(fields.id);
    const key = parent === "article_id" ? fields.articleId : fields.adId;
    if (!num(key)) return 0;
    const row = await first(env, `select id from ${table} where ${parent} = ? and author_id = ? and status in ('pending', 'rejected')`, num(key), user.id);
    return num(row?.id);
  },
});

// Schválený návrh: zpráva nebo reklama, do které se propsal (nová, když návrh nebyl úpravou).
const approvedInto = (table, proposals, parent) => ({
  table,
  label: table,
  async id({ env, fields }) {
    const row = await first(env, `select ${parent} as id from ${proposals} where id = ?`, num(fields.id));
    return num(row?.id);
  },
});

const permissions = {
  label: "oprávnění",
  async read({ env, fields }) {
    const rows = (await env.DB.prepare("select code from user_permissions where user_id = ? order by code").bind(num(fields.id)).all()).results ?? [];
    return { "oprávnění": rows.map((row) => row.code).join(", ") };
  },
};

const mailTargets = {
  label: "co adresa smí měnit",
  async read({ env, fields }) {
    const rows = (await env.DB.prepare("select section, target_id from mail_sender_targets where sender_id = ? order by section, target_id").bind(num(fields.id)).all()).results ?? [];
    return { "řádky": rows.map((row) => `${row.section}:${row.target_id}`).join(", ") };
  },
};

const notifyOff = {
  label: "upozornění e-mailem",
  async read({ env, user }) {
    const rows = (await env.DB.prepare("select topic from notify_off where user_id = ? order by topic").bind(user.id).all()).results ?? [];
    return { vypnuto: rows.map((row) => row.topic).join(", ") };
  },
};

const copyTexts = {
  label: "texty webu",
  async read({ env }) {
    const rows = (await env.DB.prepare("select key, value from copy").all()).results ?? [];
    return Object.fromEntries(rows.map((row) => [String(row.key), row.value]));
  },
};

const outageAreas = {
  label: "obce odstávek",
  async read({ env }) {
    const rows = (await env.DB.prepare("select name, enabled, sort_order from outage_areas").all()).results ?? [];
    return Object.fromEntries(rows.map((row) => [String(row.name), `${Number(row.enabled) ? "hlídá se" : "vypnuto"}, pořadí ${row.sort_order}`]));
  },
};

const placeOrder = {
  label: "pořadí míst",
  async read({ env }) {
    const rows = (await env.DB.prepare("select name from places order by sort_order asc, id asc").all()).results ?? [];
    return { "pořadí": rows.map((row) => row.name).join(", ") };
  },
};

// Dvory, lékaři a otevírací doba: hlavní záznam, jeho změny a žádosti ke schválení.
function hoursRoutes(base, parent, parentField, child) {
  const requests = fresh("hours_requests", "návrh ke schválení");
  const requestRow = existing("hours_requests", "requestId", "návrh ke schválení");
  const approvedParent = {
    table: parent,
    label: parent,
    async id({ env, fields }) {
      return num((await first(env, "select target_id from hours_requests where id = ?", num(fields.requestId)))?.target_id);
    },
  };
  const childPath = child === "yard_closures" ? "uzavreni" : "zmena";
  return {
    [`${base}/ulozit`]: [by(parent, "id")],
    [`${base}/smazat`]: [existing(parent, "id")],
    [`${base}/hodiny`]: [existing(parent, parentField), requests],
    [`${base}/nabidka`]: [existing(parent, parentField), requests],
    [`${base}/udaje`]: [existing(parent, parentField), requests],
    [`${base}/odkaz/novy`]: [fresh("hours_links", "odkaz pro správce")],
    [`${base}/odkaz/ulozit`]: [existing("hours_links", "linkId", "odkaz pro správce")],
    [`${base}/odkaz/smazat`]: [existing("hours_links", "linkId", "odkaz pro správce")],
    [`${base}/${childPath}`]: [fresh(child), requests],
    [`${base}/${childPath}/smazat`]: [existing(child, "id"), requests],
    [`${base}/zadost/schvalit`]: [approvedParent, fresh(child), requestRow],
    [`${base}/zadost/zamitnout`]: [requestRow],
    [`${base}/zadost/stahnout`]: [requestRow],
  };
}

function importRoutes(base, settingsTable) {
  return {
    [`${base}/ulozit`]: [single(settingsTable, "nastavení")],
    [`${base}/zkontrolovat`]: "always",
    [`${base}/zpracovat`]: "always",
  };
}

const ROUTES = {
  "/redakce/facebook/pridat": [fresh("facebook_pages")],
  "/redakce/facebook/smazat": [existing("facebook_pages", "id")],
  // Do historie nepatří kopie zdrojových textů s kratší dobou uchování.
  "/redakce/facebook/nacist": "always",
  "/redakce/facebook/navrh": "always",
  "/redakce/facebook/vymazat": "always",
  "/redakce/zpravy/ulozit": [by("articles", "id")],
  "/redakce/zpravy/smazat": [existing("articles", "id")],
  "/redakce/zpravy/hned": [existing("articles", "id")],
  "/redakce/zpravy/navrh": [ownProposal("proposals", "article_id")],
  "/redakce/zpravy/stahnout": [existing("proposals", "id")],
  "/redakce/zpravy/smazat-navrh": [existing("proposals", "id")],
  "/redakce/zpravy/vratit": [existing("proposals", "id")],
  "/redakce/zpravy/schvalit": [existing("proposals", "id"), approvedInto("articles", "proposals", "article_id")],

  "/redakce/reklamy/ulozit": [by("ads", "id")],
  "/redakce/reklamy/stav": [existing("ads", "id")],
  "/redakce/reklamy/smazat": [existing("ads", "id")],
  "/redakce/reklamy/navrh": [ownProposal("ad_proposals", "ad_id")],
  "/redakce/reklamy/stahnout": [existing("ad_proposals", "id")],
  "/redakce/reklamy/vratit": [existing("ad_proposals", "id")],
  "/redakce/reklamy/schvalit": [existing("ad_proposals", "id"), approvedInto("ads", "ad_proposals", "ad_id")],

  "/redakce/akce/ulozit": [by("events", "id")],
  "/redakce/akce/smazat": [existing("events", "id")],
  "/redakce/rubriky/ulozit": [by("rubrics", "id")],
  "/redakce/rubriky/smazat": [existing("rubrics", "id")],

  "/redakce/lide/ulozit": [fresh("users")],
  "/redakce/lide/stav": [existing("users", "id"), permissions],
  "/redakce/lide/udaje": [existing("users", "id"), permissions],
  "/redakce/lide/prihlaseni": [single("login_settings", "nastavení přihlášení")],
  "/redakce/ucet/ulozit": [{ table: "users", label: "users", id: ({ user }) => user.id }],
  "/redakce/ucet/upozorneni": [notifyOff],
  "/redakce/ucet/odhlasit-zarizeni": "always",
  "/redakce/ucet/odhlasit-ostatni": "always",

  "/redakce/svoz/ulozit": [single("settings", "nastavení")],
  "/redakce/odber/ulozit": [single("feed_settings", "nastavení odběru")],
  "/redakce/odber/upozorneni": [single("push_settings", "nastavení upozornění")],
  "/redakce/emaily/ulozit": [by("mail_senders", "id"), mailTargets],
  "/redakce/emaily/smazat": [existing("mail_senders", "id"), mailTargets],
  "/redakce/texty/ulozit": [copyTexts, single("settings", "nastavení")],

  ...hoursRoutes("/redakce/dvory", "yards", "yardId", "yard_closures"),
  ...hoursRoutes("/redakce/lekari", "doctors", "doctorId", "doctor_changes"),
  ...hoursRoutes("/redakce/oteviraci-doba", "places", "placeId", "place_changes"),
  "/redakce/oteviraci-doba/posunout": [placeOrder],

  "/redakce/odstavky/pridat": [fresh("outage_areas")],
  "/redakce/odstavky/ulozit": [outageAreas],
  "/redakce/odstavky/smazat": [existing("outage_areas", "id")],
  "/redakce/odstavky/nacist": "always",
  "/redakce/odstavky/oznameni": [by("notices", "id")],
  "/redakce/odstavky/oznameni/smazat": [existing("notices", "id")],
  "/redakce/odstavky/ndic/nastaveni": [single("ndic_settings", "nastavení")],
  "/redakce/odstavky/ndic/rucne": [existing("road_closures", "closureId")],
  "/redakce/odstavky/ndic/znovu": "always",
  "/redakce/odstavky/ndic/smazat": "always",

  "/redakce/obrazky/nahrat": "always",
  "/redakce/obrazky/fotka": [existing("stock_images", "id")],
  "/redakce/obrazky/fotka/smazat": [existing("stock_images", "id")],
  "/redakce/obrazky/tema": [by("stock_topics", "id")],
  "/redakce/obrazky/tema/smazat": [existing("stock_topics", "id")],
  "/redakce/obrazky/nastaveni": [single("stock_settings", "nastavení")],

  ...importRoutes("/redakce/munipolis", "import_settings"),
  ...importRoutes("/redakce/fotbal", "football_settings"),
  ...importRoutes("/redakce/denik", "denik_settings"),
  ...Object.assign({}, ...SCHOOL_LIST.map((source) => importRoutes(`/redakce/${source.tag}`, source.settingsTable))),
  "/redakce/vlozene/vlozit": "always",
  "/redakce/vlozene/vysledek": "always",
  "/redakce/vlozene/znovu": "always",
  "/redakce/vlozene/vratit": "always",
  "/redakce/vlozene/zahodit": "always",

  "/redakce/okoli/ulozit": [single("okoli_settings", "nastavení")],
  "/redakce/okoli/nacist": "always",
  "/redakce/okoli/napsat": "always",
  "/redakce/okoli/schovat": [existing("okoli_events", "id")],

  "/redakce/drbena/ulozit": [single("drbena_settings", "nastavení")],
  "/redakce/drbena/navazujici": [single("drbena_settings", "nastavení")],
  "/redakce/drbena/pamet": [single("drbena_settings", "nastavení")],
  "/redakce/drbena/rozestup": [single("drbena_settings", "nastavení")],
  "/redakce/drbena/pomocnik": [single("assist_settings", "nastavení")],
  "/redakce/chat/ulozit": [single("chat_settings", "nastavení")],
  "/redakce/chat/smazat-otazky": "always",

  "/redakce/vzkazy/vyrizeno": [existing("chat_messages", "id")],
  "/redakce/vzkazy/vratit": [existing("chat_messages", "id")],
  "/redakce/vzkazy/smazat": [existing("chat_messages", "id")],
};

// Sekce podle adresy (jako v menu redakce).
export function auditSection(path) {
  return path.split("/")[2] ?? "";
}

export function auditRoute(path) {
  const spec = ROUTES[path];
  if (!spec) return null;
  const section = auditSection(path);
  if (spec === "always") return { section, targets: [], always: true };
  return { section, targets: spec, always: false };
}
