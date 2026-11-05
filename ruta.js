// ---------- Las páginas de los bares, sin una carpeta por bar (CAF-37) ----------
// GitHub Pages sirve 404.html para cualquier dirección que no existe, así que cafecita.app/<bar>/
// la pinta 404.html con este script: lee el bar de la dirección y carga la página de siempre.
// La gestión y lo de imprimir viven en /gestion/?bar=<bar> y /imprimir/?bar=<bar>: las
// direcciones de antes (cafecita.app/<bar>/gestion/) llevan allí, con su #codigo=… si lo traen.
// Es un script normal (no un módulo) para que el bar esté puesto antes de que arranquen los módulos.
(() => {
  const b = document.body;
  if (b.dataset.bar) return; // un bar con carpeta propia (la demo de Bar Manolo)
  const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
  // direcciones que no son de un bar (la misma lista está en worker/src/index.js)
  const RESERVADOS = ['404', 'admin', 'alta', 'api', 'app', 'apple-touch-icon', 'assets', 'ayuda', 'bar', 'bares', 'barmanolo',
    'blog', 'cafecita', 'carta', 'cname', 'demo', 'favicon', 'fonts', 'gestion', 'hola', 'img', 'imprimir', 'index', 'legal',
    'logo', 'models', 'napkins', 'og', 'precios', 'servilletero', 'static', 'stories', 'templates', 'tienda', 'tools', 'vendor',
    'worker', 'www'];

  // /gestion/ y /imprimir/: el bar viene en ?bar=
  if (b.dataset.ruta === 'pagina') {
    const bar = new URLSearchParams(location.search).get('bar') || '';
    if (ID.test(bar)) b.dataset.bar = bar;
    else location.replace('/carta/');
    return;
  }

  // 404.html: cafecita.app/<bar>/, /<bar>/gestion/ o /<bar>/imprimir/
  const m = location.pathname.match(/^\/([a-z0-9-]{1,40})(?:\/(gestion|imprimir))?\/?$/i);
  const bar = m?.[1].toLowerCase();
  if (!m || !ID.test(bar) || RESERVADOS.includes(bar)) { location.replace('/'); return; }
  if (m[2]) {
    const q = new URLSearchParams(location.search);
    q.set('bar', bar);
    location.replace(`/${m[2].toLowerCase()}/?${q}${location.hash}`);
    return;
  }
  // siempre la misma dirección: en minúsculas y con la barra final
  const canon = `/${bar}/`;
  if (location.pathname !== canon) history.replaceState(null, '', canon + location.search + location.hash);
  b.dataset.bar = bar;
  // los módulos de la página del bar, en orden (la carta antes que el servilletero)
  for (const src of ['carta.js?v=8', 'carga.js?v=2', 'main.js?v=32']) {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = src;
    s.async = false;
    document.body.append(s);
  }
})();
