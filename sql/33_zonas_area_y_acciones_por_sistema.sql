-- =========================================================================
--  33 · Recomendaciones del equipo (noviembre 2026)
--
--   a) Zonas de riesgo y de conflicto de uso como ÁREA (polígono), además de
--      punto: tabla elemento_area, con las mismas reglas que los puntos
--      (permisos, papelera, auditoría) y recortada al límite del predio.
--   b) Secadero de café y secadero de cacao por separado.
--   c) Cultivo «Frutos del bosque (canangucha, asaí)».
--   d) Acciones del plan ligadas al sistema productivo (cultivo_ids): el
--      portal sugiere primero las del cultivo del lote. Acciones nuevas por
--      sistema (BORRADOR para validar con el equipo) y generales.
-- =========================================================================

-- a) Zonas como área ------------------------------------------------------------------
alter table productores.tipo_elemento drop constraint tipo_elemento_geometria_check;
alter table productores.tipo_elemento add constraint tipo_elemento_geometria_check
  check (geometria = any (array['linea', 'punto', 'area']));

insert into productores.tipo_elemento (nombre, geometria, grupo) values
  ('Área de pendiente fuerte', 'area', 'Riesgo'),
  ('Área que se inunda', 'area', 'Riesgo'),
  ('Área de deslizamiento', 'area', 'Riesgo'),
  ('Área en conflicto de uso', 'area', 'Conflicto de uso'),
  ('Otro (área)', 'area', 'Otro')
on conflict (nombre) do nothing;

create table productores.elemento_area (
  id            uuid primary key default gen_random_uuid(),
  predio_id     uuid not null references productores.predio(id) on delete cascade,
  tipo_id       int  not null references productores.tipo_elemento(id),
  nombre        text,
  estado        text check (estado is null or estado = any (array['Bueno', 'Regular', 'Malo'])),
  permanencia   text check (permanencia is null or permanencia = any (array['Permanente', 'Intermitente'])),
  observaciones text,
  area_ha       numeric,
  geom          extensions.geometry,
  creado_por    uuid default productores.usuario_actual(),
  creado_en     timestamptz not null default now(),
  editado_por   uuid,
  editado_en    timestamptz,
  escenario     text not null default 'actual' check (escenario = any (array['actual', 'propuesto']))
);
create index ix_elemento_area_predio on productores.elemento_area (predio_id);
create index ix_elemento_area_geom on productores.elemento_area using gist (geom);

create or replace function productores.tg_elemento_area()
 returns trigger language plpgsql security definer
 set search_path to 'productores', 'extensions', 'public' as $$
declare v_predio productores.predio%rowtype;
begin
  new.geom := productores.limpiar_poligono(new.geom);
  if new.geom is not null and ST_IsEmpty(new.geom) then new.geom := null; end if;
  if tg_op = 'UPDATE' then new.predio_id := old.predio_id; end if;
  if new.predio_id is null and new.geom is not null then
    select p.id into new.predio_id from productores.predio p
     where p.geom is not null and ST_Intersects(p.geom, ST_PointOnSurface(new.geom)) limit 1;
  end if;
  if new.predio_id is null then
    raise exception 'La zona debe pertenecer a un predio. Dibújela dentro de un predio.';
  end if;
  select * into v_predio from productores.predio where id = new.predio_id;
  if new.geom is not null and v_predio.geom is not null then
    new.geom := productores.limpiar_poligono(ST_Intersection(new.geom, v_predio.geom));
    if new.geom is null or ST_IsEmpty(new.geom) then
      raise exception 'La zona queda por fuera del predio %.', v_predio.cod_predio;
    end if;
  end if;
  new.area_ha := case when new.geom is not null then productores.area_ha(new.geom) end;
  return new;
end $$;

create trigger t05_elemento_area_escenario before insert or update on productores.elemento_area
  for each row execute function productores.tg_elemento_escenario();
create trigger t10_elemento_area before insert or update on productores.elemento_area
  for each row execute function productores.tg_elemento_area();
create trigger t20_elemento_area_audit before update on productores.elemento_area
  for each row execute function productores.tg_auditoria();
create trigger t99_elemento_area_papelera before delete on productores.elemento_area
  for each row execute function productores.tg_papelera();

alter table productores.elemento_area enable row level security;
create policy elemento_area_ver on productores.elemento_area for select to authenticated
  using (productores.ve_predio(predio_id));
create policy elemento_area_crear on productores.elemento_area for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_predio(predio_id));
create policy elemento_area_editar on productores.elemento_area for update to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_predio(predio_id));
create policy elemento_area_borrar on productores.elemento_area for delete to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()));
create policy elemento_area_sig_editor on productores.elemento_area for all to sig_editor using (true) with check (true);
create policy elemento_area_arcgis on productores.elemento_area for select to arcgis_lector using (true);
revoke all on productores.elemento_area from public, anon;
grant select, insert, update, delete on productores.elemento_area to authenticated, sig_editor, service_role;
grant select on productores.elemento_area to arcgis_lector;

create view productores.v_elemento_area with (security_invoker = true) as
select e.id, e.predio_id, e.tipo_id, t.nombre as tipo, t.grupo, e.nombre, e.estado, e.permanencia,
       e.observaciones, e.area_ha,
       extensions.st_y(extensions.st_pointonsurface(e.geom)) as latitud,
       extensions.st_x(extensions.st_pointonsurface(e.geom)) as longitud,
       (extensions.st_asgeojson(e.geom, 7))::json as geojson,
       e.creado_por, e.creado_en, e.escenario
  from productores.elemento_area e
  join productores.tipo_elemento t on t.id = e.tipo_id;
