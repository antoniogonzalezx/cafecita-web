-- Base D1 «cafecita» (SQLite). Solo escribe el Worker; la web no la toca directamente.

-- Portada: los titulares del momento, en una sola fila JSON ya ordenada (alternando periódicos).
-- Así cada visita lee una fila y no 160, que el plan gratuito cuenta filas leídas.
create table if not exists portada (
  id          integer primary key check (id = 1),
  actualizado text not null,
  noticias    text not null check (json_valid(noticias))
);

-- Hemeroteca: cada titular que pasa por portada, para que cafecita.app/?s=<id> siga abriendo
-- la noticia compartida cuando ya ha salido de portada.
create table if not exists hemeroteca (
  id      text primary key,            -- sha1 del enlace (10 caracteres)
  titular text not null,
  fuente  text not null,
  url     text not null check (url like 'https://%'),
  fecha   text not null
) without rowid;

-- Analítica propia, sin cookies ni identificadores (ver medir.js). Sin índices: cada índice
-- cuenta como otra fila escrita y las vistas se miran de vez en cuando.
create table if not exists eventos (
  id     integer primary key,
  creado text not null,                -- ISO en UTC
  dia    text not null,                -- AAAA-MM-DD en hora de Madrid
  evento text not null check (evento in ('visita', 'dia', 'servilleta', 'enlace', 'compartir', 'bola', 'bienvenida', 'carta')),
  datos  text not null default '{}' check (json_valid(datos) and json_type(datos) = 'object' and length(datos) < 512)
);

-- Usuarios distintos por día: cada dispositivo manda un «dia» la primera vez que abre cada día
drop view if exists diario;
create view diario as
select dia as fecha,
       count(*) filter (where evento = 'dia')                                                as usuarios,
       count(*) filter (where evento = 'dia' and json_extract(datos, '$.desde') = 0)         as nuevos,
       count(*) filter (where evento = 'visita')                                             as visitas,
       count(*) filter (where evento = 'servilleta')                                         as servilletas,
       count(*) filter (where evento = 'enlace')                                             as enlaces,
       count(*) filter (where evento = 'compartir')                                          as compartidas,
       count(*) filter (where evento = 'carta')                                              as cartas,
       count(*) filter (where evento = 'visita' and json_extract(datos, '$.origen') = 'compartida') as llegadas_compartidas
from eventos
group by dia
order by dia desc;

-- Retención por cohorte (día de la primera visita): qué parte vuelve al día 1, 7 y 30
drop view if exists retencion;
create view retencion as
select json_extract(datos, '$.primera') as cohorte,
       count(*) filter (where json_extract(datos, '$.desde') = 0) as nuevos,
       round(100.0 * count(*) filter (where json_extract(datos, '$.desde') = 1)  / nullif(count(*) filter (where json_extract(datos, '$.desde') = 0), 0), 1) as d1,
       round(100.0 * count(*) filter (where json_extract(datos, '$.desde') = 7)  / nullif(count(*) filter (where json_extract(datos, '$.desde') = 0), 0), 1) as d7,
       round(100.0 * count(*) filter (where json_extract(datos, '$.desde') = 30) / nullif(count(*) filter (where json_extract(datos, '$.desde') = 0), 0), 1) as d30
from eventos
where evento = 'dia'
group by 1
order by 1 desc;

-- La ficha de cada bar (lo que cambia en su gestión) y su acceso.
-- El plan lo pone Cafecita, no el bar: va en su columna y el Worker no deja tocarlo desde la gestión.
-- Del código de acceso solo se guarda su SHA-256: el código lo tiene el bar (y quien se lo dio).
-- Altas: npm run alta -- <id> "<Nombre del bar>" [--pro]
create table if not exists bares (
  id          text primary key check (length(id) between 2 and 40 and id not glob '*[^a-z0-9-]*'),
  datos       text not null check (json_valid(datos) and json_type(datos) = 'object'),
  plan        text not null default 'gratis' check (plan in ('gratis', 'pro')),
  codigo      text not null check (length(codigo) = 64),
  actualizado text not null
) without rowid;
