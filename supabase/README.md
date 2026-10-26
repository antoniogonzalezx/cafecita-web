# Noticias de cafecita.app

Los titulares no viven en este repo: los sirve Supabase (proyecto `cafecita`, ref `xnrjddrkecwdqgrjcqyr`)
y la web los lee al cargar, así que se renuevan sin tocar el código ni desplegar nada.

- **Tabla `public.noticias`** — `migrations/20261020210000_noticias.sql`. Lectura pública por RLS;
  escribir solo puede la función, con la clave de servicio.
- **Función `noticias-refrescar`** — `functions/noticias-refrescar/index.ts`. Lee los RSS de los
  periódicos, quita duplicados, alterna fuentes y reemplaza la tabla. Como mucho un refresco cada
  10 min, así que no hace falta protegerla (`verify_jwt: false`).
- **pg_cron** — el job `noticias-refrescar` la llama a los minutos 7 y 37 de cada hora.

Añadir o quitar un periódico: editar `FEEDS` en la función y volver a desplegarla.

Ojo: en el plan gratuito, Supabase pausa el proyecto si pasa una semana sin uso. Las visitas a la
web cuentan como uso; si se pausa, la web muestra el aviso de reponer servilletas hasta reactivarlo
desde el panel.

## Analítica y hemeroteca

`migrations/20261026120000_analitica_y_hemeroteca.sql`.

- **Eventos** — la web (`medir.js`) llama a `public.registrar(eventos)`, que guarda en
  `analitica.eventos` (esquema que la API no expone). Sin cookies, sin IP y sin identificador: el
  dispositivo solo recuerda el día de su primera visita y manda un `dia` la primera vez que abre cada día.
  Eventos: `visita` (con `origen`: `compartida`, `?o=…` o la web de la que viene), `dia`, `servilleta`,
  `enlace` («Leer en…» o el anuncio), `compartir`, `bola`, `bienvenida`. En local no se manda nada
  salvo con `?medir`.
- **Métricas** — en el editor SQL: `select * from analitica.diario;` (usuarios, nuevos, servilletas,
  enlaces, compartidas por día) y `select * from analitica.retencion;` (qué % vuelve al día 1, 7 y 30).
- **Hemeroteca** — `public.hemeroteca` guarda cada titular que pasa por portada (lo copia un disparador
  sobre `noticias`), para que `cafecita.app/?s=<id>` siga abriendo la noticia compartida días después.
