-- 2026-11-05: altas de bares desde la web (CAF-37).
-- Se lanza una vez: npx wrangler d1 execute cafecita --remote --file=migraciones/2026-11-05-altas.sql
-- Una fila por alta, para limitar cuántas se hacen al día. De la conexión solo se guarda un
-- resumen (SHA-256 de la IP y el día) y las filas se borran a la semana.
create table if not exists altas (
  dia    text not null,                -- AAAA-MM-DD en hora de Madrid
  ip     text not null check (length(ip) = 64),
  bar    text not null,
  creada text not null
);
