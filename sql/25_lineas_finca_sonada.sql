-- =========================================================================
--  25 · Líneas y puntos de la finca soñada
--
--   a) elemento_linea / elemento_punto: escenario ('actual' | 'propuesto').
--      Lo que ya existe queda como 'actual'. El escenario no cambia al editar.
--   b) Tipos nuevos de línea, grupo «Paisaje (HMP)» (herramientas de manejo del
--      paisaje): barrera viva, aislamiento de área de conservación, división de
--      potreros con árboles. La cerca viva pasa a ese grupo.
--   c) Acciones nuevas del catálogo (en metros): barreras vivas, aislamiento de
--      áreas de conservación, división de potreros con árboles.
--   d) plan_accion.elemento_linea_id: la acción puede ir sobre una línea
--      propuesta; si no se da la cantidad y la unidad es «m», toma la longitud.
--   e) Vistas: lo de hoy (r_elementos, r_predios, mapas) cuenta solo lo actual;
--      rep_elementos para el Excel; el plan muestra la línea.
-- =========================================================================

-- a) Escenario en los elementos ---------------------------------------------------
alter table productores.elemento_linea
  add column escenario text not null default 'actual' check (escenario in ('actual', 'propuesto'));
alter table productores.elemento_punto
  add column escenario text not null default 'actual' check (escenario in ('actual', 'propuesto'));
create index ix_elemento_linea_predio_esc on productores.elemento_linea (predio_id, escenario);
create index ix_elemento_punto_predio_esc on productores.elemento_punto (predio_id, escenario);

create or replace function productores.tg_elemento_escenario()
 returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'UPDATE' then new.escenario := old.escenario; end if;
  new.escenario := coalesce(new.escenario, 'actual');
  return new;
end $$;
create trigger t05_elemento_linea_escenario before insert or update on productores.elemento_linea
  for each row execute function productores.tg_elemento_escenario();
create trigger t05_elemento_punto_escenario before insert or update on productores.elemento_punto
  for each row execute function productores.tg_elemento_escenario();

-- b) Herramientas de manejo del paisaje ---------------------------------------------
update productores.tipo_elemento set grupo = 'Paisaje (HMP)' where nombre = 'Cerca viva';
insert into productores.tipo_elemento (nombre, geometria, grupo)
select x.nombre, 'linea', 'Paisaje (HMP)'
  from (values ('Barrera viva'), ('Aislamiento de área de conservación'), ('División de potreros con árboles')) x(nombre)
 where not exists (select 1 from productores.tipo_elemento t where t.nombre = x.nombre);

-- c) Acciones del plan -----------------------------------------------------------------
insert into productores.catalogo_accion (nombre, tipo, unidad)
select x.nombre, x.tipo, 'm'
  from (values ('Barreras vivas', 'Producción sostenible'),
               ('Aislamiento de áreas de conservación', 'Conservación'),
               ('División de potreros con árboles', 'Producción sostenible')) x(nombre, tipo)
 where not exists (select 1 from productores.catalogo_accion a where a.nombre = x.nombre);

-- d) La acción puede ir sobre una línea propuesta ---------------------------------------
alter table productores.plan_accion
  add column elemento_linea_id uuid references productores.elemento_linea (id) on delete set null;
create index ix_plan_accion_linea on productores.plan_accion (elemento_linea_id);

create or replace function productores.tg_plan_accion()
 returns trigger language plpgsql set search_path to 'productores', 'extensions', 'public'
as $$
declare v_malos text; v_long numeric;
begin
  if tg_op = 'UPDATE' then new.predio_id := old.predio_id; end if;
  if new.lote_id is not null and not exists (select 1 from productores.lote l where l.id = new.lote_id and l.predio_id = new.predio_id) then
    raise exception 'El lote elegido no pertenece a este predio.';
  end if;
  if new.elemento_linea_id is not null then
    select e.longitud_m into v_long from productores.elemento_linea e
     where e.id = new.elemento_linea_id and e.predio_id = new.predio_id;
    if not found then raise exception 'La línea elegida no pertenece a este predio.'; end if;
  end if;
  new.unidad := coalesce(nullif(trim(new.unidad), ''), (select a.unidad from productores.catalogo_accion a where a.id = new.accion_id));
  if new.cantidad is null and v_long is not null and new.unidad = 'm' then
    new.cantidad := round(v_long);
  end if;
  new.apoyos := coalesce(new.apoyos, '{}');
  select string_agg(x, ', ') into v_malos from unnest(new.apoyos) x
   where not exists (select 1 from productores.catalogo_apoyo c where c.codigo = x and c.activo);
  if v_malos is not null then raise exception 'Apoyo no reconocido: %', v_malos; end if;
  return new;
end $$;

-- e) Vistas ------------------------------------------------------------------------------
-- El portal recibe el escenario (columna al final)
create or replace view productores.v_elemento_linea with (security_invoker = true) as
 SELECT e.id, e.predio_id, e.tipo_id, t.nombre AS tipo, t.grupo, e.nombre, e.estado, e.permanencia, e.observaciones,
    e.longitud_m, (st_asgeojson(e.geom, 7))::json AS geojson, e.creado_por, e.creado_en, e.escenario
   FROM productores.elemento_linea e JOIN productores.tipo_elemento t ON t.id = e.tipo_id;
