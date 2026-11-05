-- 2026-11-06: el WhatsApp que deja el bar al darse de alta, opcional (CAF-53).
-- No es público: leerBar no lo devuelve. Se lanza una vez:
--   npx wrangler d1 execute cafecita --remote --file=migraciones/2026-11-06-contacto.sql
alter table bares add column contacto text;
