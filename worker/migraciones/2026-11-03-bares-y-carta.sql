-- 2026-11-03: «carta» entre los eventos permitidos y fichas de los bares.
-- Se lanza una vez: npx wrangler d1 execute cafecita --remote --file=migraciones/2026-11-03-bares-y-carta.sql

-- 1. SQLite no deja cambiar un check: se rehace la tabla de eventos con «carta» y se copian las filas
create table eventos_nueva (
  id     integer primary key,
  creado text not null,
  dia    text not null,
  evento text not null check (evento in ('visita', 'dia', 'servilleta', 'enlace', 'compartir', 'bola', 'bienvenida', 'carta')),
  datos  text not null default '{}' check (json_valid(datos) and json_type(datos) = 'object' and length(datos) < 512)
);
insert into eventos_nueva (id, creado, dia, evento, datos) select id, creado, dia, evento, datos from eventos;
drop view if exists diario;
drop view if exists retencion;
drop table eventos;
alter table eventos_nueva rename to eventos;

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

-- 2. La ficha de cada bar (lo que cambia en su gestión) y su acceso.
-- El plan lo pone Cafecita, no el bar: va en su columna y el Worker no deja tocarlo desde la gestión.
-- Del código de acceso solo se guarda su SHA-256: el código lo tiene el bar (y quien se lo dio).
create table if not exists bares (
  id          text primary key check (length(id) between 2 and 40 and id not glob '*[^a-z0-9-]*'),
  datos       text not null check (json_valid(datos) and json_type(datos) = 'object'),
  plan        text not null default 'gratis' check (plan in ('gratis', 'pro')),
  codigo      text not null check (length(codigo) = 64),
  actualizado text not null
) without rowid;
