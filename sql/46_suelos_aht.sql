-- =====================================================================
-- 46 · Suelos: Áreas Homogéneas de Tierras (AHT · IGAC)
-- ---------------------------------------------------------------------
-- Capa *_AHT de ZAP_zonificacion.gdb (Instituto Humboldt) para los 12
-- municipios con predios PPS. Cada polígono trae la clase de tierras, el
-- valor potencial (0-100) y sus limitantes (inundación, encharcamiento,
-- erosión, profundidad, acidez…). Entre más baja la clase y más alto el
-- valor potencial, mejor la tierra para producir.
--
-- Datos: scripts/aht/preparar.py → scripts/aht/datos/<cod_mpio>.geojson
-- Carga (por municipio):
--   select net.http_get('https://raw.githubusercontent.com/diecas8/sigpredial/main/scripts/aht/datos/18785.geojson',
--                       timeout_milliseconds := 120000);
--   select * from productores.cargar_aht(<id>);
-- Para quitarlo: drop function productores.suelos_predio(uuid);
--                drop function productores.cargar_aht(bigint);
--                drop table productores.aht;
-- =====================================================================

create table if not exists productores.aht (
  id          bigserial primary key,
  cod_mpio    char(5) not null references productores.municipio (cod_mpio),
  simbolo     text,
  clase       smallint,
  vpotencial  smallint,
  ucs         text,
  limitantes  text[] not null default '{}',
  descripcion text,
  fecha       text,
  geom        extensions.geometry(MultiPolygon, 4326) not null
);
create index if not exists ix_aht_geom on productores.aht using gist (geom);
create index if not exists ix_aht_mpio on productores.aht (cod_mpio);

alter table productores.aht enable row level security;
drop policy if exists aht_ver on productores.aht;
create policy aht_ver on productores.aht for select to authenticated
  using (productores.ve_dpto(left(cod_mpio::text, 2)));
drop policy if exists aht_sig on productores.aht;
create policy aht_sig on productores.aht for all to sig_editor using (true) with check (true);
drop policy if exists aht_arcgis on productores.aht;
create policy aht_arcgis on productores.aht for select to arcgis_lector using (true);
grant select on productores.aht to authenticated, arcgis_lector;
grant select, insert, update, delete on productores.aht to sig_editor;
grant usage on sequence productores.aht_id_seq to sig_editor;

-- Carga un municipio desde la respuesta de pg_net (reemplaza lo que había).
create or replace function productores.cargar_aht(p_respuesta bigint)
returns table (cod_mpio text, filas bigint, area_ha numeric)
language plpgsql security definer
set search_path to 'productores', 'extensions', 'public'
as $$
declare
  gj jsonb;
  cods text[];
begin
  if not (productores.es_admin() or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'Solo el administrador carga la capa de suelos';
  end if;
  select r.content::jsonb into gj from net._http_response r
   where r.id = p_respuesta and r.status_code = 200;
  if gj is null then
    raise exception 'La descarga % no está lista o falló; revise net._http_response', p_respuesta;
  end if;
  select array_agg(distinct f->'properties'->>'cod_mpio') into cods from jsonb_array_elements(gj->'features') f;
  delete from productores.aht a where a.cod_mpio = any (cods);

  insert into productores.aht (cod_mpio, simbolo, clase, vpotencial, ucs, limitantes, descripcion, fecha, geom)
  select p->>'cod_mpio', p->>'simbolo', (p->>'clase')::smallint, (p->>'vpotencial')::smallint, p->>'ucs',
         coalesce(array(select jsonb_array_elements_text(p->'limitantes')), '{}'),
         p->>'descripcion', p->>'fecha',
         ST_Multi(ST_CollectionExtract(ST_MakeValid(s.g), 3))
    from jsonb_array_elements(gj->'features') f
   cross join lateral (select f->'properties' as p) x
   cross join lateral ST_Subdivide(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326))), 3), 256) s(g)
   where not ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(s.g), 3));

  return query
    select a.cod_mpio::text, count(*), round(sum(productores.area_ha(a.geom)), 1)
      from productores.aht a where a.cod_mpio = any (cods) group by 1;
end $$;
revoke all on function productores.cargar_aht(bigint) from public, anon, authenticated;

-- Suelos de un predio. Con límite: hectáreas, % del predio y forma recortada
-- (se descartan pedazos de menos de 0,01 ha). Sin límite: lo que cae en el
-- punto GPS, sin área.
create or replace function productores.suelos_predio(p_predio uuid)
returns table (simbolo text, clase smallint, vpotencial smallint, limitantes text[], descripcion text,
               area_ha numeric, pct numeric, en_punto boolean, geojson json)
language sql stable security definer
set search_path to 'productores', 'extensions', 'public'
as $$
  with p as (
    select id, cod_mpio, geom, punto from productores.predio
     where id = p_predio and productores.ve_predio(p_predio)
  ),
  con_limite as (
    select a.simbolo, a.clase, a.vpotencial, a.limitantes, a.descripcion,
           ST_Union(ST_CollectionExtract(ST_Intersection(a.geom, p.geom), 3)) as g,
           max(productores.area_ha(p.geom)) as area_predio
      from p join productores.aht a
        on a.cod_mpio = p.cod_mpio and a.geom && p.geom and ST_Intersects(a.geom, p.geom)
     where p.geom is not null
     group by 1, 2, 3, 4, 5
  ),
  en_punto as (
    select distinct a.simbolo, a.clase, a.vpotencial, a.limitantes, a.descripcion
      from p join productores.aht a
        on a.cod_mpio = p.cod_mpio and ST_Intersects(a.geom, p.punto)
     where p.geom is null and p.punto is not null
  )
  select simbolo, clase, vpotencial, limitantes, descripcion, round(productores.area_ha(g), 2),
         round(100 * productores.area_ha(g) / nullif(area_predio, 0), 1), false, ST_AsGeoJSON(ST_Multi(g), 6)::json
    from con_limite where productores.area_ha(g) >= 0.01
  union all
  select simbolo, clase, vpotencial, limitantes, descripcion, null::numeric, null::numeric, true, null::json
    from en_punto
  order by 6 desc nulls last, 2
$$;
revoke all on function productores.suelos_predio(uuid) from public, anon;
grant execute on function productores.suelos_predio(uuid) to authenticated;