create or replace view productores.v_elemento_punto with (security_invoker = true) as
 SELECT e.id, e.predio_id, e.tipo_id, t.nombre AS tipo, t.grupo, e.nombre, e.estado, e.permanencia, e.observaciones,
    st_y(e.geom) AS latitud, st_x(e.geom) AS longitud, (st_asgeojson(e.geom, 7))::json AS geojson, e.creado_por, e.creado_en, e.escenario
   FROM productores.elemento_punto e JOIN productores.tipo_elemento t ON t.id = e.tipo_id;

-- Access, QGIS y ArcGIS: «Elementos» sigue siendo lo de hoy
do $$
declare def text; nuevo text;
begin
  def := rtrim(pg_get_viewdef('productores.r_elementos'::regclass), ';');
  nuevo := replace(def, 'JOIN productores.departamento d ON ((d.cod_dpto = m.cod_dpto)))',
                        'JOIN productores.departamento d ON ((d.cod_dpto = m.cod_dpto)))
  WHERE (e.escenario = ''actual''::text)');
  if (length(nuevo) - length(def)) <> 2 * length(E'\n  WHERE (e.escenario = ''actual''::text)') then
    raise exception 'r_elementos: no se encontraron las 2 consultas';
  end if;
  execute 'create or replace view productores.r_elementos with (security_invoker = true) as ' || nuevo;

  -- r_predios: nacimientos, metros de cauces y de vías = lo de hoy
  def := rtrim(pg_get_viewdef('productores.r_predios'::regclass), ';');
  nuevo := replace(def, '(e.predio_id = p.id)', '(e.predio_id = p.id) AND (e.escenario = ''actual''::text)');
  if (length(nuevo) - length(def)) <> 3 * length(' AND (e.escenario = ''actual''::text)') then
    raise exception 'r_predios: no se encontraron las 3 consultas de elementos';
  end if;
  execute 'create or replace view productores.r_predios with (security_invoker = true) as ' || nuevo;
end $$;

-- Excel: líneas y puntos con su ubicación (punto medio o el punto mismo)
create or replace view productores.rep_elementos with (security_invoker = true) as
select e.escenario, d.nombre as departamento, m.nombre as municipio, v.nombre as vereda,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap,
       x.geometria, t.grupo, t.nombre as tipo, e.nombre, e.estado, e.permanencia, x.longitud_m,
       round(ST_Y(x.pt)::numeric, 6)::double precision as latitud, round(ST_X(x.pt)::numeric, 6)::double precision as longitud,
       round(ST_X(ST_Transform(x.pt, 9377))::numeric, 1)::double precision as este_9377,
       round(ST_Y(ST_Transform(x.pt, 9377))::numeric, 1)::double precision as norte_9377,
       e.observaciones
  from (select l.id, 'Línea'::text as geometria, l.longitud_m::double precision as longitud_m,
               case when l.geom is null then null else ST_LineInterpolatePoint(ST_LineMerge(ST_GeometryN(l.geom, 1)), 0.5) end as pt
          from productores.elemento_linea l
        union all
        select q.id, 'Punto', null, q.geom from productores.elemento_punto q) x
  join lateral (select l.predio_id, l.tipo_id, l.nombre, l.estado, l.permanencia, l.observaciones, l.escenario
                  from productores.elemento_linea l where l.id = x.id
                union all
                select q.predio_id, q.tipo_id, q.nombre, q.estado, q.permanencia, q.observaciones, q.escenario
                  from productores.elemento_punto q where q.id = x.id) e on true
  join productores.tipo_elemento t on t.id = e.tipo_id
  join productores.predio p on p.id = e.predio_id
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id;
revoke all on productores.rep_elementos from public, anon;
grant select on productores.rep_elementos to authenticated, arcgis_lector, sig_editor;

-- Plan de acción en el Excel: la línea, si la tiene (columna al final)
create or replace view productores.rep_plan_accion with (security_invoker = true) as
select d.nombre as departamento, m.nombre as municipio, v.nombre as vereda, trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap, ca.tipo, ca.nombre as accion, l.cod_lote as lote,
       a.cantidad::double precision as cantidad, a.unidad, a.plazo, a.prioridad, a.estado,
       (select string_agg(ap.nombre, ', ' order by ap.nombre) from productores.catalogo_apoyo ap where ap.codigo = any (a.apoyos)) as apoyos,
       a.responsable, a.observaciones,
       case when el.id is not null then te.nombre || coalesce(' · ' || el.nombre, '') || ' (' || round(el.longitud_m) || ' m)' end as linea
  from productores.plan_accion a join productores.catalogo_accion ca on ca.id = a.accion_id
  join productores.predio p on p.id = a.predio_id join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id left join productores.lote l on l.id = a.lote_id
  left join productores.elemento_linea el on el.id = a.elemento_linea_id
  left join productores.tipo_elemento te on te.id = el.tipo_id;
