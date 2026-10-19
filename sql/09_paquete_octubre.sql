-- =====================================================================
--  SIP-CBS · Paquete de mejoras (octubre 2026)
--
--   1. Coberturas adicionales (humedal, bosque de galería, etc.).
--   2. Lotes: campo "trazado" y cálculo de sitios de siembra / ocupación.
--   3. Elementos prediales levantados en campo:
--        - elemento_linea: vías, ríos, quebradas, canales, cercas…
--        - elemento_punto: nacimientos/afloramientos, captaciones, vivienda…
--      Se recortan al límite del predio y calculan su longitud.
--   4. Vistas de la app y de Access actualizadas (sin número predial ni
--      matrícula en Access; diferencia de áreas; sitios; elementos).
--
--  Se puede ejecutar varias veces. NO borra datos.
-- =====================================================================
set search_path = productores, extensions, public;


-- ---------------------------------------------------------------------
-- 1. Coberturas adicionales
-- ---------------------------------------------------------------------
insert into productores.cultivo (nombre, tipo) values
  ('Humedal',              'Conservación'),
  ('Bosque de galería',    'Conservación'),
  ('Regeneración natural', 'Conservación'),
  ('Área en descanso',     'Descanso'),
  ('Palma de aceite',      'Permanente'),
  ('Arroz',                'Transitorio'),
  ('Pancoger',             'Transitorio')
on conflict (nombre) do nothing;


-- ---------------------------------------------------------------------
-- 2. Lotes: trazado de siembra
-- ---------------------------------------------------------------------
alter table productores.lote add column if not exists trazado text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_lote_trazado') then
    alter table productores.lote add constraint ck_lote_trazado
      check (trazado is null or trazado in ('Cuadro / rectángulo', 'Tresbolillo'));
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Elementos prediales
-- ---------------------------------------------------------------------
create table if not exists productores.tipo_elemento (
  id         serial primary key,
  nombre     text not null unique,
  geometria  text not null check (geometria in ('linea', 'punto')),
  grupo      text not null
);

insert into productores.tipo_elemento (nombre, geometria, grupo) values
  ('Río',                         'linea', 'Hídrico'),
  ('Quebrada',                    'linea', 'Hídrico'),
  ('Caño / drenaje',              'linea', 'Hídrico'),
  ('Canal / acequia',             'linea', 'Hídrico'),
  ('Vía carreteable',             'linea', 'Vial'),
  ('Camino / trocha',             'linea', 'Vial'),
  ('Sendero',                     'linea', 'Vial'),
  ('Cerca / lindero',             'linea', 'Infraestructura'),
  ('Cerca viva',                  'linea', 'Infraestructura'),
  ('Otro (línea)',                'linea', 'Otro'),
  ('Nacimiento / afloramiento',   'punto', 'Hídrico'),
  ('Captación / bocatoma',        'punto', 'Hídrico'),
  ('Reservorio / jagüey',         'punto', 'Hídrico'),
  ('Pozo / aljibe',               'punto', 'Hídrico'),
  ('Vivienda',                    'punto', 'Infraestructura'),
  ('Beneficiadero',               'punto', 'Infraestructura'),
  ('Bodega',                      'punto', 'Infraestructura'),
  ('Establo / corral',            'punto', 'Infraestructura'),
  ('Vivero',                      'punto', 'Infraestructura'),
  ('Otro (punto)',                'punto', 'Otro')
on conflict (nombre) do nothing;

create table if not exists productores.elemento_linea (
  id             uuid primary key default gen_random_uuid(),
  predio_id      uuid not null references productores.predio(id) on delete cascade,
  tipo_id        int not null references productores.tipo_elemento(id),
  nombre         text,
  estado         text check (estado is null or estado in ('Bueno', 'Regular', 'Malo')),
  permanencia    text check (permanencia is null or permanencia in ('Permanente', 'Intermitente')),
  observaciones  text,
  longitud_m     numeric(12,1),
  geom           geometry(MultiLineString, 4326),
  creado_por     uuid default productores.usuario_actual(),
  creado_en      timestamptz not null default now(),
  editado_por    uuid,
  editado_en     timestamptz
);
create index if not exists ix_elinea_geom   on productores.elemento_linea using gist (geom);
create index if not exists ix_elinea_predio on productores.elemento_linea (predio_id);

