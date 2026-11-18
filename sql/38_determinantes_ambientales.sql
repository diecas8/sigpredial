-- =====================================================================
-- 38 · Determinantes ambientales de Corpoamazonia (cruce por predio)
-- ---------------------------------------------------------------------
-- Las determinantes se guardan una sola vez en la base, ya limpias y
-- simplificadas (5 m), partidas en pedazos pequeños para que el cruce
-- sea rápido. El técnico no carga capas: al abrir un predio, la base
-- le devuelve solo lo que cae dentro de su límite (o en el punto GPS
-- si todavía no está delimitado).
--
-- · determinante: una fila por pedazo (grupo, categoría, qué indica,
--   nivel 1 = restricción fuerte, 2 = manejo, 3 = precaución).
-- · determinantes_predio(predio): grupo, categoría, hectáreas dentro
--   del predio y la forma recortada para el mapa.
--
-- Los datos se cargan con scripts/determinantes/preparar.py.
-- Solo agrega objetos nuevos; para quitarlo:
--   drop function productores.determinantes_predio(uuid);
--   drop table productores.determinante;
-- =====================================================================

create table if not exists productores.determinante (
  id          bigserial primary key,
  cod_mpio    char(5) not null references productores.municipio (cod_mpio),
  grupo       text not null,
  categoria   text not null,
  indicacion  text not null,
  nivel       smallint not null check (nivel between 1 and 3),
  orden       smallint not null default 50,
  capa_origen text not null,
  fuente      text not null,
  geom        extensions.geometry(MultiPolygon, 4326) not null
);
create index if not exists ix_determinante_geom on productores.determinante using gist (geom);
create index if not exists ix_determinante_mpio on productores.determinante (cod_mpio);

alter table productores.determinante enable row level security;
drop policy if exists determinante_ver on productores.determinante;
create policy determinante_ver on productores.determinante for select to authenticated
  using (productores.ve_dpto(left(cod_mpio::text, 2)));
drop policy if exists determinante_admin on productores.determinante;
create policy determinante_admin on productores.determinante for all to authenticated
  using (productores.es_admin()) with check (productores.es_admin());
drop policy if exists determinante_sig on productores.determinante;
create policy determinante_sig on productores.determinante for all to sig_editor using (true) with check (true);
drop policy if exists determinante_arcgis on productores.determinante;
create policy determinante_arcgis on productores.determinante for select to arcgis_lector using (true);
grant select on productores.determinante to authenticated, arcgis_lector;
grant select, insert, update, delete on productores.determinante to sig_editor;
grant usage on sequence productores.determinante_id_seq to sig_editor;

-- Lo que aplica a un predio. Con límite: hectáreas y forma recortada
-- (se descartan astillas de menos de 0,01 ha). Sin límite: lo que cae
-- en el punto GPS, sin área.
create or replace function productores.determinantes_predio(p_predio uuid)
returns table (grupo text, categoria text, indicacion text, nivel smallint, orden smallint,
               fuente text, area_ha numeric, en_punto boolean, geojson json)
language sql stable security invoker
set search_path to 'productores', 'extensions', 'public'
as $$
  with p as (
    select id, cod_mpio, geom, punto from productores.predio
     where id = p_predio and productores.ve_predio(p_predio)
  ),
  con_limite as (
    select d.grupo, d.categoria, d.indicacion, d.nivel, d.orden, d.fuente,
           ST_Union(ST_CollectionExtract(ST_Intersection(d.geom, p.geom), 3)) as g
      from p join productores.determinante d
        on d.cod_mpio = p.cod_mpio and d.geom && p.geom and ST_Intersects(d.geom, p.geom)
     where p.geom is not null
     group by 1, 2, 3, 4, 5, 6
  ),
  en_punto as (
    select distinct d.grupo, d.categoria, d.indicacion, d.nivel, d.orden, d.fuente
      from p join productores.determinante d
        on d.cod_mpio = p.cod_mpio and ST_Intersects(d.geom, p.punto)
     where p.geom is null and p.punto is not null
  )
  select grupo, categoria, indicacion, nivel, orden, fuente, productores.area_ha(g), false,
         ST_AsGeoJSON(ST_Multi(g), 6)::json
    from con_limite where productores.area_ha(g) >= 0.01
  union all
  select grupo, categoria, indicacion, nivel, orden, fuente, null::numeric, true, null::json
    from en_punto
  order by 4, 5, 7 desc nulls last
$$;
grant execute on function productores.determinantes_predio(uuid) to authenticated;
