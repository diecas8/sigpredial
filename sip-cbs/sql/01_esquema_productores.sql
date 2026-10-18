-- =====================================================================
--  SIP-CBS · Sistema de Información de Productores
--  Corporación Biocomercio Sostenible
--
--  Esquema "productores" para Supabase (PostgreSQL + PostGIS)
--  Estructura jerárquica:  Productor  →  Predio  →  Lotes
--
--  CÓMO EJECUTARLO
--   1. Supabase › SQL Editor › New query
--   2. Pegue TODO este archivo y pulse RUN.
--   3. Siga la guía (README) para exponer el esquema y crear usuarios.
--
--  Puede ejecutarse más de una vez: no borra datos.
-- =====================================================================

create extension if not exists postgis with schema extensions;

create schema if not exists productores;
set search_path = productores, extensions, public;


-- =====================================================================
-- 1. CATÁLOGOS
-- =====================================================================
create table if not exists productores.departamento (
  cod_dpto   char(2) primary key,
  nombre     text not null
);

create table if not exists productores.municipio (
  cod_mpio   char(5) primary key,
  nombre     text not null,
  cod_dpto   char(2) not null references productores.departamento(cod_dpto) on update cascade
);

create table if not exists productores.vereda (
  id          uuid primary key default gen_random_uuid(),
  cod_vereda  text,
  nombre      text not null,
  cod_mpio    char(5) not null references productores.municipio(cod_mpio) on update cascade,
  creado_en   timestamptz not null default now(),
  constraint uq_vereda_mpio unique (cod_mpio, nombre)
);

create table if not exists productores.cultivo (
  id      serial primary key,
  nombre  text not null unique,
  tipo    text
);

create table if not exists productores.tenencia (
  id      serial primary key,
  nombre  text not null unique
);


-- =====================================================================
-- 2. USUARIOS DE LA APLICACIÓN (perfil y rol de cada técnico)
--    rol: tecnico | coordinador | admin
-- =====================================================================
create table if not exists productores.usuario_app (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  correo     text,
  rol        text not null default 'tecnico' check (rol in ('tecnico','coordinador','admin')),
  region     text,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);


-- =====================================================================
-- 3. PRODUCTOR
-- =====================================================================
create table if not exists productores.productor (
  id             uuid primary key default gen_random_uuid(),
  tipo_doc       text check (tipo_doc in ('CC','TI','CE','PPT','NIT','Otro')),
  num_doc        text not null unique,
  nombres        text not null,
  apellidos      text,
  sexo           text check (sexo in ('Mujer','Hombre','Otro')),
  fecha_nac      date,
  telefono       text,
  correo         text,
  asociacion     text,
  observaciones  text,
  creado_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now(),
  editado_por    uuid,
  editado_en     timestamptz
);


-- =====================================================================
-- 4. PREDIO
-- =====================================================================
create table if not exists productores.predio (
  id                  uuid primary key default gen_random_uuid(),
  cod_predio          text unique,                 -- lo asigna la base: 76863-0001
  productor_id        uuid not null references productores.productor(id) on delete restrict,
  nombre              text not null,
  num_predial         text,
  matricula           text,
  tenencia_id         int references productores.tenencia(id),
  area_declarada_ha   numeric(12,4) check (area_declarada_ha is null or area_declarada_ha > 0),
  cod_mpio            char(5) not null references productores.municipio(cod_mpio) on update cascade,
  vereda_id           uuid references productores.vereda(id),
  altitud_msnm        int check (altitud_msnm is null or altitud_msnm between 0 and 5800),
  como_llegar         text,
  area_sig_ha         numeric(12,4),               -- calculada desde la geometría
  punto               geometry(Point, 4326),       -- ubicación (centro del predio o punto GPS)
  geom                geometry(MultiPolygon, 4326),
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now(),
  editado_por         uuid,
  editado_en          timestamptz
);
create index if not exists ix_predio_geom      on productores.predio using gist (geom);
create index if not exists ix_predio_productor on productores.predio (productor_id);
create index if not exists ix_predio_mpio      on productores.predio (cod_mpio);