create table if not exists productores.elemento_punto (
  id             uuid primary key default gen_random_uuid(),
  predio_id      uuid not null references productores.predio(id) on delete cascade,
  tipo_id        int not null references productores.tipo_elemento(id),
  nombre         text,
  estado         text check (estado is null or estado in ('Bueno', 'Regular', 'Malo')),
  permanencia    text check (permanencia is null or permanencia in ('Permanente', 'Intermitente')),
  observaciones  text,
  geom           geometry(Point, 4326),
  creado_por     uuid default productores.usuario_actual(),
  creado_en      timestamptz not null default now(),
  editado_por    uuid,
  editado_en     timestamptz
);
create index if not exists ix_epunto_geom   on productores.elemento_punto using gist (geom);
create index if not exists ix_epunto_predio on productores.elemento_punto (predio_id);

-- Línea: se asigna al predio que toca y se recorta a su límite
create or replace function productores.tg_elemento_linea()
returns trigger
language plpgsql
security definer
set search_path = productores, extensions, public
as $$
declare
  v_predio productores.predio%rowtype;
begin
  if new.geom is not null then
    new.geom := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(new.geom, 4326)), 2));
    if ST_IsEmpty(new.geom) then new.geom := null; end if;
  end if;
  if tg_op = 'UPDATE' then new.predio_id := old.predio_id; end if;

  if new.predio_id is null and new.geom is not null then
    select p.id into new.predio_id from productores.predio p
     where p.geom is not null and ST_Intersects(p.geom, new.geom)
     order by ST_Length(ST_Intersection(p.geom, new.geom)) desc limit 1;
  end if;
  if new.predio_id is null then
    raise exception 'El elemento debe pertenecer a un predio. Dibújelo dentro de un predio.';
  end if;

  select * into v_predio from productores.predio where id = new.predio_id;
  if new.geom is not null and v_predio.geom is not null then
    new.geom := ST_Multi(ST_CollectionExtract(ST_Intersection(new.geom, v_predio.geom), 2));
    if new.geom is null or ST_IsEmpty(new.geom) then
      raise exception 'La línea queda por fuera del predio %.', v_predio.cod_predio;
    end if;
  end if;
  new.longitud_m := case when new.geom is not null
                         then round(ST_Length(new.geom::geography)::numeric, 1) end;
  return new;
end $$;

drop trigger if exists t10_elemento_linea on productores.elemento_linea;
create trigger t10_elemento_linea before insert or update on productores.elemento_linea
  for each row execute function productores.tg_elemento_linea();
drop trigger if exists t20_elemento_linea_audit on productores.elemento_linea;
create trigger t20_elemento_linea_audit before update on productores.elemento_linea
  for each row execute function productores.tg_auditoria();

-- Punto: debe quedar dentro de su predio
create or replace function productores.tg_elemento_punto()
returns trigger
language plpgsql
security definer
set search_path = productores, extensions, public
as $$
declare
  v_predio productores.predio%rowtype;
begin
  if new.geom is not null then
    new.geom := ST_SetSRID(new.geom, 4326);
  end if;
  if tg_op = 'UPDATE' then new.predio_id := old.predio_id; end if;

  if new.predio_id is null and new.geom is not null then
    select p.id into new.predio_id from productores.predio p
     where p.geom is not null and ST_Intersects(p.geom, new.geom) limit 1;
  end if;
  if new.predio_id is null then
    raise exception 'El elemento debe pertenecer a un predio. Ubíquelo dentro de un predio.';
  end if;

  select * into v_predio from productores.predio where id = new.predio_id;
  if new.geom is not null and v_predio.geom is not null
     and not ST_DWithin(v_predio.geom::geography, new.geom::geography, 5) then
    raise exception 'El punto queda por fuera del predio %.', v_predio.cod_predio;
  end if;
  return new;
end $$;

drop trigger if exists t10_elemento_punto on productores.elemento_punto;
create trigger t10_elemento_punto before insert or update on productores.elemento_punto
  for each row execute function productores.tg_elemento_punto();
drop trigger if exists t20_elemento_punto_audit on productores.elemento_punto;
create trigger t20_elemento_punto_audit before update on productores.elemento_punto
  for each row execute function productores.tg_auditoria();


