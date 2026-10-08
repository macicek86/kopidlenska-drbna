// Zásady soukromí v podrobném znění pro kontrolu Mety (Facebook Pages): jen na přímé adrese, mimo patičku i sitemap, `noindex`.
// Pro čtenáře bude jiná, kratší verze. Pokyny ke smazání dat jsou pro všechny (odkaz na stránce O nás, v sitemap).
import { layout } from "./view.js";

const CONTACT = `<a href="mailto:redakce@kopidlenskadrbna.org">redakce@kopidlenskadrbna.org</a>`;
function page(ctx, title, text, { noindex = false } = {}) {
  return layout({ ...ctx, title: `${title} | Kopidlenská drbna`, description: title, noindex,
    body: `<section class="privacy"><p class="eyebrow">Kopidlenská drbna</p><h1>${title}</h1>${text}</section>` });
}

export function privacyPage(ctx) {
  return page(ctx, "Soukromí a osobní údaje", `
    <p class="lede">Web a aplikaci Kopidlenská drbna provozuje Daniel Meca. S dotazy k osobním údajům se obraťte na ${CONTACT}.</p>
    <h2>Čtení webu a kontakt s redakcí</h2>
    <p>Při návštěvě zpracovává hosting technické údaje potřebné k doručení a ochraně webu, například IP adresu. Vlastní statistika návštěvnosti nepoužívá cookies: pro rozlišení návštěv pracuje s denním hashem IP adresy a prohlížeče. Denní identifikátory se uklízejí při následujícím zpracování další den; souhrnné počty návštěv zůstávají.</p>
    <p>Web si v úložišti vašeho prohlížeče (localStorage) pamatuje drobnosti, například že jste už viděli uvítací okno nebo nabídku upozornění, a rozhovor s chatem drží jen do zavření okna (sessionStorage). Tyto údaje zůstávají ve vašem prohlížeči a můžete je kdykoli smazat. Chat chrání před roboty služba Cloudflare Turnstile.</p>
    <p>Pokud nám pošlete zprávu nebo použijete chat, zpracujeme její obsah a údaje, které sami uvedete, pro odpověď a práci redakce. Neposílejte citlivé údaje ani přihlašovací hesla. Otázky v chatu se uchovávají po dobu nastavenou redakcí, ve výchozím nastavení 30 dní; vyřízené vzkazy a provozní záznamy e-mailů se uklízejí po 90 dnech. Chat může vytvořit návrh zprávy pro redakci.</p>
    <h2>Redakční účty a upozornění</h2>
    <p>U redakčních účtů uchováváme e-mail, jméno, oprávnění a údaje o přihlášení. Pro přihlášení používáme nezbytné cookies: bez zaškrtnutí „Neodhlašovat“ platí jen do odhlášení po nečinnosti, se zaškrtnutím nejdéle rok; historie změn slouží k ochraně a odpovědnosti redakce a uklízí se po 365 dnech. Účty spravujeme po dobu spolupráce a následně podle potřeb zabezpečení a právních povinností.</p>
    <p>Upozornění do prohlížeče si zapínáte sami. Ukládáme adresu a klíče pro doručení a vaše volby; odběr můžete vypnout na stránce upozornění nebo v prohlížeči. Bez těchto údajů upozornění nedoručíme. Čtení webu přihlášení ani odběr nevyžaduje.</p>
    <h2>Veřejné příspěvky Facebook Pages</h2>
    <p>Drbna čte přes Meta Graph API veřejné příspěvky vybraných oficiálních facebookových stránek (Pages) města a místních organizací, stejně jako čte web města nebo školy. Načítá název a ID stránky, ID příspěvku, jeho text, datum, veřejný odkaz a fotky, které jsou u příspěvku. Text i fotky můžou obsahovat jména nebo podobu lidí, jak je zveřejnil původní zdroj. Komentáře, reakce, seznamy sledujících, osobní profily ani soukromé zprávy drbna nenačítá. Návštěvníci se přes Facebook nepřihlašují.</p>
    <p>Z příspěvku napíše Koza Drběna (pomocí AI) krátký článek o akci nebo místní novince s odkazem na původní příspěvek, nebo ho přeskočí. Článek před zveřejněním schvaluje redaktor. Fotku z příspěvku použije jen se zapnutým nastavením a s popiskem, odkud je. Načtené příspěvky zůstávají v redakci jako podklady stejně jako u ostatních zdrojů a zveřejněné články jako redakční archiv, dokud mají redakční význam. O opravu nebo smazání lze požádat podle <a href="/smazani-dat">těchto pokynů</a>.</p>
    <h2>Dodavatelé a zpracování pomocí AI</h2>
    <p>Hosting, databázi, soubory a související služby poskytuje Cloudflare. Při využití AI funkcí se potřebný text předává službě Anthropic (Claude); vyhledávání může používat modely Cloudflare Workers AI. Pro zobrazení písma prohlížeč kontaktuje Google Fonts. Fotky z facebookových příspěvků se stahují ze serverů Meta. Odkaz na Facebook otevře službu Meta, která má vlastní pravidla soukromí.</p>
    <p>Jde o globální poskytovatele a zpracování může probíhat i mimo Evropský hospodářský prostor. Informace o příjemcích a použitých zárukách pro konkrétní zpracování si můžete vyžádat u provozovatele. Podmínky ochrany dat zveřejňují <a href="https://www.cloudflare.com/cloudflare-customer-dpa/" rel="noopener">Cloudflare</a> a <a href="https://www.anthropic.com/legal/data-processing-addendum" rel="noopener">Anthropic</a>. Přístup k redakčním podkladům mají jen oprávnění redaktoři; zveřejněné články jsou veřejné.</p>
    <h2>Účely a vaše práva</h2>
    <p>Provoz, zabezpečení, vyřízení kontaktu a přiměřené místní zpravodajství vycházejí z oprávněného zájmu provozovatele a čtenářů. Tam, kde je zpracování nezbytné pro sjednanou službu nebo právní povinnost, se opírá o tento důvod. Dobrovolné upozornění zapínáte a odvoláváte svou volbou. AI pomáhá s texty; nerozhoduje o vašich právech ani nevytváří profily osob.</p>
    <p>Podle okolností máte právo požádat o přístup, opravu, výmaz, omezení zpracování nebo přenositelnost údajů a vznést námitku proti zpracování z oprávněného zájmu. Souhlas lze odvolat bez vlivu na dřívější zpracování. Napište na ${CONTACT}; odpovíme zpravidla do jednoho měsíce. Pokud je potřeba prodloužení nebo žádosti nelze vyhovět, vysvětlíme důvod. Můžete se obrátit také na <a href="https://uoou.gov.cz/" rel="noopener">Úřad pro ochranu osobních údajů</a>.</p>`, { noindex: true });
}

