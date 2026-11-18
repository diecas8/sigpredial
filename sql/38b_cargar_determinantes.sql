-- =====================================================================
-- 38b · Cargar las determinantes de un municipio desde el repositorio
-- ---------------------------------------------------------------------
-- El GeoJSON lo genera scripts/determinantes/preparar.py y queda en
-- scripts/determinantes/datos/<cod_mpio>.geojson. La base lo descarga
-- de GitHub (pg_net), borra lo que hubiera de ese municipio y lo carga
-- partido en pedazos de máximo 256 vértices.
--
-- Paso 1: pedir el archivo (cambie el código y la rama):
--   select net.http_get('https://raw.githubusercontent.com/diecas8/sigpredial/main/scripts/determinantes/datos/18785.geojson',
--                       timeout_milliseconds := 60000);
-- Paso 2 (unos segundos después), con el id que devolvió el paso 1:
--   select productores.cargar_determinantes(<id>);
-- =====================================================================

create or replace function productores.cargar_determinantes(p_respuesta bigint)
returns table (cod_mpio text, filas bigint, area_ha numeric)
language plpgsql security definer
set search_path to 'productores', 'extensions', 'public'
as $$
declare
  gj jsonb;
  cods text[];
begin
  if not (productores.es_admin() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'Solo el administrador carga determinantes';
  end if;
  select r.content::jsonb into gj from net._http_response r
   where r.id = p_respuesta and r.status_code = 200;
  if gj is null then
    raise exception 'La descarga % no está lista o falló; revise net._http_response', p_respuesta;
  end if;
  select array_agg(distinct f->'properties'->>'cod_mpio') into cods from jsonb_array_elements(gj->'features') f;
  delete from productores.determinante d where d.cod_mpio = any (cods);

  insert into productores.determinante (cod_mpio, grupo, categoria, indicacion, nivel, orden, capa_origen, fuente, geom)
  select p->>'cod_mpio', p->>'grupo', p->>'categoria', p->>'indicacion', (p->>'nivel')::smallint,
         (p->>'orden')::smallint, p->>'capa_origen', p->>'fuente',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(s.g), 3))
    from jsonb_array_elements(gj->'features') f
   cross join lateral (select f->'properties' as p) x
   cross join lateral ST_Subdivide(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326), 256) s(g)
   where not ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(s.g), 3));

  return query
    select d.cod_mpio::text, count(*), round(sum(productores.area_ha(d.geom)), 1)
      from productores.determinante d where d.cod_mpio = any (cods) group by 1;
end $$;
revoke all on function productores.cargar_determinantes(bigint) from public, anon, authenticated;