-- =====================================================================
-- 5. LOTE (siempre pertenece a un predio)
-- =====================================================================
create table if not exists productores.lote (
  id                  uuid primary key default gen_random_uuid(),
  cod_lote            text unique,                 -- lo asigna la base: 76863-0001-L01
  num_lote            int,
  predio_id           uuid not null references productores.predio(id) on delete cascade,
  cultivo_id          int references productores.cultivo(id),
  variedad            text,
  fecha_siembra       date,
  area_declarada_ha   numeric(12,4) check (area_declarada_ha is null or area_declarada_ha > 0),
  area_sig_ha         numeric(12,4),
  num_plantas         int check (num_plantas is null or num_plantas >= 0),
  dist_surcos_m       numeric(6,2) check (dist_surcos_m is null or dist_surcos_m > 0),
  dist_plantas_m      numeric(6,2) check (dist_plantas_m is null or dist_plantas_m > 0),
  densidad_ha         numeric(10,0) generated always as
                        (case when dist_surcos_m > 0 and dist_plantas_m > 0
                              then round(10000 / (dist_surcos_m * dist_plantas_m)) end) stored,
  sistema             text check (sistema in ('Libre exposición','Semisombra','Sombra','Agroforestal','Silvopastoril','Asociado')),
  sombrio             text,
  estado              text check (estado in ('Levante','Producción','Renovación','Zoca','Abandonado')),
  observaciones       text,
  geom                geometry(MultiPolygon, 4326),
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now(),
  editado_por         uuid,
  editado_en          timestamptz,
  constraint uq_lote_num unique (predio_id, num_lote)
);
create index if not exists ix_lote_geom   on productores.lote using gist (geom);
create index if not exists ix_lote_predio on productores.lote (predio_id);


-- Contador de consecutivos de predio por municipio
create table if not exists productores.contador_predio (
  cod_mpio  char(5) primary key references productores.municipio(cod_mpio),
  ultimo    int not null default 0
);


-- =====================================================================
-- 6. FUNCIONES Y TRIGGERS
-- =====================================================================

-- Geometría limpia: válida, solo polígonos, multipolígono, SRID 4326
create or replace function productores.limpiar_poligono(g geometry)
returns geometry
language sql immutable
set search_path = productores, extensions, public
as $$
  select case
    when g is null then null
    else ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(g, 4326)), 3))
  end
$$;

-- Auditoría de edición
create or replace function productores.tg_auditoria()
returns trigger
language plpgsql
set search_path = productores, extensions, public
as $$
begin
  new.editado_por := auth.uid();
  new.editado_en  := now();
  return new;
end $$;

-- ---------- PREDIO ----------
create or replace function productores.tg_predio()
returns trigger
language plpgsql
security definer
set search_path = productores, extensions, public
as $$
declare
  n int;
begin
  -- Geometría, área y punto
  new.geom := productores.limpiar_poligono(new.geom);
  if new.geom is not null and ST_IsEmpty(new.geom) then
    new.geom := null;
  end if;
  if new.geom is not null then
    new.area_sig_ha := round((ST_Area(new.geom::geography) / 10000)::numeric, 4);
    new.punto       := ST_PointOnSurface(new.geom);
  else
    new.area_sig_ha := null;
  end if;

  -- La vereda debe pertenecer al municipio
  if new.vereda_id is not null and not exists (
       select 1 from productores.vereda v
        where v.id = new.vereda_id and v.cod_mpio = new.cod_mpio) then
    raise exception 'La vereda seleccionada no pertenece al municipio %', new.cod_mpio;
  end if;

  if tg_op = 'INSERT' then
    -- Código jerárquico: municipio + consecutivo (no se repite aunque varios técnicos guarden a la vez)
    if new.cod_predio is null then
      insert into productores.contador_predio as c (cod_mpio, ultimo)
      values (new.cod_mpio, 1)
      on conflict (cod_mpio) do update set ultimo = c.ultimo + 1
      returning ultimo into n;
      new.cod_predio := new.cod_mpio || '-' || lpad(n::text, 4, '0');
    end if;
  else
    -- El código no cambia nunca
    new.cod_predio := old.cod_predio;
  end if;
  return new;
end $$;

drop trigger if exists t10_predio on productores.predio;
create trigger t10_predio before insert or update on productores.predio
  for each row execute function productores.tg_predio();

drop trigger if exists t20_predio_audit on productores.predio;
create trigger t20_predio_audit before update on productores.predio
  for each row execute function productores.tg_auditoria();


-- ---------- LOTE ----------
create or replace function productores.tg_lote()
returns trigger
language plpgsql
security definer
set search_path = productores, extensions, public
as $$
declare
  v_predio      productores.predio%rowtype;
  v_fuera       numeric;
  v_area_lote   numeric;
