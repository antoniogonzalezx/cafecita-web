-- Analítica propia, sin cookies ni identificadores: la web manda eventos sueltos («se ha sacado una
-- servilleta», «se ha compartido») y, una vez al día por dispositivo, cuántos días han pasado desde su
-- primera visita. Con eso salen usuarios diarios y retención sin saber quién es nadie. Ni IP ni id.
--
-- Los eventos viven en el esquema «analitica», que la API no expone: la web solo puede llamar a
-- public.registrar(), que valida y escribe. Leer se lee desde el panel o con SQL (vistas de abajo).
create schema if not exists analitica;
revoke all on schema analitica from anon, authenticated;

create table if not exists analitica.eventos (
  id      bigint generated always as identity primary key,
  creado  timestamptz not null default now(),
  evento  text not null check (evento in ('visita', 'dia', 'servilleta', 'enlace', 'compartir', 'bola', 'bienvenida')),
  datos   jsonb not null default '{}' check (jsonb_typeof(datos) = 'object' and pg_column_size(datos) < 512)
);
create index if not exists eventos_creado_idx on analitica.eventos (creado);
alter table analitica.eventos enable row level security;  -- sin políticas: nadie entra por la API

-- La web manda los eventos en tandas: [{"e": "servilleta", "d": {...}}, ...] (como mucho 25).
-- Lo que no cumple las reglas de la tabla se descarta sin tumbar el resto de la tanda.
create or replace function public.registrar(eventos jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into analitica.eventos (evento, datos)
  select e->>'e', coalesce(e->'d', '{}'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(eventos) = 'array' then eventos else '[]'::jsonb end) with ordinality as t(e, i)
  where i <= 25
    and e->>'e' in ('visita', 'dia', 'servilleta', 'enlace', 'compartir', 'bola', 'bienvenida')
    and jsonb_typeof(coalesce(e->'d', '{}'::jsonb)) = 'object'
    and pg_column_size(coalesce(e->'d', '{}'::jsonb)) < 512;
$$;
revoke all on function public.registrar(jsonb) from public;
grant execute on function public.registrar(jsonb) to anon, authenticated;

-- Usuarios distintos por día: cada dispositivo manda un «dia» la primera vez que abre cada día
create or replace view analitica.diario as
select (creado at time zone 'Europe/Madrid')::date as fecha,
       count(*) filter (where evento = 'dia')                                   as usuarios,
       count(*) filter (where evento = 'dia' and (datos->>'desde')::int = 0)    as nuevos,
       count(*) filter (where evento = 'visita')                                as visitas,
       count(*) filter (where evento = 'servilleta')                            as servilletas,
       count(*) filter (where evento = 'enlace')                                as enlaces,
       count(*) filter (where evento = 'compartir')                             as compartidas,
       count(*) filter (where evento = 'visita' and datos->>'origen' = 'compartida') as llegadas_compartidas
from analitica.eventos
group by 1
order by 1 desc;

-- Retención por cohorte (día de la primera visita): qué parte vuelve al día 1, 7 y 30
create or replace view analitica.retencion as
select datos->>'primera' as cohorte,
       count(*) filter (where (datos->>'desde')::int = 0)  as nuevos,
       round(100.0 * count(*) filter (where (datos->>'desde')::int = 1)  / nullif(count(*) filter (where (datos->>'desde')::int = 0), 0), 1) as d1,
       round(100.0 * count(*) filter (where (datos->>'desde')::int = 7)  / nullif(count(*) filter (where (datos->>'desde')::int = 0), 0), 1) as d7,
       round(100.0 * count(*) filter (where (datos->>'desde')::int = 30) / nullif(count(*) filter (where (datos->>'desde')::int = 0), 0), 1) as d30
from analitica.eventos
where evento = 'dia'
group by 1
order by 1 desc;

-- Hemeroteca: cada titular que pasa por la portada se guarda aquí para siempre, para que el enlace
-- de una servilleta compartida siga abriendo su noticia cuando ya ha salido de public.noticias.
-- La rellena un disparador, así que la función noticias-refrescar no cambia.
create table if not exists public.hemeroteca (
  id       text primary key,
  titular  text not null,
  fuente   text not null,
  url      text not null check (url like 'https://%'),
  fecha    timestamptz not null
);
alter table public.hemeroteca enable row level security;
drop policy if exists "hemeroteca: lectura pública" on public.hemeroteca;
create policy "hemeroteca: lectura pública" on public.hemeroteca
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.hemeroteca from anon, authenticated;

create or replace function public.archivar_noticia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hemeroteca (id, titular, fuente, url, fecha)
  values (new.id, new.titular, new.fuente, new.url, new.fecha)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.archivar_noticia() from public, anon, authenticated;

drop trigger if exists noticias_archivar on public.noticias;
create trigger noticias_archivar after insert or update on public.noticias
  for each row execute function public.archivar_noticia();

-- las que ya están en portada
insert into public.hemeroteca (id, titular, fuente, url, fecha)
select id, titular, fuente, url, fecha from public.noticias
on conflict (id) do nothing;
