// Junta los titulares de los RSS de periódicos españoles en la tabla public.noticias,
// de la que lee cafecita.app. La lanza pg_cron cada media hora (ver supabase/README.md).
//
//  · titulares de las últimas 36 h, sin duplicados entre periódicos
//  · alterna periódicos para que la portada no sea de uno solo
//  · como mucho un refresco cada 10 min, así que da igual quién la llame
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_AGE_H = 36;
const MAX_ITEMS = 160;
const PER_SOURCE = 30;
const MIN_GAP_MIN = 10;

// [nombre visible, url del feed, dominio al que deben apuntar los enlaces]
const FEEDS: [string, string, string][] = [
  ["El País", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", "elpais.com"],
  ["elDiario.es", "https://www.eldiario.es/rss/", "eldiario.es"],
  ["El Mundo", "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml", "elmundo.es"],
  ["20minutos", "https://www.20minutos.es/rss/", "20minutos.es"],
  ["La Vanguardia", "https://www.lavanguardia.com/rss/home.xml", "lavanguardia.com"],
  ["ABC", "https://www.abc.es/rss/2.0/portada/", "abc.es"],
  ["Europa Press", "https://www.europapress.es/rss/rss.aspx", "europapress.es"],
];

const UA = "Mozilla/5.0 (compatible; CafecitaBot/1.0; +https://cafecita.app/)";

type Noticia = { id: string; titular: string; fuente: string; url: string; fecha: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function unescape(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(s = "") {
  s = s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
  return unescape(unescape(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// «Última hora de la guerra, en directo | Zelenski anuncia…» → «Zelenski anuncia…»
function headline(title: string) {
  const i = title.indexOf(" | ");
  if (i < 0) return title;
  const head = title.slice(0, i), rest = title.slice(i + 3);
  return /directo|última hora/i.test(head) && rest.length >= 25 ? rest : title;
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];

// Solo enlaces http(s) al propio periódico: el feed no puede colar otra web
function safeLink(link: string | undefined, domain: string) {
  try {
    const u = new URL(clean(link));
    const host = u.hostname.toLowerCase();
    if (!/^https?:$/.test(u.protocol) || !(host === domain || host.endsWith("." + domain))) return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

async function sha1(s: string) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}

async function items(name: string, url: string, domain: string, now: number): Promise<Noticia[]> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const out: Noticia[] = [];
  for (const [, item] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const titular = headline(clean(tag(item, "title")));
    const link = safeLink(tag(item, "link"), domain);
    const raw = clean(tag(item, "pubDate") ?? tag(item, "dc:date") ?? "");
    const t = raw ? Date.parse(raw) : NaN;
    if (titular.length < 25 || !link) continue;
    if (!isNaN(t) && (now - t > MAX_AGE_H * 3600e3 || t - now > 2 * 3600e3)) continue;
    out.push({ id: await sha1(link), titular, fuente: name, url: link, fecha: new Date(isNaN(t) ? now : t).toISOString() });
    if (out.length >= PER_SOURCE) break;
  }
  return out;
}

function words(title: string) {
  const t = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return new Set((t.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3));
}
// la misma noticia contada por dos periódicos
function sameStory(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 3 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.4;
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const { data: last } = await db.from("noticias").select("actualizado").order("actualizado", { ascending: false }).limit(1);
  const since = last?.[0] ? (Date.now() - Date.parse(last[0].actualizado)) / 60000 : Infinity;
  if (since < MIN_GAP_MIN) return json({ ok: true, skipped: `refrescado hace ${Math.round(since)} min` });

  const now = Date.now();
  const log: string[] = [];
  const perSource = (await Promise.all(FEEDS.map(async ([name, url, domain]) => {
    try {
      const got = await items(name, url, domain, now);
      log.push(`${name}: ${got.length}`);
      return got;
    } catch (e) { // un periódico caído no tumba al resto
      log.push(`${name}: ${(e as Error).message}`);
      return [];
    }
  }))).filter((s) => s.length);

  // portada alternando periódicos: el 1º de cada uno, luego el 2º…
  const merged: Noticia[] = [], urls = new Set<string>(), seen: Set<string>[] = [];
  for (let rank = 0; rank < Math.max(0, ...perSource.map((s) => s.length)); rank++) {
    for (const src of perSource) {
      const n = src[rank];
      if (!n || urls.has(n.url)) continue;
      const w = words(n.titular);
      if (seen.some((o) => sameStory(w, o))) continue;
      urls.add(n.url);
      seen.push(w);
      merged.push(n);
    }
  }
  const rows = merged.slice(0, MAX_ITEMS);
  if (rows.length < 10) return json({ ok: false, error: `solo ${rows.length} titulares, no se toca la tabla`, log }, 502);

  const stamp = new Date().toISOString();
  const { error: upErr } = await db.from("noticias").upsert(rows.map((n, i) => ({ ...n, orden: i, actualizado: stamp })));
  if (upErr) return json({ ok: false, error: upErr.message, log }, 500);
  // lo que ya no sale en portada, fuera
  const { error: delErr } = await db.from("noticias").delete().lt("actualizado", stamp);
  if (delErr) return json({ ok: false, error: delErr.message, log }, 500);
  return json({ ok: true, titulares: rows.length, log });
});