begin
  new.geom := productores.limpiar_poligono(new.geom);
  if new.geom is not null and ST_IsEmpty(new.geom) then
    new.geom := null;
  end if;

  -- Si no trae predio, se asigna el predio que lo contiene
  if new.predio_id is null and new.geom is not null then
    select p.id into new.predio_id
      from productores.predio p
     where p.geom is not null
       and ST_Intersects(p.geom, ST_PointOnSurface(new.geom))
     limit 1;
  end if;
  if new.predio_id is null then
    raise exception 'El lote debe pertenecer a un predio. Dibújelo dentro de un predio o selecciónelo.';
  end if;

  select * into v_predio from productores.predio where id = new.predio_id for update;

  -- Regla: el lote debe quedar dentro de su predio (tolerancia 5 % del área del lote)
  if new.geom is not null and v_predio.geom is not null then
    v_area_lote := ST_Area(new.geom::geography);
    if v_area_lote > 0 then
      v_fuera := ST_Area(ST_Difference(new.geom, v_predio.geom)::geography) / v_area_lote;
      if v_fuera > 0.05 then
        raise exception 'El lote se sale del predio % (% %% de su área queda por fuera).',
          v_predio.cod_predio, round(v_fuera * 100, 1);
      end if;
    end if;
  end if;

  if new.geom is not null then
    new.area_sig_ha := round((ST_Area(new.geom::geography) / 10000)::numeric, 4);
  else
    new.area_sig_ha := null;
  end if;

  if tg_op = 'INSERT' then
    if new.num_lote is null then
      select coalesce(max(num_lote), 0) + 1 into new.num_lote
        from productores.lote where predio_id = new.predio_id;
    end if;
    new.cod_lote := v_predio.cod_predio || '-L' || lpad(new.num_lote::text, 2, '0');
  else
    -- El lote no cambia de predio ni de código
    new.predio_id := old.predio_id;
    new.num_lote  := old.num_lote;
    new.cod_lote  := old.cod_lote;
  end if;
  return new;
end $$;

drop trigger if exists t10_lote on productores.lote;
create trigger t10_lote before insert or update on productores.lote
  for each row execute function productores.tg_lote();

drop trigger if exists t20_lote_audit on productores.lote;
create trigger t20_lote_audit before update on productores.lote
  for each row execute function productores.tg_auditoria();

drop trigger if exists t20_productor_audit on productores.productor;
create trigger t20_productor_audit before update on productores.productor
  for each row execute function productores.tg_auditoria();


-- ---------- Funciones de rol (usadas por las políticas) ----------
create or replace function productores.usuario_activo()
returns boolean
language sql stable security definer
set search_path = productores, public
as $$
  select exists (select 1 from productores.usuario_app
                  where user_id = auth.uid() and activo)
$$;

create or replace function productores.es_coordinador()
returns boolean
language sql stable security definer
set search_path = productores, public
as $$
  select exists (select 1 from productores.usuario_app
                  where user_id = auth.uid() and activo and rol in ('coordinador','admin'))
$$;

create or replace function productores.es_admin()
returns boolean
language sql stable security definer
set search_path = productores, public
as $$
  select exists (select 1 from productores.usuario_app
                  where user_id = auth.uid() and activo and rol = 'admin')
$$;


-- =====================================================================
-- 7. VISTAS PARA LA APP WEB (geometrías en GeoJSON)
-- =====================================================================
create or replace view productores.v_predio
with (security_invoker = true) as
select p.id, p.cod_predio, p.productor_id, p.nombre, p.num_predial, p.matricula,
       p.tenencia_id, t.nombre as tenencia,
       p.area_declarada_ha, p.area_sig_ha,
       p.cod_mpio, m.nombre as municipio, p.vereda_id, v.nombre as vereda,
       p.altitud_msnm, p.como_llegar,
       ST_Y(p.punto) as latitud, ST_X(p.punto) as longitud,
       ST_AsGeoJSON(p.geom, 7)::json as geojson,
       pr.num_doc, trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       (select count(*) from productores.lote l where l.predio_id = p.id) as n_lotes,
       (select sum(coalesce(l.area_sig_ha, l.area_declarada_ha)) from productores.lote l where l.predio_id = p.id) as area_lotes_ha,
       p.creado_por, p.creado_en, p.editado_en
  from productores.predio p
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m  on m.cod_mpio = p.cod_mpio
  left join productores.vereda v   on v.id = p.vereda_id
  left join productores.tenencia t on t.id = p.tenencia_id;

