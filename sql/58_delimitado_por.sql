-- =========================================================================
--  58 · Quién delimitó el predio
--
--   a) predio.delimitado_por: el usuario que dibujó el límite por primera vez.
--      Lo llena tg_predio_delimitado igual que delimitado_en; si se quita el límite
--      se borran los dos, y al editar el límite se conservan.
--   b) Datos de los 18 predios ya delimitados: el técnico que creó el primer lote
--      y, si no hay lotes, el último que editó el predio.
--   c) delimitador_del_predio(): nombre de quien delimitó, para quien ve el predio
--      (usuario_app solo lo leen coordinadores y administrador).
--   d) v_predio agrega delimitado_en y delimitado_por (nombre) al final.
-- =========================================================================

-- a) ------------------------------------------------------------------------------------
alter table productores.predio add column if not exists delimitado_por uuid;

create or replace function productores.tg_predio_delimitado()
 returns trigger language plpgsql
 set search_path to 'productores', 'extensions', 'public'
as $function$
begin
  if new.geom is null then
    new.delimitado_en := null;
    new.delimitado_por := null;
  elsif tg_op = 'INSERT' or old.geom is null then
    new.delimitado_en := now();
    new.delimitado_por := productores.usuario_actual();
  else
    new.delimitado_en := coalesce(old.delimitado_en, now());
    new.delimitado_por := coalesce(old.delimitado_por, new.delimitado_por);
  end if;
  return new;
end $function$;

-- b) ------------------------------------------------------------------------------------
update productores.predio p
   set delimitado_por = coalesce(
         (select l.creado_por from productores.lote l
           where l.predio_id = p.id and l.creado_por is not null
           order by l.creado_en limit 1),
         p.editado_por)
 where p.geom is not null and p.delimitado_por is null;

-- c) ------------------------------------------------------------------------------------
create or replace function productores.delimitador_del_predio(p_predio uuid)
 returns text language sql stable security definer
 set search_path to 'productores', 'public'
as $function$
  select ua.nombre
    from productores.predio p
    join productores.usuario_app ua on ua.user_id = p.delimitado_por
   where p.id = p_predio and productores.ve_predio(p.id);
$function$;
revoke execute on function productores.delimitador_del_predio(uuid) from public, anon;
grant execute on function productores.delimitador_del_predio(uuid) to authenticated;

-- d) ------------------------------------------------------------------------------------
create or replace view productores.v_predio with (security_invoker = true) as
 SELECT p.id, p.cod_predio, p.productor_id, p.nombre, p.num_predial, p.matricula, p.tenencia_id,
    t.nombre AS tenencia, p.area_declarada_ha, p.area_sig_ha, p.cod_mpio, m.nombre AS municipio,
    p.vereda_id, v.nombre AS vereda, p.altitud_msnm, p.como_llegar,
    extensions.st_y(p.punto) AS latitud, extensions.st_x(p.punto) AS longitud,
    extensions.st_asgeojson(p.geom, 7)::json AS geojson,
    pr.num_doc,
    TRIM(BOTH FROM (pr.nombres || ' ') || COALESCE(pr.apellidos, '')) AS productor,
    ( SELECT count(*) FROM productores.lote l WHERE l.predio_id = p.id AND l.escenario = 'actual') AS n_lotes,
    ( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) FROM productores.lote l
       WHERE l.predio_id = p.id AND l.escenario = 'actual') AS area_lotes_ha,
    p.creado_por, p.creado_en, p.editado_en,
    CASE WHEN p.geom IS NULL THEN 'Pendiente de delimitar' ELSE 'Delimitado' END AS estado_limite,
    v.validada AS vereda_validada, p.cod_humboldt,
    productores.nivel_calidad(rv.pendientes) AS calidad, rv.pendientes,
    p.dif_area_motivo, p.dif_area_nota,
    p.delimitado_en,
    CASE WHEN p.delimitado_por IS NOT NULL THEN productores.delimitador_del_predio(p.id) END AS delimitado_por
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id
     CROSS JOIN LATERAL ( SELECT productores.revision_predio(p.id) AS pendientes) rv;
