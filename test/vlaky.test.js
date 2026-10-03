import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { noticeBoard } from "../src/notices.js";
import { cdTime, parseDay, parseDetail, sectionLabel, trackIdFromPage } from "../src/vlaky/cd.js";
import { refreshTrains } from "../src/vlaky/run.js";
import { ensureTrainTables, loadTrainNotices, loadTrains, trainNotice } from "../src/vlaky/store.js";

function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { results: [], meta: { changes: result.changes ?? 0 } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => { for (const item of list) await item.run(); } };
}

// Podle skutečné odpovědi rozhraní ČD (Ajax_LoadDataRegion) pro trať 061.
const VYLUKA = {
  Type: "vyluka",
  Id: 24364,
  Useky: ["Trať 061: úsek Nymburk hlavní nádraží – Jičín"],
  Icons: [{ Ikona: "icon icon-bus", Type: "Náhradní doprava dle výlukového jízdního řádu" }],
  Href: "/jizdni-rad/omezeni-provozu/vyluka/24364",
  Od: "01.10.2026 00:00",
  Do: "04.10.2026 23:59",
};
const DETAIL = `<div><h2 class="h3">Popis:</h2>
  <p><p>Po dobu výluky budou všechny vlaky ve vyloučeném úseku nahrazeny autobusy náhradní dopravy.</p></p>
  <hr><h2 class="h3">Odkazy na podrobnosti</h2>
  <a href="https://www.cd.cz/jizdni-rad/tratove-jizdni-rady/files/cz-k061-2026vyluka06.pdf">061</a>
  <a href="http://www.cd.cz/mapy-site/40.pdf">mapa</a></div>`;

test("čte časy, úseky a odpověď rozhraní ČD", () => {
  assert.deepEqual(cdTime("1.10.2026 7:30"), { date: "2026-10-01", time: "07:30" });
  assert.deepEqual(cdTime("nesmysl"), { date: "", time: "" });
  assert.equal(sectionLabel("Trať 061: úsek Nymburk hlavní nádraží – Jičín"), "Nymburk hlavní nádraží – Jičín");
  const [item] = parseDay({ Vyluky: [VYLUKA, { Id: "x" }], Mimo: [] });
  assert.equal(item.id, "vyluka-24364");
  assert.deepEqual(item.sections, ["Nymburk hlavní nádraží – Jičín"]);
  assert.equal(item.endsOn, "2026-10-04");
  assert.equal(item.link, "https://www.cd.cz/jizdni-rad/omezeni-provozu/vyluka/24364/");
  assert.equal(parseDay({ chyba: 1 }), null);
  assert.equal(trackIdFromPage('<option value="1038">061 | Nymburk hl.n. - Jič&#237;n (PID S21)</option>'), 1038);
});

test("z detailu bere popis a jen výlukový jízdní řád", () => {
  const detail = parseDetail(DETAIL);
  assert.match(detail.description, /^Po dobu výluky budou všechny vlaky/);
  assert.equal(detail.pdfUrl, "https://www.cd.cz/jizdni-rad/tratove-jizdni-rady/files/cz-k061-2026vyluka06.pdf");
});

test("výluka jde na web jako oznámení, celé dny jen datem", () => {
  const notice = trainNotice({
    id: "vyluka-1", type: "vyluka", sections: ["Kopidlno – Jičín"], measures: ["Náhradní doprava"],
    startsOn: "2026-10-10", startsTime: "00:00", endsOn: "2026-10-11", endsTime: "23:55",
    cause: "", link: "https://www.cd.cz/x/", description: "", pdfUrl: "", manual: "",
  });
  assert.equal(notice.kind, "vlak");
  assert.equal(notice.startsTime, "");
  assert.equal(notice.endsTime, "");
  assert.equal(notice.note, "Náhradní doprava");
  const [item] = noticeBoard([notice], new Date("2026-10-08T10:00:00Z"));
  assert.equal(item.phase, "soon");
  assert.equal(item.kindLabel, "Výluka vlaků");
  assert.equal(noticeBoard([{ ...notice, published: false }], new Date("2026-10-08T10:00:00Z")).length, 0);
});

function fakeCd({ failDay = "" } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push(url);
    if (url.endsWith("/omezeni-provozu/")) return new Response('<option value="2000">061 | Nymburk</option>');
    if (url.endsWith("Ajax_LoadDataRegion")) {
      const date = new URLSearchParams(init.body).get("date");
      if (date === failDay) return new Response("chyba", { status: 500 });
      const vyluky = ["03.10.2026", "04.10.2026"].includes(date) ? [VYLUKA] : [];
      return Response.json({ NoData: false, Mimo: [], Vyluky: vyluky });
    }
    return new Response(DETAIL);
  };
  return { calls, impl };
}

test("průchod uloží výluky, dočte detail a zrušenou po celém průchodu smaže", async () => {
  const env = { DB: d1() };
  await ensureTrainTables(env);
  await env.DB.prepare("update train_settings set days_ahead = 3 where id = 1").run();
  const now = new Date("2026-10-03T08:00:00Z");
  const cd = fakeCd();
  const result = await refreshTrains(env, { fetchImpl: cd.impl, now });
  assert.equal(result.count, 1);
  assert.ok(cd.calls.some((url) => /\/vyluka\/24364\/$/.test(url)));
  const [row] = await loadTrains(env, now);
  assert.match(row.description, /náhradní dopravy/);
  assert.equal((await env.DB.prepare("select track_id from train_settings").first()).track_id, 2000);
  assert.equal((await loadTrainNotices(env, now)).length, 1);

  // Výpadek jednoho dne: nic se nemaže.
  await env.DB.prepare("insert into train_restrictions (id, cd_id, type, starts_on, seen_at) values ('vyluka-9', 9, 'vyluka', '2026-10-05', '')").run();
  await refreshTrains(env, { fetchImpl: fakeCd({ failDay: "05.10.2026" }).impl, now });
  assert.equal((await loadTrains(env, now)).length, 2);
  // Celý průchod: výluka, kterou ČD už nehlásí, zmizí.
  await refreshTrains(env, { fetchImpl: fakeCd().impl, now });
  assert.deepEqual((await loadTrains(env, now)).map((r) => r.id), ["vyluka-24364"]);
});
