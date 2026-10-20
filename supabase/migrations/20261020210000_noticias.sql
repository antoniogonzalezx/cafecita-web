-- Titulares del día para cafecita.app. Los escribe la función noticias-refrescar
-- (con la clave de servicio, que se salta RLS); la web solo puede leerlos.
create table if not exists public.noticias (
  id          text primary key,           -- sha1 del enlace (10 caracteres): la web recuerda cuáles ha visto
  titular     text not null,
  fuente      text not null,
  url         text not null check (url like 'https://%'),
  fecha       timestamptz not null,
  orden       integer not null,           -- portada alternando periódicos
  actualizado timestamptz not null default now()
);

create index if not exists noticias_orden_idx on public.noticias (orden);

alter table public.noticias enable row level security;

drop policy if exists "noticias: lectura pública" on public.noticias;
create policy "noticias: lectura pública" on public.noticias
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.noticias from anon, authenticated;

-- Refresco cada media hora: pg_cron llama a la función por HTTP (pg_net).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;  -- sus funciones quedan en net.*

select cron.unschedule('noticias-refrescar') where exists (select 1 from cron.job where jobname = 'noticias-refrescar');
select cron.schedule(
  'noticias-refrescar',
  '7,37 * * * *',
  $$ select net.http_post(
       url := 'https://xnrjddrkecwdqgrjcqyr.supabase.co/functions/v1/noticias-refrescar',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     ) $$
);
