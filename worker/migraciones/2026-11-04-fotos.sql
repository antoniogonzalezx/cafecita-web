-- 2026-11-04: fotos de los platos de la carta (CAF-43).
-- Se lanza una vez: npx wrangler d1 execute cafecita --remote --file=migraciones/2026-11-04-fotos.sql
create table if not exists fotos (
  bar    text not null,
  id     text not null check (length(id) = 32),
  tipo   text not null check (tipo in ('image/webp', 'image/jpeg')),
  datos  blob not null check (length(datos) <= 200000),
  creada text not null,
  primary key (bar, id)
);
