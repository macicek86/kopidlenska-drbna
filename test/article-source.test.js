import { test } from "node:test";
import assert from "node:assert/strict";
import { articleFoot, footLines, readSource, sourceEntry, sourceLine, sourceParts } from "../src/article-source.js";

test("zdroj z formuláře: jeden řádek bez zbytečných mezer", () => {
  assert.equal(readSource("  facebook \n města  "), "facebook města");
  assert.equal(sourceEntry("web FK Kopidlno", ""), "web FK Kopidlno");
  assert.equal(sourceEntry("web FK Kopidlno", "https://www.fkkopidlno.cz/a"), "web FK Kopidlno https://www.fkkopidlno.cz/a");
});

test("zdroje oddělené čárkou, odkaz za názvem", () => {
  assert.deepEqual(sourceParts("KZMJ Jičín https://kzmj.cz/, MIC Jičín https://www.jicin.org/, facebook"), [
    { label: "KZMJ Jičín", url: "https://kzmj.cz/" },
    { label: "MIC Jičín", url: "https://www.jicin.org/" },
    { label: "facebook", url: "" },
  ]);
  assert.deepEqual(sourceParts("https://www.kopidlno.cz/a"), [{ label: "", url: "https://www.kopidlno.cz/a" }]);
  assert.deepEqual(sourceParts(""), []);
});

test("řádek se zdrojem: odkazy, escapování, víc zdrojů", () => {
  assert.equal(sourceLine(""), "");
  assert.equal(sourceLine("facebook"), "Zdroj: facebook");
  assert.equal(
    sourceLine('Munipolis města Kopidlna https://kopidlno.munipolis.cz/n/1?a=1&b="2"'),
    'Zdroj: <a href="https://kopidlno.munipolis.cz/n/1?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">Munipolis města Kopidlna</a>',
  );
  assert.match(sourceLine("https://www.kopidlno.cz/a"), />kopidlno\.cz<\/a>$/);
  assert.equal(sourceLine("<b>x</b>"), "Zdroj: &lt;b&gt;x&lt;/b&gt;");
  assert.match(sourceLine("KZMJ Jičín https://kzmj.cz/, MIC Jičín https://www.jicin.org/"), /^Zdroje: <a [^>]+>KZMJ Jičín<\/a>, <a [^>]+>MIC Jičín<\/a>$/);
});

test("patička: navazující zpráva, zdroj a další řádky, bez nich nic", () => {
  assert.deepEqual(footLines({ followsSlug: "", source: "" }), []);
  assert.equal(articleFoot({ followsSlug: "", source: "" }), "");
  const foot = articleFoot({ followsSlug: "kvitek", followsTitle: "Kvítek & spol. otevírá", source: "facebook" }, ["Pokecejte"]);
  assert.equal(
    foot,
    '<footer class="article-foot"><p>Minule jsem psala: <a href="/zpravy/kvitek">Kvítek &amp; spol. otevírá</a></p><p>Zdroj: facebook</p><p>Pokecejte</p></footer>',
  );
});
