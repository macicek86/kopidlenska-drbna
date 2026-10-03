// Čtení zpráv DATEX II (SituationPublication) od NDIC: uzavírky a omezení provozu.
// Worker nemá DOMParser, profil NDIC je ale jednoduchý, takže stačí vytahat pár prvků podle názvu.
// Prefixy jmenných prostorů (d2:, ns2:) se zahodí, ať je jedno, jak je NDIC zrovna pojmenuje.

function stripPrefixes(xml) {
  return String(xml ?? "").replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1");
}

function decode(text) {
  return String(text ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Všechny výskyty prvku: { attrs, body }. Prvky stejného jména se v profilu NDIC nevnořují do sebe.
function elements(xml, name) {
  const found = [];
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, "g");
  for (const match of xml.matchAll(pattern)) found.push({ attrs: match[1] ?? "", body: match[2] ?? "" });
  return found;
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*"([^"]*)"`));
  return match ? decode(match[1]) : "";
}

function texts(xml, name) {
  return elements(xml, name).map((el) => decode(el.body).replace(/\s+/g, " ").trim()).filter(Boolean);
}

function first(xml, name) {
  return texts(xml, name)[0] ?? "";
}

function number(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

// Česká hodnota z MultilingualString, jinak první, která tam je.
function localized(xml) {
  const values = elements(xml, "value");
  const czech = values.find((el) => /^(cs|cz)$/i.test(attr(el.attrs, "lang")));
  return decode((czech ?? values[0])?.body ?? "").replace(/\s+/g, " ").trim();
}

function comments(xml) {
  return elements(xml, "generalPublicComment")
    .map((el) => localized(el.body))
    .filter(Boolean);
}

// Body polohy: S-JTSK (nativní v NDIC) i WGS-84, podle toho, co odběr posílá.
function points(xml) {
  const found = [];
  for (const el of elements(xml, "sjtskPointCoordinates")) {
    const x = number(first(el.body, "sjtskX"));
    const y = number(first(el.body, "sjtskY"));
    if (x != null && y != null) found.push({ x, y });
  }
  for (const name of ["pointCoordinates", "locationForDisplay", "openlrCoordinate"]) {
    for (const el of elements(xml, name)) {
      const lat = number(first(el.body, "latitude"));
      const lon = number(first(el.body, "longitude"));
      if (lat != null && lon != null) found.push({ lat, lon });
    }
  }
  return found;
}

function vehicles(xml) {
  const block = elements(xml, "forVehiclesWithCharacteristicsOf")[0]?.body ?? "";
  if (!block) return null;
  return {
    types: texts(block, "vehicleType"),
    weight: number(first(block, "grossVehicleWeight")),
    height: number(first(block, "vehicleHeight")),
  };
}

function parseRecord(situationId, el) {
  const body = el.body;
  const validity = elements(body, "validity")[0]?.body ?? "";
  const location = elements(body, "groupOfLocations")[0]?.body ?? body;
  return {
    id: attr(el.attrs, "id"),
    situationId,
    version: attr(el.attrs, "version"),
    type: attr(el.attrs, "type"),
    versionTime: first(body, "situationRecordVersionTime"),
    validityStatus: first(validity, "validityStatus"),
    startsAt: first(validity, "overallStartTime"),
    endsAt: first(validity, "overallEndTime"),
    management: [
      ...texts(body, "roadOrCarriagewayOrLaneManagementType"),
      ...texts(body, "roadMaintenanceType"),
      ...texts(body, "reroutingManagementType"),
    ],
    capacityRemaining: number(first(body, "capacityRemaining")),
    comments: comments(body),
    detour: elements(body, "reroutingItineraryDescription").map((item) => localized(item.body)).filter(Boolean),
    roads: [...new Set(texts(location, "roadNumber"))],
    points: points(location),
    vehicles: vehicles(body),
  };
}

// Záznamy ze zprávy. Situace bez záznamů se vrací taky (records prázdné), ať jde poznat, že skončila.
export function parseSituations(xml) {
  const clean = stripPrefixes(xml);
  return elements(clean, "situation").map((situation) => {
    const id = attr(situation.attrs, "id");
    return {
      id,
      version: attr(situation.attrs, "version"),
      records: elements(situation.body, "situationRecord")
        .map((record) => parseRecord(id, record))
        .filter((record) => record.id),
    };
  }).filter((situation) => situation.id);
}

export function isDatexMessage(xml) {
  return /<(?:[\w-]+:)?d2LogicalModel\b/.test(String(xml ?? "").slice(0, 4000));
}
