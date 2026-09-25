// Finds recent Google News results for a search phrase, using the public RSS feed
// (no account or API key needed).
const FEED_URL = "https://news.google.com/rss/search";

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

function parseItem(item) {
  const source = tag(item, "source");
  let headline = tag(item, "title");
  // Google News titles end in " - Publication"; the publication is reported separately.
  if (source && headline.endsWith(` - ${source}`)) {
    headline = headline.slice(0, -(source.length + 3));
  }

  const pubDate = tag(item, "pubDate");
  const date = pubDate
    ? new Date(pubDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "date unknown";

  // The feed's description is usually just the headline again; keep it only if it adds something.
  const description = tag(item, "description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const summary = description && !description.startsWith(headline) ? description : "";

  return { headline, source: source || "unknown source", date, link: tag(item, "link"), summary };
}

async function search(query, limit) {
  // India edition, since Meera's audience and market are Indian.
  const url = `${FEED_URL}?${new URLSearchParams({ q: query, hl: "en-IN", gl: "IN", ceid: "IN:en" })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Google News ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((m) => parseItem(m[1]));
}

// Returns up to `limit` items { headline, source, date, link, summary }, most relevant first.
// The top result alone is often off-topic, so the drafting step picks from several.
export async function findNews(phrase, limit = 5) {
  if (!phrase) return [];
  // Prefer the last 30 days so the angle is actually timely; fall back to any date.
  const recent = await search(`${phrase} when:30d`, limit);
  return recent.length ? recent : search(phrase, limit);
}
