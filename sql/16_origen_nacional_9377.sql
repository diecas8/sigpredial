-- =========================================================================
--  16 · MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377)
--
--  La geometría se sigue GUARDANDO en EPSG:4326 (lo exigen el portal web,
--  Kobo y el GPS), pero todo lo que es medida oficial pasa a 9377:
--
--   a) Se registra EPSG:9377 en PostGIS (no venía en spatial_ref_sys).
--   b) Áreas (predio, lote) y longitudes (líneas) se calculan en el plano
--      Origen Nacional, igual que IGAC / catastro multipropósito.
--   c) Se recalculan las áreas y longitudes ya guardadas.
--   d) Coordenadas Este / Norte (9377) en las vistas de Access
--      (r_predios y r_elementos), además de latitud / longitud.
--   e) Capas de solo lectura en 9377 para QGIS y ArcGIS Pro:
--        mapa9377_predios, mapa9377_ubicacion_predios, mapa9377_lotes,
--        mapa9377_lineas, mapa9377_puntos
-- =========================================================================

-- a) Sistema de referencia ------------------------------------------------
insert into extensions.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
values (9377, 'EPSG', 9377,
  'PROJCS["MAGNA-SIRGAS 2018 / Origen-Nacional",GEOGCS["MAGNA-SIRGAS 2018",'
  || 'DATUM["Marco_Geocentrico_Nacional_de_Referencia_2018",SPHEROID["GRS 1980",6378137,298.257222101,'
  || 'AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","1329"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],'
  || 'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","20046"]],'
  || 'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",4],PARAMETER["central_meridian",-73],'
  || 'PARAMETER["scale_factor",0.9992],PARAMETER["false_easting",5000000],PARAMETER["false_northing",2000000],'
  || 'UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","9377"]]',
  '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 '
  || '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs')
on conflict (srid) do nothing;

-- b) Medidas en 9377 -------------------------------------------------------
create or replace function productores.area_ha(g geometry)
returns numeric language sql stable parallel safe
set search_path = productores, extensions, public as $$
  select case when g is null or ST_IsEmpty(g) then null
              else round((ST_Area(ST_Transform(g, 9377)) / 10000)::numeric, 4) end
$$;

create or replace function productores.longitud_m(g geometry)
returns numeric language sql stable parallel safe
set search_path = productores, extensions, public as $$
  select case when g is null or ST_IsEmpty(g) then null
              else round(ST_Length(ST_Transform(g, 9377))::numeric, 1) end
$$;

comment on function productores.area_ha(geometry) is
  'Área en hectáreas en MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377).';
comment on function productores.longitud_m(geometry) is
  'Longitud en metros en MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377).';

-- Los disparadores usan las nuevas funciones (se cambia solo la fórmula)
do $$
declare
  f record; def text; nuevo text;
begin
  for f in select * from (values
      ('tg_predio',         'round((ST_Area(new.geom::geography) / 10000)::numeric, 4)', 'productores.area_ha(new.geom)'),
      ('tg_lote',           'round((ST_Area(new.geom::geography) / 10000)::numeric, 4)', 'productores.area_ha(new.geom)'),
      ('tg_elemento_linea', 'round(ST_Length(new.geom::geography)::numeric, 1)',        'productores.longitud_m(new.geom)')
    ) as t(fn, viejo, reemplazo)
  loop
    def := pg_get_functiondef(('productores.' || f.fn || '()')::regprocedure);
    nuevo := replace(def, f.viejo, f.reemplazo);
    if nuevo = def then
      raise exception 'No se encontró la fórmula de área/longitud en %', f.fn;
    end if;
    execute nuevo;
  end loop;
end $$;

-- c) Recalcular lo guardado (sin disparar recortes ni auditoría) ----------
alter table productores.predio         disable trigger user;
alter table productores.lote           disable trigger user;
alter table productores.elemento_linea disable trigger user;

update productores.predio         set area_sig_ha = productores.area_ha(geom)    where geom is not null;
update productores.lote           set area_sig_ha = productores.area_ha(geom)    where geom is not null;
update productores.elemento_linea set longitud_m  = productores.longitud_m(geom) where geom is not null;