export function deletionPage(ctx) {
  return page(ctx, "Žádost o smazání dat", `
    <p class="lede">Pokud se vás týkají údaje v Kopidlenské drbně, napište na ${CONTACT} s předmětem „Smazání dat – Kopidlenská drbna“.</p>
    <ol><li>Uveďte odkaz na náš článek nebo původní příspěvek Facebook Page, případně e-mail redakčního účtu či údaje umožňující najít vaši zprávu.</li>
    <li>Popište, které údaje se vás týkají a co požadujete smazat nebo opravit.</li>
    <li>Redakce potvrdí přijetí a sdělí výsledek, případně důvod dalšího uchování. Odpovídáme zpravidla do jednoho měsíce; případné prodloužení a jeho důvod oznámíme.</li></ol>
    <p>Heslo, SMS kód ani kopii dokladu neposílejte. Pokud bude nezbytné ověřit souvislost žádosti s konkrétními údaji, domluvíme přiměřený postup.</p>
    <p>Prověříme načtený podklad (text i fotky), redakční návrh i případný zveřejněný článek a smažeme nebo opravíme, co se vás týká. Smazání v Drbně neodstraní původní příspěvek na Facebooku; ten spravuje jeho vydavatel a Meta. Drbna nepoužívá přihlášení přes Facebook a pro žádost nevyžaduje účet na Facebooku.</p>`);
}
