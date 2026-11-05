// ---------- Alta de un bar (alta/index.html, CAF-37) ----------
// El bar escribe su nombre, elige su dirección (cafecita.app/<id>/, se comprueba que esté libre
// mientras escribe) y recibe su código de acceso en pantalla, una sola vez. El código se queda
// recordado en este navegador, así que «Entrar en mi gestión» entra directamente.
import { medir, API as API_PROD } from './medir.js?v=14';

// en local se puede probar contra el Worker de wrangler dev, como en bar.js
const API = (() => {
  try { if (location.hostname === 'localhost' && localStorage.getItem('cafecita.api') === 'local') return 'http://localhost:8787'; } catch {}
  return API_PROD;
})();
const $ = (id) => document.getElementById(id);
const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

medir('visita', { origen: `alta:${document.referrer ? new URL(document.referrer).hostname : 'directo'}`.slice(0, 40) });

// «Bar Casa Pepe» → «barcasapepe»: sin tildes, sin espacios y en minúsculas
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '').slice(0, 40);
// lo que se escribe en la dirección: minúsculas, números y guiones sueltos
const limpiar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-/, '').slice(0, 40);

const nombre = $('aNombre'), idInput = $('aId'), libreMsg = $('aLibre'), err = $('aError'), crear = $('aCrear');
let tocado = false;   // si el bar ya ha cambiado la dirección a mano, el nombre no la pisa
let libre = null;     // ¿la dirección de ahora está libre? (null: aún no se sabe)
let comprobando = 0;

function estado(texto, ok) {
  libreMsg.textContent = texto;
  libreMsg.className = `a-libre${ok === true ? ' ok' : ok === false ? ' mal' : ''}`;
}

// se pregunta al servidor un poco después de dejar de escribir
let timer = null;
function comprobar() {
  clearTimeout(timer);
  libre = null;
  const id = idInput.value.replace(/-$/, '');
  if (!id) { estado(''); return; }
  if (!ID.test(id)) { libre = false; estado('Usa letras, números y guiones (de 2 a 40).', false); return; }
  estado('Comprobando…');
  timer = setTimeout(async () => {
    const n = ++comprobando;
    const r = await fetch(`${API}/bar/libre?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
      .then((x) => x.json()).catch(() => null);
    if (n !== comprobando) return; // ya se ha escrito otra cosa
    if (!r) { estado('No hay conexión. Lo comprobaremos al crearla.'); return; }
    libre = r.libre;
    estado(r.libre ? `cafecita.app/${id} está libre.` : r.motivo, r.libre);
  }, 350);
}

nombre.addEventListener('input', () => {
  if (tocado) return;
  idInput.value = slug(nombre.value);
  comprobar();
});
idInput.addEventListener('input', () => {
  tocado = idInput.value !== '';
  const pos = idInput.selectionStart, antes = idInput.value.length;
  idInput.value = limpiar(idInput.value);
  idInput.setSelectionRange(pos - (antes - idInput.value.length), pos - (antes - idInput.value.length));
  comprobar();
});

function fallo(texto, campo) {
  err.textContent = texto;
  err.hidden = false;
  campo?.focus();
}

$('aAlta').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const id = idInput.value.replace(/-$/, '');
  if (nombre.value.trim().length < 2) return fallo('Escribe el nombre de tu bar.', nombre);
  if (!ID.test(id)) return fallo('Elige la dirección de tu página: letras, números y guiones.', idInput);
  if (libre === false) return fallo('Esa dirección no está libre: prueba con otra.', idInput);
  if (!$('aAcepto').checked) return fallo('Marca que has leído el aviso legal y la privacidad.', $('aAcepto'));

  crear.disabled = true;
  crear.textContent = 'Creando tu página…';
  const r = await fetch(`${API}/bar/alta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: nombre.value.trim(), id, direccion: $('aDireccion').value.trim(), whatsapp: $('aWhatsapp').value.trim(), acepto: true, web: $('aWeb').value }),
    signal: AbortSignal.timeout(10000),
  }).then((x) => x.json()).catch(() => null);
  crear.disabled = false;
  crear.textContent = 'Crear mi página';
  if (!r) return fallo('No hay conexión. Prueba otra vez en un momento.');
  if (!r.ok) {
    if (/dirección/.test(r.error || '')) { libre = false; estado(r.error, false); }
    if (/WhatsApp/.test(r.error || '')) return fallo(r.error, $('aWhatsapp'));
    return fallo(r.error || 'No se ha podido dar de alta. Escríbenos a hola@cafecita.es.');
  }
  hecho(r.id, r.codigo);
});

function hecho(id, codigo) {
  // la gestión lo recuerda en este navegador (la misma clave que gestion.js)
  try { localStorage.setItem(`cafecita.acceso.${id}`, codigo); } catch {}
  medir('enlace', { a: 'alta:hecha', bar: id });
  $('aCodigo').textContent = codigo;
  $('aEntrar').href = `/gestion/?bar=${id}#codigo=${codigo}`;
  const pagina = $('aPagina');
  pagina.href = `/${id}/`;
  pagina.textContent = `cafecita.app/${id}`;
  $('aForm').hidden = true;
  $('aHecho').hidden = false;
  $('aHechoTitle').focus();
  window.scrollTo({ top: 0 });
  // si cierra la pestaña sin guardar el código, se lo recordamos una vez
  addEventListener('beforeunload', avisar);
  $('aEntrar').addEventListener('click', () => removeEventListener('beforeunload', avisar));
}
function avisar(e) { e.preventDefault(); }

$('aCopiar').addEventListener('click', async () => {
  const b = $('aCopiar');
  try {
    await navigator.clipboard.writeText($('aCodigo').textContent);
    b.textContent = 'Copiado';
  } catch {
    // sin portapapeles: se selecciona para copiarlo a mano
    getSelection().selectAllChildren($('aCodigo'));
    b.textContent = 'Selecciónalo y cópialo';
  }
  setTimeout(() => { b.textContent = 'Copiar el código'; }, 2500);
});