alter table productores.predio         enable trigger user;
alter table productores.lote           enable trigger user;
alter table productores.elemento_linea enable trigger user;

-- d) Este / Norte en las vistas de Access ---------------------------------
create or replace view productores.r_predios with (security_invoker = true) as
 SELECT p.id::text AS id,
    p.cod_predio,
    p.nombre AS predio,
    p.productor_id::text AS productor_id,
    pr.num_doc,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    pr.asociacion,
    d.nombre AS departamento,
    m.nombre AS municipio,
    v.nombre AS vereda,
    t.nombre AS tenencia,
    p.area_declarada_ha::double precision AS area_declarada_ha,
    p.area_sig_ha::double precision AS area_sig_ha,
        CASE
            WHEN p.area_declarada_ha > 0::numeric AND p.area_sig_ha > 0::numeric THEN round(100.0 * (p.area_sig_ha - p.area_declarada_ha) / p.area_declarada_ha, 1)::double precision
            ELSE NULL::double precision
        END AS dif_area_pct,
    (( SELECT count(*) AS count
           FROM productores.lote l
          WHERE l.predio_id = p.id))::integer AS n_lotes,
    (( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) AS sum
           FROM productores.lote l
          WHERE l.predio_id = p.id))::double precision AS area_lotes_ha,
    (( SELECT count(*) AS count
           FROM productores.elemento_punto e
             JOIN productores.tipo_elemento te ON te.id = e.tipo_id
          WHERE e.predio_id = p.id AND te.nombre = 'Nacimiento / afloramiento'::text))::integer AS n_nacimientos,
    (( SELECT round(sum(e.longitud_m)) AS round
           FROM productores.elemento_linea e
             JOIN productores.tipo_elemento te ON te.id = e.tipo_id
          WHERE e.predio_id = p.id AND te.grupo = 'Hídrico'::text))::double precision AS m_cauces,
    (( SELECT round(sum(e.longitud_m)) AS round
           FROM productores.elemento_linea e
             JOIN productores.tipo_elemento te ON te.id = e.tipo_id
          WHERE e.predio_id = p.id AND te.grupo = 'Vial'::text))::double precision AS m_vias,
    round(st_y(p.punto)::numeric, 6)::double precision AS latitud,
    round(st_x(p.punto)::numeric, 6)::double precision AS longitud,
    p.altitud_msnm,
    "left"(p.como_llegar, 255) AS como_llegar,
    (p.creado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_registro,
    (p.editado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_edicion,
    p.cod_humboldt,
        CASE
            WHEN p.geom IS NULL THEN 'Pendiente de delimitar'::text
            ELSE 'Delimitado'::text
        END AS estado_limite,
        CASE
            WHEN v.id IS NULL THEN NULL::text
            WHEN v.validada THEN 'Sí'::text
            ELSE 'Por validar'::text
        END AS vereda_validada,
    p.gps_precision_m::double precision AS gps_precision_m,
    ( SELECT max(c.fecha_visita) AS max
           FROM productores.caracterizacion c
          WHERE c.predio_id = p.id AND c.estado = 'procesada'::text) AS fecha_caracterizacion,
    ( SELECT (f.generado_en AT TIME ZONE 'America/Bogota'::text) AS timezone
           FROM productores.ficha_predial f
          WHERE f.predio_id = p.id) AS fecha_ficha_pdf,
    round(st_x(st_transform(p.punto, 9377))::numeric, 2)::double precision AS este_9377,
    round(st_y(st_transform(p.punto, 9377))::numeric, 2)::double precision AS norte_9377
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id;

create or replace view productores.r_elementos with (security_invoker = true) as
 SELECT e.id::text AS id,
    'Línea'::text AS geometria,
    t.grupo,
    t.nombre AS tipo,
    e.nombre,
    e.estado,
    e.permanencia,
    e.longitud_m::double precision AS longitud_m,
    NULL::double precision AS latitud,
    NULL::double precision AS longitud,
    p.cod_predio,
    p.nombre AS predio,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    d.nombre AS departamento,
    m.nombre AS municipio,
    "left"(e.observaciones, 255) AS observaciones,
    (e.creado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_registro,
    NULL::double precision AS este_9377,
    NULL::double precision AS norte_9377
   FROM productores.elemento_linea e
     JOIN productores.tipo_elemento t ON t.id = e.tipo_id
     JOIN productores.predio p ON p.id = e.predio_id
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
UNION ALL
 SELECT e.id::text AS id,
    'Punto'::text AS geometria,
    t.grupo,
    t.nombre AS tipo,
    e.nombre,
    e.estado,
    e.permanencia,
    NULL::double precision AS longitud_m,
    round(st_y(e.geom)::numeric, 6)::double precision AS latitud,
    round(st_x(e.geom)::numeric, 6)::double precision AS longitud,
    p.cod_predio,
    p.nombre AS predio,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    d.nombre AS departamento,
    m.nombre AS municipio,
    "left"(e.observaciones, 255) AS observaciones,
    (e.creado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_registro,
    round(st_x(st_transform(e.geom, 9377))::numeric, 2)::double precision AS este_9377,
    round(st_y(st_transform(e.geom, 9377))::numeric, 2)::double precision AS norte_9377
   FROM productores.elemento_punto e
     JOIN productores.tipo_elemento t ON t.id = e.tipo_id
     JOIN productores.predio p ON p.id = e.predio_id
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto;

-- e) Capas en 9377 para QGIS / ArcGIS (solo lectura; respetan el departamento)
create or replace view productores.mapa9377_predios with (security_invoker = true) as
select r.*, ST_Transform(p.geom, 9377)::geometry(MultiPolygon, 9377) as geom
  from productores.r_predios r
  join productores.predio p on p.id::text = r.id
 where p.geom is not null;

create or replace view productores.mapa9377_ubicacion_predios with (security_invoker = true) as
select r.*, ST_Transform(coalesce(p.punto, p.punto_visita), 9377)::geometry(Point, 9377) as geom
  from productores.r_predios r
  join productores.predio p on p.id::text = r.id
 where coalesce(p.punto, p.punto_visita) is not null;

create or replace view productores.mapa9377_lotes with (security_invoker = true) as
select r.*, ST_Transform(l.geom, 9377)::geometry(MultiPolygon, 9377) as geom
  from productores.r_lotes r
  join productores.lote l on l.id::text = r.id
 where l.geom is not null;

create or replace view productores.mapa9377_lineas with (security_invoker = true) as
select r.id, r.grupo, r.tipo, r.nombre, r.estado, r.permanencia, r.longitud_m,
       r.cod_predio, r.predio, r.productor, r.departamento, r.municipio, r.observaciones, r.fecha_registro,
       ST_Transform(e.geom, 9377)::geometry(MultiLineString, 9377) as geom
  from productores.r_elementos r
  join productores.elemento_linea e on e.id::text = r.id
 where r.geometria = 'Línea' and e.geom is not null;

create or replace view productores.mapa9377_puntos with (security_invoker = true) as
select r.id, r.grupo, r.tipo, r.nombre, r.estado, r.permanencia,
       r.cod_predio, r.predio, r.productor, r.departamento, r.municipio, r.observaciones, r.fecha_registro,
       ST_Transform(e.geom, 9377)::geometry(Point, 9377) as geom
  from productores.r_elementos r
  join productores.elemento_punto e on e.id::text = r.id
 where r.geometria = 'Punto' and e.geom is not null;

revoke all on productores.mapa9377_predios, productores.mapa9377_ubicacion_predios,
              productores.mapa9377_lotes, productores.mapa9377_lineas, productores.mapa9377_puntos
  from public, anon;
grant select on productores.mapa9377_predios, productores.mapa9377_ubicacion_predios,
                productores.mapa9377_lotes, productores.mapa9377_lineas, productores.mapa9377_puntos
  to authenticated, sig_editor, arcgis_lector;
