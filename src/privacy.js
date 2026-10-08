import { layout } from "./view.js";
import { KEEP_DAYS } from "./facebook/store.js";

const CONTACT = `<a href="mailto:redakce@kopidlenskadrbna.org">redakce@kopidlenskadrbna.org</a>`;
function page(ctx, title, text) {
  return layout({ ...ctx, title: `${title} | Kopidlenská drbna`, description: title,
    body: `<section class="privacy"><p class="eyebrow">Kopidlenská drbna</p><h1>${title}</h1>${text}</section>` });
}

export function privacyPage(ctx) {
  return page(ctx, "Soukromí a osobní údaje", `
    <p class="lede">Web a aplikaci Kopidlenská drbna provozuje Daniel Meca. S dotazy k osobním údajům se obraťte na ${CONTACT}.</p>
    <h2>Čtení webu a kontakt s redakcí</h2>
    <p>Při návštěvě zpracovává hosting technické údaje potřebné k doručení a ochraně webu, například IP adresu. Vlastní statistika návštěvnosti nepoužívá cookies: pro rozlišení návštěv pracuje s denním hashem IP adresy a prohlížeče. Denní identifikátory se uklízejí při následujícím zpracování další den; souhrnné počty návštěv zůstávají.</p>
    <p>Pokud nám pošlete zprávu nebo použijete chat, zpracujeme její obsah a údaje, které sami uvedete, pro odpověď a práci redakce. Neposílejte citlivé údaje ani přihlašovací hesla. Otázky v chatu se uchovávají po dobu nastavenou redakcí, ve výchozím nastavení 30 dní; vyřízené vzkazy a provozní záznamy e-mailů se uklízejí po 90 dnech. Chat může vytvořit návrh zprávy pro redakci.</p>
    <h2>Redakční účty a upozornění</h2>
    <p>U redakčních účtů uchováváme e-mail, jméno, oprávnění a údaje o přihlášení. Pro přihlášení používáme nezbytné relační cookies; historie změn slouží k ochraně a odpovědnosti redakce a uklízí se po 365 dnech. Účty spravujeme po dobu spolupráce a následně podle potřeb zabezpečení a právních povinností.</p>
    <p>Upozornění do prohlížeče si zapínáte sami. Ukládáme adresu a klíče pro doručení a vaše volby; odběr můžete vypnout na stránce upozornění nebo v prohlížeči. Bez těchto údajů upozornění nedoručíme. Čtení webu přihlášení ani odběr nevyžaduje.</p>
    <h2>Veřejné příspěvky Facebook Pages</h2>
    <p>Po získání potřebného přístupu může redakce přes Meta Graph API načítat veřejné textové příspěvky vybraných oficiálních stránek měst a místních organizací. Načítá se název a ID Page, ID příspěvku, jeho text, datum a veřejný odkaz. Text může obsahovat jména nebo jiné osobní údaje zveřejněné původním zdrojem. Obrázky, komentáře, seznamy sledujících ani soukromé zprávy tato funkce nenačítá. Návštěvníci se přes Facebook nepřihlašují.</p>
    <p>Podklady slouží k přípravě stručných redakčních shrnutí o akcích, uzavírkách, oznámeních a místních novinkách s odkazem na původní příspěvek. Návrh z této funkce před zveřejněním schvaluje redaktor. Zdrojové texty se uklízejí ${KEEP_DAYS} dní po posledním načtení. Návrhy, zveřejněné články a jejich zdrojové odkazy se uchovávají jako redakční archiv, dokud mají redakční význam; pravidelně se posuzuje potřeba jejich uchování. O opravu nebo smazání lze požádat podle <a href="/smazani-dat">těchto pokynů</a>.</p>
    <h2>Dodavatelé a zpracování pomocí AI</h2>
    <p>Hosting, databázi, soubory a související služby poskytuje Cloudflare. Při využití AI funkcí se potřebný text předává službě Anthropic (Claude); vyhledávání může používat modely Cloudflare Workers AI. Pro zobrazení písma prohlížeč kontaktuje Google Fonts. Odkaz na Facebook otevře službu Meta, která má vlastní pravidla soukromí.</p>
    <p>Jde o globální poskytovatele a zpracování může probíhat i mimo Evropský hospodářský prostor. Informace o příjemcích a použitých zárukách pro konkrétní zpracování si můžete vyžádat u provozovatele. Podmínky ochrany dat zveřejňují <a href="https://www.cloudflare.com/cloudflare-customer-dpa/" rel="noopener">Cloudflare</a> a <a href="https://www.anthropic.com/legal/data-processing-addendum" rel="noopener">Anthropic</a>. Přístup k redakčním podkladům mají jen oprávnění redaktoři; zveřejněné články jsou veřejné.</p>
    <h2>Účely a vaše práva</h2>
    <p>Provoz, zabezpečení, vyřízení kontaktu a přiměřené místní zpravodajství vycházejí z oprávněného zájmu provozovatele a čtenářů. Tam, kde je zpracování nezbytné pro sjednanou službu nebo právní povinnost, se opírá o tento důvod. Dobrovolné upozornění zapínáte a odvoláváte svou volbou. AI pomáhá s texty; nerozhoduje o vašich právech ani nevytváří profily osob.</p>
    <p>Podle okolností máte právo požádat o přístup, opravu, výmaz, omezení zpracování nebo přenositelnost údajů a vznést námitku proti zpracování z oprávněného zájmu. Souhlas lze odvolat bez vlivu na dřívější zpracování. Napište na ${CONTACT}; odpovíme zpravidla do jednoho měsíce. Pokud je potřeba prodloužení nebo žádosti nelze vyhovět, vysvětlíme důvod. Můžete se obrátit také na <a href="https://uoou.gov.cz/" rel="noopener">Úřad pro ochranu osobních údajů</a>.</p>`);
}

export function deletionPage(ctx) {
  return page(ctx, "Žádost o smazání dat", `
    <p class="lede">Pokud se vás týkají údaje v Kopidlenské drbně, napište na ${CONTACT} s předmětem „Smazání dat – Kopidlenská drbna“.</p>
    <ol><li>Uveďte odkaz na náš článek nebo původní příspěvek Facebook Page, případně e-mail redakčního účtu či údaje umožňující najít vaši zprávu.</li>
    <li>Popište, které údaje se vás týkají a co požadujete smazat nebo opravit.</li>
    <li>Redakce potvrdí přijetí a sdělí výsledek, případně důvod dalšího uchování. Odpovídáme zpravidla do jednoho měsíce; případné prodloužení a jeho důvod oznámíme.</li></ol>
    <p>Heslo, SMS kód ani kopii dokladu neposílejte. Pokud bude nezbytné ověřit souvislost žádosti s konkrétními údaji, domluvíme přiměřený postup.</p>
    <p>Prověříme načtený podklad, redakční návrh i případný zveřejněný článek. Načtené zdrojové texty Facebooku se automaticky uklízejí ${KEEP_DAYS} dní po posledním načtení. Smazání v Drbně neodstraní původní příspěvek na Facebooku; ten spravuje jeho vydavatel a Meta. Drbna nepoužívá přihlášení přes Facebook a pro žádost nevyžaduje účet na Facebooku.</p>
    <p>Další informace najdete v <a href="/soukromi">zásadách soukromí</a>.</p>`);
}