create or replace view productores.v_lote
with (security_invoker = true) as
select l.id, l.cod_lote, l.num_lote, l.predio_id, p.cod_predio, p.nombre as predio,
       l.cultivo_id, c.nombre as cultivo, l.variedad, l.fecha_siembra,
       case when l.fecha_siembra is not null
            then (extract(year from age(current_date, l.fecha_siembra)) * 12
                + extract(month from age(current_date, l.fecha_siembra)))::int end as edad_meses,
       l.area_declarada_ha, l.area_sig_ha, l.num_plantas, l.dist_surcos_m, l.dist_plantas_m,
       l.densidad_ha, l.sistema, l.sombrio, l.estado, l.observaciones,
       ST_AsGeoJSON(l.geom, 7)::json as geojson,
       l.creado_por, l.creado_en, l.editado_en
  from productores.lote l
  join productores.predio p on p.id = l.predio_id
  left join productores.cultivo c on c.id = l.cultivo_id;


-- =====================================================================
-- 8. SEGURIDAD: GRANTs + RLS + POLÍTICAS
--    (anon recibe GRANT por convención, pero ninguna política: no ve datos.
--     Los datos de productores son personales — Ley 1581 de 2012.)
-- =====================================================================
grant usage on schema productores to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema productores to anon, authenticated, service_role;
grant usage, select on all sequences in schema productores to anon, authenticated, service_role;
grant execute on all functions in schema productores to anon, authenticated, service_role;
alter default privileges in schema productores grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema productores grant usage, select on sequences to anon, authenticated, service_role;

alter table productores.departamento    enable row level security;
alter table productores.municipio       enable row level security;
alter table productores.vereda          enable row level security;
alter table productores.cultivo         enable row level security;
alter table productores.tenencia        enable row level security;
alter table productores.usuario_app     enable row level security;
alter table productores.productor       enable row level security;
alter table productores.predio          enable row level security;
alter table productores.lote            enable row level security;
alter table productores.contador_predio enable row level security;

do $$
declare
  t text;
begin
  -- Catálogos: lectura para usuarios activos; escritura para coordinador/admin
  foreach t in array array['departamento','municipio','cultivo','tenencia'] loop
    execute format('drop policy if exists %I on productores.%I', t || '_leer', t);
    execute format('create policy %I on productores.%I for select to authenticated using (productores.usuario_activo())', t || '_leer', t);
    execute format('drop policy if exists %I on productores.%I', t || '_editar', t);
    execute format('create policy %I on productores.%I for all to authenticated using (productores.es_coordinador()) with check (productores.es_coordinador())', t || '_editar', t);
  end loop;
end $$;

-- Veredas: cualquier técnico activo puede agregar una vereda nueva
drop policy if exists vereda_leer on productores.vereda;
create policy vereda_leer on productores.vereda for select to authenticated using (productores.usuario_activo());
drop policy if exists vereda_crear on productores.vereda;
create policy vereda_crear on productores.vereda for insert to authenticated with check (productores.usuario_activo());
drop policy if exists vereda_editar on productores.vereda;
create policy vereda_editar on productores.vereda for update to authenticated using (productores.es_coordinador()) with check (productores.es_coordinador());
drop policy if exists vereda_borrar on productores.vereda;
create policy vereda_borrar on productores.vereda for delete to authenticated using (productores.es_admin());

-- Usuarios: cada uno ve su perfil; el admin gestiona todos
drop policy if exists usuario_ver on productores.usuario_app;
create policy usuario_ver on productores.usuario_app for select to authenticated
  using (user_id = auth.uid() or productores.es_coordinador());
drop policy if exists usuario_admin on productores.usuario_app;
create policy usuario_admin on productores.usuario_app for all to authenticated
  using (productores.es_admin()) with check (productores.es_admin());

-- Productor, predio, lote:
--   ver: todos los usuarios activos
--   crear: todos los usuarios activos
--   editar: quien creó el registro, o coordinador/admin
--   borrar: solo admin
do $$
declare
  t text;
begin
  foreach t in array array['productor','predio','lote'] loop
    execute format('drop policy if exists %I on productores.%I', t || '_ver', t);
    execute format('create policy %I on productores.%I for select to authenticated using (productores.usuario_activo())', t || '_ver', t);
    execute format('drop policy if exists %I on productores.%I', t || '_crear', t);
    execute format('create policy %I on productores.%I for insert to authenticated with check (productores.usuario_activo())', t || '_crear', t);
    execute format('drop policy if exists %I on productores.%I', t || '_editar', t);
    execute format('create policy %I on productores.%I for update to authenticated using (productores.usuario_activo() and (creado_por = auth.uid() or productores.es_coordinador())) with check (productores.usuario_activo())', t || '_editar', t);
    execute format('drop policy if exists %I on productores.%I', t || '_borrar', t);
    execute format('create policy %I on productores.%I for delete to authenticated using (productores.es_admin())', t || '_borrar', t);
  end loop;
