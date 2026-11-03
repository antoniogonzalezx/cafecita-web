// ---------- Analítica propia, sin cookies ----------
// Eventos sueltos a la API de Cloudflare (POST /registrar, ver worker/), sin IP ni identificador.
// Para saber cuántos vuelven, el dispositivo solo guarda el día de su primera visita:
// la primera vez que abre cada día manda un «dia» con los días que han pasado desde entonces.
// En local no manda nada (lo enseña en la consola) salvo con ?medir.
export const API = 'https://cafecita-api.cafecita-api.workers.dev';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const ON = !LOCAL || new URLSearchParams(location.search).has('medir');
const BATCH = 25; // lo mismo que acepta registrar()

let queue = [], timer = null;
function flush() {
  clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const eventos = queue.splice(0, BATCH);
    if (!ON) { console.debug('[medir]', eventos); continue; }
    // como texto plano y sin cabeceras: así el navegador no manda antes una petición OPTIONS,
    // que también contaría en el cupo diario del Worker
    fetch(`${API}/registrar`, { method: 'POST', keepalive: true, body: JSON.stringify({ eventos }) }).catch(() => {});
  }
}
// al cambiar de app o cerrar la pestaña sale lo que quede
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);

export function medir(e, d = {}) {
  queue.push({ e, d });
  if (queue.length >= BATCH) flush();
  else timer ??= setTimeout(flush, 4000);
}

const DAYS_KEY = 'cafecita.dias.v1';
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// hoy: «AAAA-MM-DD» local. conocido: ya había sacado servilletas antes de que existiera esto,
// así que no es nuevo, pero tampoco se sabe su primer día (no entra en la retención).
export function visita({ hoy, conocido, origen }) {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DAYS_KEY)); } catch {}
  if (!d || typeof d.primera !== 'string') d = { primera: conocido ? 'antes' : hoy, ultima: null, dias: 0 };
  if (d.ultima !== hoy) {
    d.ultima = hoy;
    d.dias++;
    const desde = d.primera === 'antes' ? undefined : daysBetween(d.primera, hoy);
    medir('dia', { primera: d.primera, desde, dias: d.dias });
    try { localStorage.setItem(DAYS_KEY, JSON.stringify(d)); } catch {}
  }
  medir('visita', { origen, nuevo: d.dias === 1 && d.primera === hoy, pwa: matchMedia('(display-mode: standalone)').matches });
}