revoke all on productores.v_elemento_area from public, anon;
grant select on productores.v_elemento_area to authenticated, sig_editor, arcgis_lector, service_role;

-- b) Secaderos por separado --------------------------------------------------------------
update productores.tipo_elemento set nombre = 'Secadero de café' where nombre = 'Secadero de café o cacao';
insert into productores.tipo_elemento (nombre, geometria, grupo)
values ('Secadero de cacao', 'punto', 'Infraestructura') on conflict (nombre) do nothing;

-- c) Cultivo nuevo -------------------------------------------------------------------------
insert into productores.cultivo (nombre, tipo, codigo)
values ('Frutos del bosque (canangucha, asaí)', 'Forestal', 'frutos_bosque') on conflict (nombre) do nothing;

-- d) Acciones por sistema productivo ------------------------------------------------------
alter table productores.catalogo_accion add column if not exists cultivo_ids int[] not null default '{}';
comment on column productores.catalogo_accion.cultivo_ids is
  'Cultivos (sistemas productivos) a los que aplica la acción; vacío = acción general.';

-- Ganadería = Pastos y forrajes (19) y Forrajes / bancos de forraje (44)
update productores.catalogo_accion set cultivo_ids = '{19,44}'
 where nombre in ('Sistema silvopastoril', 'Bancos de proteína', 'Árboles dispersos en praderas', 'División de potreros con árboles');
update productores.catalogo_accion set cultivo_ids = '{53}' where nombre = 'Piscicultura';
update productores.catalogo_accion
   set cultivo_ids = array[4, 42, 43, 50, (select id from productores.cultivo where codigo = 'frutos_bosque')]
 where nombre = 'Parcela agroforestal (frutos amazónicos y maderables)';

insert into productores.catalogo_accion (nombre, tipo, unidad, activo, cultivo_ids)
select v.nombre, v.tipo, v.unidad, true, v.cultivos
  from (values
    -- Cacao (4)
    ('Poda de formación y mantenimiento del cacao', 'Producción sostenible', 'ha', '{4}'::int[]),
    ('Renovación o injertación de cacao', 'Producción sostenible', 'ha', '{4}'),
    ('Manejo de sombra en cacao', 'Producción sostenible', 'ha', '{4}'),
    ('Manejo integrado de enfermedades del cacao (monilia)', 'Producción sostenible', 'ha', '{4}'),
    ('Mejoramiento del beneficio de cacao (fermentación y secado)', 'Producción sostenible', 'sistemas', '{4}'),
    -- Café (1)
    ('Renovación de cafetales', 'Producción sostenible', 'ha', '{1}'),
    ('Sombrío en café', 'Producción sostenible', 'ha', '{1}'),
    ('Beneficio ecológico del café', 'Producción sostenible', 'sistemas', '{1}'),
    ('Manejo integrado de la broca', 'Producción sostenible', 'ha', '{1}'),
    -- Ganadería (19, 44)
    ('Rotación de potreros', 'Producción sostenible', 'ha', '{19,44}'),
    ('Acueducto ganadero y bebederos', 'Producción sostenible', 'sistemas', '{19,44}'),
    ('Mejoramiento genético del ganado', 'Producción sostenible', 'animales', '{19,44}'),
    ('Renovación de praderas con pastos mejorados', 'Producción sostenible', 'ha', '{19,44}'),
    ('Conservación de forraje (ensilaje o henolaje)', 'Producción sostenible', 'sistemas', '{19,44}'),
    -- Caña panelera (9)
    ('Renovación del cañaduzal', 'Producción sostenible', 'ha', '{9}'),
    ('Mejoramiento del trapiche', 'Producción sostenible', 'sistemas', '{9}'),
    -- Piscicultura (53)
    ('Mejoramiento de estanques', 'Producción sostenible', 'm² de espejo de agua', '{53}'),
    -- Especies menores (52)
    ('Mejoramiento de galpones y corrales', 'Producción sostenible', 'sistemas', '{52}'),
    -- Plátano (2) y aguacate (5)
    ('Renovación de platanera con semilla limpia', 'Producción sostenible', 'ha', '{2}'),
    ('Sistema de riego', 'Producción sostenible', 'ha', '{2,5}'),
    -- Frutales amazónicos, copoazú, arazá
    ('Establecimiento de frutales amazónicos', 'Diversificación', 'ha', '{42,43,50}'),
    -- Huerta y pancoger
    ('Huerta casera para la seguridad alimentaria', 'Diversificación', 'sistemas', '{51,28}'),
    -- Generales
    ('Turismo de naturaleza y aviturismo', 'Diversificación', 'sistemas', '{}'),
    ('Pago por servicios ambientales', 'Conservación', 'ha', '{}')
  ) as v(nombre, tipo, unidad, cultivos)
on conflict (nombre) do nothing;

insert into productores.catalogo_accion (nombre, tipo, unidad, activo, cultivo_ids)
select 'Aprovechamiento de frutos del bosque (canangucha, asaí)', 'Diversificación', 'ha', true,
       array[(select id from productores.cultivo where codigo = 'frutos_bosque')]
on conflict (nombre) do nothing;