end $$;


-- =====================================================================
-- 9. ROLES DE BASE DE DATOS PARA QGIS / QFIELD Y ARCGIS PRO
--    Cambie las contraseñas antes de ejecutar.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sig_editor') then
    create role sig_editor login password 'CAMBIAR_CLAVE_EDITOR';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'arcgis_lector') then
    create role arcgis_lector login password 'CAMBIAR_CLAVE_LECTOR';
  end if;
end $$;

grant usage on schema productores, extensions to sig_editor, arcgis_lector;
grant select, insert, update, delete on all tables in schema productores to sig_editor;
grant usage, select on all sequences in schema productores to sig_editor;
grant select on all tables in schema productores to arcgis_lector;

do $$
declare
  t text;
begin
  foreach t in array array['departamento','municipio','vereda','cultivo','tenencia',
                           'productor','predio','lote','contador_predio'] loop
    execute format('drop policy if exists %I on productores.%I', t || '_sig_editor', t);
    execute format('create policy %I on productores.%I for all to sig_editor using (true) with check (true)', t || '_sig_editor', t);
    execute format('drop policy if exists %I on productores.%I', t || '_arcgis', t);
    execute format('create policy %I on productores.%I for select to arcgis_lector using (true)', t || '_arcgis', t);
  end loop;
end $$;


-- =====================================================================
-- 10. DATOS INICIALES DE CATÁLOGOS
-- =====================================================================
insert into productores.departamento (cod_dpto, nombre) values ('76', 'Valle del Cauca')
on conflict (cod_dpto) do nothing;

insert into productores.municipio (cod_mpio, nombre, cod_dpto) values
 ('76001','Cali','76'), ('76020','Alcalá','76'), ('76036','Andalucía','76'),
 ('76041','Ansermanuevo','76'), ('76054','Argelia','76'), ('76100','Bolívar','76'),
 ('76109','Buenaventura','76'), ('76111','Buga','76'), ('76113','Bugalagrande','76'),
 ('76122','Caicedonia','76'), ('76126','Calima (El Darién)','76'), ('76130','Candelaria','76'),
 ('76147','Cartago','76'), ('76233','Dagua','76'), ('76243','El Águila','76'),
 ('76246','El Cairo','76'), ('76248','El Cerrito','76'), ('76250','El Dovio','76'),
 ('76275','Florida','76'), ('76306','Ginebra','76'), ('76318','Guacarí','76'),
 ('76364','Jamundí','76'), ('76377','La Cumbre','76'), ('76400','La Unión','76'),
 ('76403','La Victoria','76'), ('76497','Obando','76'), ('76520','Palmira','76'),
 ('76563','Pradera','76'), ('76606','Restrepo','76'), ('76616','Riofrío','76'),
 ('76622','Roldanillo','76'), ('76670','San Pedro','76'), ('76736','Sevilla','76'),
 ('76823','Toro','76'), ('76828','Trujillo','76'), ('76834','Tuluá','76'),
 ('76845','Ulloa','76'), ('76863','Versalles','76'), ('76869','Vijes','76'),
 ('76890','Yotoco','76'), ('76892','Yumbo','76'), ('76895','Zarzal','76')
on conflict (cod_mpio) do nothing;

insert into productores.cultivo (nombre, tipo) values
 ('Café','Permanente'), ('Plátano','Permanente'), ('Banano','Permanente'), ('Cacao','Permanente'),
 ('Aguacate','Permanente'), ('Cítricos','Permanente'), ('Mora','Permanente'), ('Guayaba','Permanente'),
 ('Caña panelera','Semipermanente'), ('Lulo','Semipermanente'), ('Granadilla','Semipermanente'),
 ('Maracuyá','Semipermanente'), ('Tomate de árbol','Semipermanente'), ('Piña','Semipermanente'),
 ('Yuca','Transitorio'), ('Maíz','Transitorio'), ('Fríjol','Transitorio'), ('Hortalizas','Transitorio'),
 ('Pastos y forrajes','Pecuario'), ('Bosque / forestal','Forestal'), ('Otro','Otro')
on conflict (nombre) do nothing;

insert into productores.tenencia (nombre) values
 ('Propietario'), ('Poseedor'), ('Arrendatario'), ('Comodato'), ('Usufructo'),
 ('Sucesión ilíquida'), ('Ocupante de baldío'), ('Otro')
on conflict (nombre) do nothing;

-- Fin del script