-- ---------------------------------------------------------------------
-- 4. Permisos de las tablas nuevas
-- ---------------------------------------------------------------------
grant select, insert, update, delete on productores.tipo_elemento, productores.elemento_linea,
      productores.elemento_punto to authenticated, service_role, sig_editor;
grant select on productores.tipo_elemento, productores.elemento_linea,
      productores.elemento_punto to arcgis_lector;
grant usage, select on all sequences in schema productores to authenticated, service_role, sig_editor;

alter table productores.tipo_elemento  enable row level security;
alter table productores.elemento_linea enable row level security;
alter table productores.elemento_punto enable row level security;

drop policy if exists tipo_elemento_leer on productores.tipo_elemento;
create policy tipo_elemento_leer on productores.tipo_elemento for select to authenticated
  using (productores.usuario_activo());
drop policy if exists tipo_elemento_editar on productores.tipo_elemento;
create policy tipo_elemento_editar on productores.tipo_elemento for all to authenticated
  using (productores.es_coordinador()) with check (productores.es_coordinador());

do $$
declare
  t text;
begin
  foreach t in array array['elemento_linea', 'elemento_punto'] loop
    execute format('drop policy if exists %I on productores.%I', t || '_ver', t);
    execute format('create policy %I on productores.%I for select to authenticated using (productores.usuario_activo())', t || '_ver', t);
    execute format('drop policy if exists %I on productores.%I', t || '_crear', t);
    execute format('create policy %I on productores.%I for insert to authenticated with check (productores.usuario_activo())', t || '_crear', t);
    execute format('drop policy if exists %I on productores.%I', t || '_editar', t);
    execute format('create policy %I on productores.%I for update to authenticated using (productores.usuario_activo() and (creado_por = auth.uid() or productores.es_coordinador())) with check (productores.usuario_activo())', t || '_editar', t);
    execute format('drop policy if exists %I on productores.%I', t || '_borrar', t);
    execute format('create policy %I on productores.%I for delete to authenticated using (productores.usuario_activo() and (creado_por = auth.uid() or productores.es_coordinador()))', t || '_borrar', t);
  end loop;
  foreach t in array array['tipo_elemento', 'elemento_linea', 'elemento_punto'] loop
    execute format('drop policy if exists %I on productores.%I', t || '_sig_editor', t);
    execute format('create policy %I on productores.%I for all to sig_editor using (true) with check (true)', t || '_sig_editor', t);
    execute format('drop policy if exists %I on productores.%I', t || '_arcgis', t);
    execute format('create policy %I on productores.%I for select to arcgis_lector using (true)', t || '_arcgis', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 5. Vistas de la app web
-- ---------------------------------------------------------------------
drop view if exists productores.r_lotes;
drop view if exists productores.v_lote;
create view productores.v_lote
with (security_invoker = true) as
with base as (
  select l.*,
         case when l.dist_surcos_m > 0 and l.dist_plantas_m > 0
              then 10000.0 / (l.dist_surcos_m * l.dist_plantas_m
                              * case when l.trazado = 'Tresbolillo' then 0.866 else 1 end)
         end as dens
    from productores.lote l
)
select l.id, l.cod_lote, l.num_lote, l.predio_id, p.cod_predio, p.nombre as predio,
       l.cultivo_id, c.nombre as cultivo, c.tipo as tipo_cobertura, l.variedad, l.fecha_siembra,
       case when l.fecha_siembra is not null
            then (extract(year from age(current_date, l.fecha_siembra)) * 12
                + extract(month from age(current_date, l.fecha_siembra)))::int end as edad_meses,
       l.area_declarada_ha, l.area_sig_ha, l.num_plantas, l.dist_surcos_m, l.dist_plantas_m,
       l.trazado,
       round(l.dens)::numeric as densidad_ha,
       round(l.dens * l.area_sig_ha)::numeric as sitios_estimados,
       case when l.dens * l.area_sig_ha > 0 and l.num_plantas is not null
            then round(100.0 * l.num_plantas / (l.dens * l.area_sig_ha), 1) end as ocupacion_pct,
       l.sistema, l.sombrio, l.estado, l.observaciones,
       ST_AsGeoJSON(l.geom, 7)::json as geojson,
       l.creado_por, l.creado_en, l.editado_en
  from base l
  join productores.predio p on p.id = l.predio_id
  left join productores.cultivo c on c.id = l.cultivo_id;

create or replace view productores.v_elemento_linea
with (security_invoker = true) as
select e.id, e.predio_id, e.tipo_id, t.nombre as tipo, t.grupo, e.nombre, e.estado,
       e.permanencia, e.observaciones, e.longitud_m,
       ST_AsGeoJSON(e.geom, 7)::json as geojson, e.creado_por, e.creado_en
  from productores.elemento_linea e
  join productores.tipo_elemento t on t.id = e.tipo_id;

create or replace view productores.v_elemento_punto
with (security_invoker = true) as
select e.id, e.predio_id, e.tipo_id, t.nombre as tipo, t.grupo, e.nombre, e.estado,
       e.permanencia, e.observaciones,
       ST_Y(e.geom) as latitud, ST_X(e.geom) as longitud,
       ST_AsGeoJSON(e.geom, 7)::json as geojson, e.creado_por, e.creado_en
  from productores.elemento_punto e
  join productores.tipo_elemento t on t.id = e.tipo_id;


-- ---------------------------------------------------------------------
-- 6. Vistas para Access (solo lectura)
-- ---------------------------------------------------------------------
drop view if exists productores.r_predios;
create view productores.r_predios
with (security_invoker = true) as
select p.id::text                          as id,
       p.cod_predio,
       p.nombre                            as predio,
       p.productor_id::text                as productor_id,
       pr.num_doc,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       pr.asociacion,
       d.nombre                            as departamento,
       m.nombre                            as municipio,
       v.nombre                            as vereda,
       t.nombre                            as tenencia,
       p.area_declarada_ha::float8         as area_declarada_ha,
       p.area_sig_ha::float8               as area_sig_ha,
       case when p.area_declarada_ha > 0 and p.area_sig_ha > 0
            then round(100.0 * (p.area_sig_ha - p.area_declarada_ha) / p.area_declarada_ha, 1)::float8
       end                                 as dif_area_pct,
       (select count(*) from productores.lote l where l.predio_id = p.id)::int as n_lotes,
       (select sum(coalesce(l.area_sig_ha, l.area_declarada_ha)) from productores.lote l
         where l.predio_id = p.id)::float8 as area_lotes_ha,
       (select count(*) from productores.elemento_punto e join productores.tipo_elemento te on te.id = e.tipo_id
         where e.predio_id = p.id and te.nombre = 'Nacimiento / afloramiento')::int as n_nacimientos,
       (select round(sum(e.longitud_m)) from productores.elemento_linea e join productores.tipo_elemento te on te.id = e.tipo_id
         where e.predio_id = p.id and te.grupo = 'Hídrico')::float8 as m_cauces,
       (select round(sum(e.longitud_m)) from productores.elemento_linea e join productores.tipo_elemento te on te.id = e.tipo_id
         where e.predio_id = p.id and te.grupo = 'Vial')::float8 as m_vias,
       round(ST_Y(p.punto)::numeric, 6)::float8 as latitud,
       round(ST_X(p.punto)::numeric, 6)::float8 as longitud,
       p.altitud_msnm,
       left(p.como_llegar, 255)            as como_llegar,
       (p.creado_en  at time zone 'America/Bogota') as fecha_registro,
       (p.editado_en at time zone 'America/Bogota') as fecha_edicion
  from productores.predio p
  join productores.productor pr    on pr.id = p.productor_id
  join productores.municipio m     on m.cod_mpio = p.cod_mpio
  join productores.departamento d  on d.cod_dpto = m.cod_dpto
  left join productores.vereda v   on v.id = p.vereda_id
  left join productores.tenencia t on t.id = p.tenencia_id;

create view productores.r_lotes
with (security_invoker = true) as
select v.id::text                         as id,
       v.cod_lote,
       v.num_lote,
       v.predio_id::text                  as predio_id,
       v.cod_predio,
       v.predio,
       pr.num_doc,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       d.nombre                           as departamento,
       m.nombre                           as municipio,
       ve.nombre                          as vereda,
       v.cultivo,
       v.tipo_cobertura,
       v.tipo_cobertura                   as tipo_cultivo,
       v.variedad,
       v.fecha_siembra,
       v.edad_meses,
       v.estado,
       v.sistema,
       v.sombrio,
       v.area_declarada_ha::float8        as area_declarada_ha,
       v.area_sig_ha::float8              as area_sig_ha,
       v.num_plantas,
       v.dist_surcos_m::float8            as dist_surcos_m,
       v.dist_plantas_m::float8           as dist_plantas_m,
       v.trazado,
       v.densidad_ha::float8              as densidad_ha,
       v.sitios_estimados::float8         as sitios_estimados,
       v.ocupacion_pct::float8            as ocupacion_pct,
       left(v.observaciones, 255)         as observaciones,
       (v.creado_en at time zone 'America/Bogota') as fecha_registro
  from productores.v_lote v
  join productores.predio p      on p.id = v.predio_id
  join productores.productor pr  on pr.id = p.productor_id
  join productores.municipio m   on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda ve on ve.id = p.vereda_id;

drop view if exists productores.r_elementos;
create view productores.r_elementos
with (security_invoker = true) as
select e.id::text as id, 'Línea'::text as geometria, t.grupo, t.nombre as tipo, e.nombre,
       e.estado, e.permanencia, e.longitud_m::float8 as longitud_m,
       null::float8 as latitud, null::float8 as longitud,
       p.cod_predio, p.nombre as predio,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       d.nombre as departamento, m.nombre as municipio,
       left(e.observaciones, 255) as observaciones,
       (e.creado_en at time zone 'America/Bogota') as fecha_registro
  from productores.elemento_linea e
  join productores.tipo_elemento t on t.id = e.tipo_id
  join productores.predio p on p.id = e.predio_id
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
union all
select e.id::text, 'Punto', t.grupo, t.nombre, e.nombre,
       e.estado, e.permanencia, null::float8,
       round(ST_Y(e.geom)::numeric, 6)::float8, round(ST_X(e.geom)::numeric, 6)::float8,
       p.cod_predio, p.nombre,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')),
       d.nombre, m.nombre,
       left(e.observaciones, 255),
       (e.creado_en at time zone 'America/Bogota')
  from productores.elemento_punto e
  join productores.tipo_elemento t on t.id = e.tipo_id
  join productores.predio p on p.id = e.predio_id
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto;

create or replace view productores.r_resumen_cultivos
with (security_invoker = true) as
select m.nombre                                   as municipio,
       coalesce(c.nombre, 'Sin cultivo')          as cultivo,
       count(*)::int                              as n_lotes,
       count(distinct p.id)::int                  as n_predios,
       count(distinct p.productor_id)::int        as n_productores,
       round(sum(coalesce(l.area_sig_ha, l.area_declarada_ha, 0)), 2)::float8 as area_ha,
       sum(coalesce(l.num_plantas, 0))::bigint    as plantas,
       coalesce(max(c.tipo), 'Sin clasificar')    as tipo_cobertura
  from productores.lote l
  join productores.predio p    on p.id = l.predio_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  left join productores.cultivo c on c.id = l.cultivo_id
 group by m.nombre, coalesce(c.nombre, 'Sin cultivo');

create or replace view productores.r_resumen_coberturas
with (security_invoker = true) as
select d.nombre                                   as departamento,
       m.nombre                                   as municipio,
       coalesce(c.tipo, 'Sin clasificar')         as tipo_cobertura,
       count(*)::int                              as n_lotes,
       count(distinct p.id)::int                  as n_predios,
       count(distinct p.productor_id)::int        as n_productores,
       round(sum(coalesce(l.area_sig_ha, l.area_declarada_ha, 0)), 2)::float8 as area_ha
  from productores.lote l
  join productores.predio p       on p.id = l.predio_id
  join productores.municipio m    on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.cultivo c on c.id = l.cultivo_id
 group by d.nombre, m.nombre, coalesce(c.tipo, 'Sin clasificar');

grant select on productores.v_lote, productores.v_elemento_linea, productores.v_elemento_punto
   to authenticated, service_role, arcgis_lector, sig_editor;
grant select on productores.r_predios, productores.r_lotes, productores.r_elementos,
                productores.r_resumen_cultivos, productores.r_resumen_coberturas
   to authenticated, service_role, arcgis_lector, lector_oficina, sig_editor;

-- Comprobación
select 'tipos de elemento' as item, count(*)::text as valor from productores.tipo_elemento
union all select 'coberturas/cultivos', count(*)::text from productores.cultivo
union all select 'lotes (vista)', count(*)::text from productores.v_lote
union all select 'predios (Access)', count(*)::text from productores.r_predios;
