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
