# API de cafecita.app (Cloudflare Workers + D1)

Los titulares y la analítica no viven en el repo: los sirve el Worker `cafecita-api` con una base
D1 llamada `cafecita`. Plan gratuito: 100.000 peticiones al día, 5 GB, 5 M de filas leídas y
100.000 escritas al día, y no se pausa nunca. Antes estaba en Supabase (ver el historial de git).

- **`GET /noticias`**: la portada, guardada como una sola fila JSON (`portada`) para que cada
  visita lea una fila y no 160. Cada copia del Worker la guarda además un minuto en memoria.
- **`GET /hemeroteca?id=…`**: cada titular que ha pasado por portada, para que
  `cafecita.app/?s=<id>` siga abriendo la noticia compartida días después.
- **`POST /registrar`**: eventos de analítica de `medir.js`, en tandas de como mucho 25. La web
  los manda como texto plano para que el navegador no haga antes una petición OPTIONS.
- **`GET /bar?id=…`**, **`POST /bar/entrar`** y **`PUT /bar?id=…`**: la ficha de cada bar; cambiarla pide su código.
- **`GET /bar/libre?id=…`** y **`POST /bar/alta`**: el alta de un bar desde `cafecita.app/alta/` (CAF-37). El bar
  elige su dirección y recibe su código en pantalla (solo se guarda su SHA-256). Hasta el 31 de enero de 2027
  entra con Pro. Como mucho 5 altas al día por conexión y 40 en total (tabla `altas`, que guarda un resumen
  de la IP y el día y se vacía a la semana). Sus páginas no necesitan carpeta: las sirve `404.html` (`ruta.js`).
- **`POST /bar/foto?id=…`**: sube la foto de un plato (solo bares Pro, con su código): WebP o JPEG de menos
  de 200 KB, hasta 150 por bar. Devuelve su id. **`GET /foto?bar=…&id=…`** la sirve con caché de un año.
  Viven en la tabla `fotos` de D1; si un día no caben, se pasan a R2.
- **Cron `7,37 * * * *`**: lee los RSS (`FEEDS` en `src/index.js`), quita duplicados, alterna
  periódicos y rehace la portada. `POST /refrescar` hace lo mismo a mano, como mucho una vez cada 10 min.

## Comandos (desde `worker/`)

```bash
npm install
npx wrangler login                       # una vez
npm run dev                              # en local: http://localhost:8787, cron en /__scheduled
npm run deploy                           # sube el Worker
npx wrangler tail                        # registros en directo (avisa si el cron se pasa de CPU)
```

Esquema: `schema.sql` (se puede volver a pasar, no borra nada): `npm run esquema`.

## Altas de bares

Cualquiera puede dar de alta un bar en `cafecita.app/alta/`, así que conviene mirar de vez en cuando
las nuevas (por si alguien ocupa el nombre de un bar que no es suyo o lo llena de pruebas):

```bash
npx wrangler d1 execute cafecita --remote --command "select bar, creada from altas order by creada desc"
npx wrangler d1 execute cafecita --remote --command "select id, plan, json_extract(datos, '$.nombre') as nombre, contacto, actualizado from bares order by actualizado desc"
```

Para quitar un bar (su ficha y sus fotos; su dirección queda libre otra vez):

```bash
npx wrangler d1 execute cafecita --remote --command "delete from fotos where bar = '<id>'; delete from bares where id = '<id>'"
```

Si un bar pierde su código: `npm run alta -- <id> --nuevo-codigo`.

## Métricas

```bash
npx wrangler d1 execute cafecita --remote --command "select * from diario"
npx wrangler d1 execute cafecita --remote --command "select * from retencion"
```

`diario`: usuarios, nuevos, visitas, servilletas, enlaces y compartidas por día (hora de Madrid).
`retencion`: qué % de cada cohorte vuelve al día 1, 7 y 30. Sin cookies, sin IP y sin identificador:
el dispositivo solo recuerda el día de su primera visita (ver `medir.js`).
