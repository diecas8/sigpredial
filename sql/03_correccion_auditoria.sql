-- =====================================================================
--  SIP-CBS · Corrección: auditoría compatible con QGIS / QField
--  Antes, la auditoría usaba auth.uid(), que el usuario sig_editor
--  no puede llamar. Esta función hace lo mismo sin depender del
--  esquema "auth": devuelve el usuario de la app web, o NULL cuando
--  se edita desde QGIS/QField.
--  Se puede ejecutar varias veces. No borra datos.
-- =====================================================================
set search_path = productores, extensions, public;

create or replace function productores.usuario_actual()
returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(
           coalesce(
             nullif(current_setting('request.jwt.claim.sub', true), ''),
             (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
           ), '')::uuid
$$;

grant execute on function productores.usuario_actual() to anon, authenticated, service_role, sig_editor, arcgis_lector;

create or replace function productores.tg_auditoria()
returns trigger
language plpgsql
set search_path = productores, extensions, public
as $$
begin
  new.editado_por := productores.usuario_actual();
  new.editado_en  := now();
  return new;
end $$;

alter table productores.productor alter column creado_por set default productores.usuario_actual();
alter table productores.predio    alter column creado_por set default productores.usuario_actual();
alter table productores.lote      alter column creado_por set default productores.usuario_actual();
