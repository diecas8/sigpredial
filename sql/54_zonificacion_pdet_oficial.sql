-- =====================================================================
-- 54 · Zonificación ambiental PDET completa (bases técnicas MADS, BTZA)
-- ---------------------------------------------------------------------
-- La capa que venía con las determinantes de Corpoamazonia (grupo
-- «Zonificación ambiental (bases técnicas MADS)») solo trae 5 categorías
-- y únicamente para los 8 municipios de Caquetá. Esta es la capa oficial
-- completa del Plan de Zonificación Ambiental PDET 2021, con sus 9
-- categorías, para los 12 municipios del proyecto (8 de Caquetá y 4 del
-- Meta). Se guarda como un grupo aparte; lo de Corpoamazonia no se toca.
--
-- Los GeoJSON salen de scripts/btza/preparar_btza.py y quedan en
-- scripts/determinantes/datos/btza/<cod>[_parte].geojson.
--
-- Carga, archivo por archivo:
--   select net.http_get('https://raw.githubusercontent.com/diecas8/sigpredial/<rama>/scripts/determinantes/datos/btza/18785.geojson',
--                       timeout_milliseconds := 120000);
--   select * from productores.cargar_determinantes_grupo(<id>);
--
-- Los avisos del plan de acción por lote (sql/42) pasan a leer este
-- grupo, que cubre también el Meta.
-- =====================================================================

-- Como cargar_determinantes (sql/38b), pero solo reemplaza las categorías
-- de los grupos que trae el archivo: no borra las demás determinantes del
-- municipio y permite partir un municipio grande en varios archivos.
create or replace function productores.cargar_determinantes_grupo(p_respuesta bigint)
returns table (cod_mpio text, grupo text, categoria text, filas bigint, area_ha numeric)
language plpgsql security definer
set search_path to 'productores', 'extensions', 'public'
as $$
declare
  gj jsonb;
begin
  if not (productores.es_admin() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'Solo el administrador carga determinantes';
  end if;
  select r.content::jsonb into gj from net._http_response r
   where r.id = p_respuesta and r.status_code = 200;
  if gj is null then
    raise exception 'La descarga % no está lista o falló; revise net._http_response', p_respuesta;
  end if;

  drop table if exists _llave;
  create temp table _llave on commit drop as
    select distinct f->'properties'->>'cod_mpio' as cod_mpio, f->'properties'->>'grupo' as grupo,
           f->'properties'->>'categoria' as categoria
      from jsonb_array_elements(gj->'features') f;

  delete from productores.determinante d
   using _llave k where d.cod_mpio = k.cod_mpio and d.grupo = k.grupo and d.categoria = k.categoria;

  insert into productores.determinante (cod_mpio, grupo, categoria, indicacion, nivel, orden, capa_origen, fuente, geom)
  select p->>'cod_mpio', p->>'grupo', p->>'categoria', p->>'indicacion', (p->>'nivel')::smallint,
         (p->>'orden')::smallint, p->>'capa_origen', p->>'fuente',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(s.g), 3))
    from jsonb_array_elements(gj->'features') f
   cross join lateral (select f->'properties' as p) x
   cross join lateral ST_Subdivide(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326)), 256) s(g)
   where not ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(s.g), 3));

  return query
    select d.cod_mpio::text, d.grupo, d.categoria, count(*), round(sum(productores.area_ha(d.geom)), 1)
      from productores.determinante d join _llave k
        on d.cod_mpio = k.cod_mpio and d.grupo = k.grupo and d.categoria = k.categoria
     group by 1, 2, 3 order by 1, 3;
end $$;
revoke all on function productores.cargar_determinantes_grupo(bigint) from public, anon, authenticated;

-- Avisos por lote (sql/42): ahora con la capa PDET completa.
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
        on d.cod_mpio = l.cod_mpio and d.grupo = 'Zonificación ambiental PDET (MADS, 2021)'
       and d.geom && l.geom and ST_Intersects(d.geom, l.geom)
     group by l.id, l.ha, d.categoria
  )
  select id, categoria, round(100 * ha_zona / nullif(ha, 0), 1), round(ha_zona, 4)
    from x where ha > 0 and ha_zona / ha >= 0.01
   order by 1, 3 desc
$$;
revoke all on function productores.zonificacion_lotes(uuid) from public, anon;
grant execute on function productores.zonificacion_lotes(uuid) to authenticated;

-- Para quitarlo:
--   delete from productores.determinante where grupo = 'Zonificación ambiental PDET (MADS, 2021)';
--   y volver a correr sql/42 (grupo «Zonificación ambiental (bases técnicas MADS)»).
