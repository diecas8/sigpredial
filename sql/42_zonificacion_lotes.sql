-- =====================================================================
-- 42 · Zonificación ambiental (bases técnicas MADS, capa BTZA) por lote
-- ---------------------------------------------------------------------
-- Para los avisos del plan de acción: qué porcentaje de cada lote (actual
-- o de la finca soñada) cae en cada categoría de la zonificación ambiental.
-- El portal decide con esos porcentajes:
--   · 70 % o más  → aviso claro
--   · 10 % a 70 % → aviso suave («parte del lote»)
--   · menos de 10 % → nada (a escala 1:100.000 es error del borde)
-- Solo orienta; no bloquea nada. Los permisos se revisan con ve_predio.
-- =====================================================================

create or replace function productores.zonificacion_lotes(p_predio uuid)
returns table (lote_id uuid, categoria text, pct numeric, area_ha numeric)
language sql stable security definer
set search_path to 'productores', 'extensions', 'public'
as $$
  with l as (
    select l.id, l.geom, p.cod_mpio, productores.area_ha(l.geom) as ha
      from productores.lote l join productores.predio p on p.id = l.predio_id
     where l.predio_id = p_predio and l.geom is not null and productores.ve_predio(p_predio)
  ),
  x as (
    select l.id, l.ha, d.categoria,
           productores.area_ha(ST_Union(ST_CollectionExtract(ST_Intersection(d.geom, l.geom), 3))) as ha_zona
      from l join productores.determinante d
        on d.cod_mpio = l.cod_mpio and d.grupo = 'Zonificación ambiental (bases técnicas MADS)'
       and d.geom && l.geom and ST_Intersects(d.geom, l.geom)
     group by l.id, l.ha, d.categoria
  )
  select id, categoria, round(100 * ha_zona / nullif(ha, 0), 1), round(ha_zona, 4)
    from x where ha > 0 and ha_zona / ha >= 0.01
   order by 1, 3 desc
$$;
revoke all on function productores.zonificacion_lotes(uuid) from public, anon;
grant execute on function productores.zonificacion_lotes(uuid) to authenticated;
