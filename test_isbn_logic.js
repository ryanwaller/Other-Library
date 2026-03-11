
const USER_AGENT = "Other-Library/0.1 (https://other-library.com; contact: hello@other-library.com)";

function normalizeHttpsUrl(url) {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://")) return `https://${raw.slice("http://".length)}`;
  return raw;
}

function normalizeIsbn(input) {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
}

function isValidIsbn10(isbn10) {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = isbn10[i];
    const value = ch === "X" ? 10 : Number(ch);
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn10ToIsbn13(isbn10) {
  if (!isValidIsbn10(isbn10)) return null;
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(core[i]);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

function isValidIsbn13(isbn13) {
  if (!/^\d{13}$/.test(isbn13)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(isbn13[i]);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn13[12]);
}

function parseDateToIso(dateLike) {
  if (typeof dateLike !== "string") return null;
  const s = dateLike.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}$/.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function uniqStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function fetchJson(url) {
  console.log(`Fetching: ${url}`);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    console.log(`Response status: ${res.status}`);
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    console.error(`Fetch error for ${url}:`, e.message);
    return null;
  }
}

async function openLibraryLookup(isbn13, isbn10) {
  const keys = uniqStrings([`ISBN:${isbn13}`, isbn10 ? `ISBN:${isbn10}` : null]);
  const url =
    `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(keys.join(","))}` +
    `&format=json&jscmd=data`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const obj = json;
  const data = obj[`ISBN:${isbn13}`] ?? (isbn10 ? obj[`ISBN:${isbn10}`] : null);
  if (!data || typeof data !== "object") return null;

  return {
    title: data.title,
    sources: ["openlibrary"]
  };
}

async function googleBooksLookup(isbn) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
  const json = await fetchJson(url);
  if (!json || typeof json !== "object") return null;
  const obj = json;
  const item = Array.isArray(obj.items) ? obj.items[0] : null;
  const info = item?.volumeInfo;
  if (!info || typeof info !== "object") return null;

  return {
    title: info.title,
    sources: ["googleBooks"]
  };
}

async function wikidataLookup(isbn13, isbn10) {
  const values = uniqStrings([isbn13, isbn10]);
  if (values.length === 0) return null;

  const isbnValues = values.map((v) => `"${v}"`).join(" ");
  const query = `
SELECT ?item ?itemLabel ?description ?pubdate ?publisherLabel ?authorLabel ?image WHERE {
  VALUES ?isbn { ${isbnValues} }
  ?item (wdt:P212|wdt:P957) ?isbn .
  OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "en") }
  OPTIONAL { ?item wdt:P577 ?pubdate . }
  OPTIONAL { ?item wdt:P123 ?publisher . }
  OPTIONAL { ?item wdt:P50 ?author . }
  OPTIONAL { ?item wdt:P18 ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const json = await fetchJson(url);
  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) return null;

  const first = bindings[0];
  return {
    title: first?.itemLabel?.value,
    sources: ["wikidata"]
  };
}

async function runTest(input) {
  const normalized = normalizeIsbn(input);
  let isbn10 = null;
  let isbn13 = null;

  if (normalized.length === 10 && isValidIsbn10(normalized)) {
    isbn10 = normalized;
    isbn13 = isbn10ToIsbn13(normalized);
  } else if (normalized.length === 13 && isValidIsbn13(normalized)) {
    isbn13 = normalized;
  } else {
    console.error("Invalid ISBN");
    return;
  }

  console.log(`ISBN10: ${isbn10}, ISBN13: ${isbn13}`);

  const results = await Promise.allSettled([
    openLibraryLookup(isbn13, isbn10),
    googleBooksLookup(isbn13),
    wikidataLookup(isbn13, isbn10)
  ]);

  results.forEach((res, i) => {
    const names = ["OpenLibrary", "GoogleBooks", "Wikidata"];
    if (res.status === "fulfilled") {
      console.log(`${names[i]}: ${res.value ? "Found: " + res.value.title : "Not Found"}`);
    } else {
      console.log(`${names[i]}: Failed - ${res.reason.message}`);
    }
  });
}

const input = process.argv[2] || "9780743273565";
runTest(input);
