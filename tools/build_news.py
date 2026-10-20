"""
Junta los titulares de los RSS de periódicos españoles en noticias.json.

Lo lanza cada media hora .github/workflows/noticias.yml; en local:
    python3 tools/build_news.py

  · solo librería estándar (corre tal cual en GitHub Actions)
  · titulares de las últimas 36 h, sin duplicados entre periódicos
  · alterna periódicos para que la portada no sea de uno solo
  · si el contenido no cambia, no reescribe el fichero (no hay commit)
"""
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

OUT = os.path.join(os.path.dirname(__file__), "..", "noticias.json")
MAX_AGE = timedelta(hours=36)
MAX_ITEMS = 160
PER_SOURCE = 30

# (nombre visible, url del feed, dominio al que deben apuntar los enlaces)
FEEDS = [
    ("El País", "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", "elpais.com"),
    ("elDiario.es", "https://www.eldiario.es/rss/", "eldiario.es"),
    ("El Mundo", "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml", "elmundo.es"),
    ("20minutos", "https://www.20minutos.es/rss/", "20minutos.es"),
    ("La Vanguardia", "https://www.lavanguardia.com/rss/home.xml", "lavanguardia.com"),
    ("ABC", "https://www.abc.es/rss/2.0/portada/", "abc.es"),
    ("Europa Press", "https://www.europapress.es/rss/rss.aspx", "europapress.es"),
]

UA = "Mozilla/5.0 (compatible; CafecitaBot/1.0; +https://cafecita.app/)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def clean(text):
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    return re.sub(r"\s+", " ", text).strip()


def headline(title):
    """«Última hora de la guerra, en directo | Zelenski anuncia…» → «Zelenski anuncia…»"""
    head, sep, rest = title.partition(" | ")
    if sep and re.search(r"directo|última hora", head, re.I) and len(rest) >= 25:
        return rest
    return title


def parse_date(text):
    try:
        d = email.utils.parsedate_to_datetime(text.strip())
    except (TypeError, ValueError, AttributeError):
        try:
            d = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def safe_link(link, domain):
    """Solo enlaces http(s) al propio periódico (el feed no puede colar otra web)."""
    u = urlparse((link or "").strip())
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not (host == domain or host.endswith("." + domain)):
        return None
    return u._replace(scheme="https").geturl()


def items(name, url, domain, now):
    root = ET.fromstring(fetch(url))
    out = []
    for it in root.iter("item"):
        title = headline(clean(it.findtext("title")))
        link = safe_link(it.findtext("link"), domain)
        date = parse_date(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date") or "")
        if not title or len(title) < 25 or not link:
            continue
        if date and (now - date > MAX_AGE or date - now > timedelta(hours=2)):
            continue
        out.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:10],
            "titular": title,
            "fuente": name,
            "url": link,
            "fecha": (date or now).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        })
        if len(out) >= PER_SOURCE:
            break
    return out


def words(title):
    t = unicodedata.normalize("NFD", title.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return {w for w in re.findall(r"[a-z0-9]+", t) if len(w) > 3}


def same_story(a, b):
    shared = len(a & b)
    return shared >= 3 and shared / max(1, min(len(a), len(b))) >= 0.4


def main():
    now = datetime.now(timezone.utc)
    per_source = []
    for name, url, domain in FEEDS:
        try:
            got = items(name, url, domain, now)
            print(f"  ✓ {name}: {len(got)}")
            if got:
                per_source.append(got)
        except Exception as e:  # un periódico caído no tumba al resto
            print(f"  ⚠ {name}: {e}", file=sys.stderr)

    # portada alternando periódicos: el 1º de cada uno, luego el 2º…
    merged, seen_urls, seen_words = [], set(), []
    for rank in range(max((len(s) for s in per_source), default=0)):
        for src in per_source:
            if rank >= len(src):
                continue
            n = src[rank]
            w = words(n["titular"])
            # la misma noticia contada por dos periódicos: se queda la primera
            if n["url"] in seen_urls or any(same_story(w, o) for o in seen_words):
                continue
            seen_urls.add(n["url"])
            seen_words.append(w)
            merged.append(n)
    merged = merged[:MAX_ITEMS]

    if len(merged) < 10:
        sys.exit(f"Solo {len(merged)} titulares: no se toca noticias.json")

    try:
        with open(OUT, encoding="utf-8") as f:
            if json.load(f).get("noticias") == merged:
                print("Sin cambios")
                return
    except (OSError, ValueError):
        pass
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"actualizado": now.isoformat(timespec="seconds").replace("+00:00", "Z"), "noticias": merged},
                  f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(merged)} titulares → noticias.json")


if __name__ == "__main__":
    main()
