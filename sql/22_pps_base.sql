-- =========================================================================
--  22 · Planificación Predial Sostenible (PPS) — base de datos
--  PROPUESTA (no aplicada). Productos 3 (finca soñada) y 4 (plan de acción).
--
--   a) Catálogos: zona_pps, catalogo_accion, catalogo_apoyo.
--   b) lote: escenario ('actual' | 'propuesto'), zona_pps_id, cobertura_clc.
--      Recorte y no traslape SOLO dentro del mismo escenario. Numeración
--      propia: L01, L02… (actual) y P01, P02… (propuesto).
--   c) predio: prospectiva (visión, taller, participantes) y selección
--      (criterios 35/35/30 y habilitantes).
--   d) plan_accion con RLS heredada del predio.
--   e) Vistas, semáforo, tablero y funciones de lotes: cuentan solo el
--      escenario 'actual' (lo propuesto no altera los indicadores de hoy).
--   f) copiar_lotes_a_propuesto(predio): punto de partida de la finca soñada.
--  Todo lo nuevo lleva creado_por, creado_en, editado_por, editado_en.
-- =========================================================================

-- a) Catálogos -------------------------------------------------------------
create table productores.zona_pps (
  id          smallint generated always as identity primary key,
  codigo      text not null unique,
  nombre      text not null unique,
  color       text not null,
  orden       smallint not null,
  creado_por  uuid default productores.usuario_actual(),
  creado_en   timestamptz not null default now(),
  editado_por uuid,
  editado_en  timestamptz
);
insert into productores.zona_pps (codigo, nombre, color, orden) values
  ('preservacion',          'Preservación',          '#1b5e20', 1),
  ('restauracion',          'Restauración',          '#7cb342', 2),
  ('recuperacion',          'Recuperación',          '#f9a825', 3),
  ('produccion_sostenible', 'Producción sostenible', '#8d6e63', 4);

create table productores.catalogo_accion (
  id          integer generated always as identity primary key,
  nombre      text not null unique,
  tipo        text not null check (tipo in ('Conservación', 'Restauración', 'Producción sostenible', 'Diversificación')),
  unidad      text not null,
  activo      boolean not null default true,
  creado_por  uuid default productores.usuario_actual(),
  creado_en   timestamptz not null default now(),
  editado_por uuid,
  editado_en  timestamptz
);
insert into productores.catalogo_accion (nombre, tipo, unidad) values
  ('Cierre de frontera agrícola',                                 'Conservación',          'ha'),
  ('Protección de nacimientos y cauces',                          'Conservación',          'm'),
  ('Árboles dispersos en praderas',                               'Restauración',          'árboles'),
  ('Cercas vivas',                                                'Restauración',          'm'),
  ('Sistema silvopastoril',                                       'Producción sostenible', 'ha'),
  ('Bancos de proteína',                                          'Producción sostenible', 'ha'),
  ('Parcela agroforestal (frutos amazónicos y maderables)',       'Producción sostenible', 'ha'),
  ('Piscicultura',                                                'Diversificación',       'm² de espejo de agua'),
  ('Meliponicultura',                                             'Diversificación',       'colmenas'),
  ('Cosecha de agua lluvia',                                      'Producción sostenible', 'sistemas'),
  ('Paneles solares',                                             'Producción sostenible', 'sistemas');

create table productores.catalogo_apoyo (
  codigo      text primary key,
  nombre      text not null unique,
  activo      boolean not null default true,
  creado_por  uuid default productores.usuario_actual(),
  creado_en   timestamptz not null default now(),
  editado_por uuid,
  editado_en  timestamptz
);
insert into productores.catalogo_apoyo (codigo, nombre) values
  ('asistencia_tecnica',      'Asistencia técnica'),
  ('semillas',                'Semillas'),
  ('insumos',                 'Insumos'),
  ('cerramientos',            'Cerramientos / alambre'),
  ('infraestructura_hidrica', 'Infraestructura hídrica');

do $$
declare t text;
begin
  foreach t in array array['zona_pps', 'catalogo_accion', 'catalogo_apoyo'] loop
    execute format('create trigger t20_%1$s_audit before update on productores.%1$I for each row execute function productores.tg_auditoria()', t);
    execute format('alter table productores.%I enable row level security', t);
    execute format('create policy %1$s_ver on productores.%1$I for select to authenticated, arcgis_lector using (true)', t);
    execute format('create policy %1$s_admin on productores.%1$I for all to authenticated using (productores.es_admin()) with check (productores.es_admin())', t);
    execute format('create policy %1$s_sig_editor on productores.%1$I for all to sig_editor using (true) with check (true)', t);
    execute format('revoke all on productores.%I from public, anon', t);
    execute format('grant select, insert, update, delete on productores.%I to authenticated, sig_editor', t);
    execute format('grant select on productores.%I to arcgis_lector', t);
  end loop;
end $$;

-- b) Lote: escenario, zona PPS y cobertura -----------------------------------
alter table productores.lote
  add column escenario text not null default 'actual' check (escenario in ('actual', 'propuesto')),
  add column zona_pps_id smallint references productores.zona_pps (id),
  add column cobertura_clc text;

alter table productores.lote drop constraint uq_lote_num;
alter table productores.lote add constraint uq_lote_num unique (predio_id, escenario, num_lote);
create index ix_lote_predio_escenario on productores.lote (predio_id, escenario);

create or replace function productores.tg_lote()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'productores', 'extensions', 'public'
as $function$
declare
  v_predio      productores.predio%rowtype;
  v_otros       geometry;
begin
  new.geom := productores.limpiar_poligono(new.geom);
  if new.geom is not null and ST_IsEmpty(new.geom) then
    new.geom := null;
  end if;

  if tg_op = 'UPDATE' then
    -- El lote no cambia de predio, código ni escenario (para pasar a propuesto se copia)
    new.predio_id := old.predio_id;
    new.num_lote  := old.num_lote;
    new.cod_lote  := old.cod_lote;
    new.escenario := old.escenario;
  end if;
  new.escenario := coalesce(new.escenario, 'actual');

  -- Si no trae predio, se asigna el predio que contiene su centro
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

  if new.geom is not null then
    -- 1) Recortar al límite del predio
    if v_predio.geom is not null then
      new.geom := productores.limpiar_poligono(ST_Intersection(new.geom, v_predio.geom));
    end if;

    -- 2) Quitar lo que se monta sobre los demás lotes del mismo predio Y DEL MISMO ESCENARIO
    select ST_Union(l.geom) into v_otros
      from productores.lote l
     where l.predio_id = new.predio_id
       and l.escenario = new.escenario
       and l.id <> new.id
       and l.geom is not null;
    if v_otros is not null and new.geom is not null then
      new.geom := productores.limpiar_poligono(ST_Difference(new.geom, v_otros));
    end if;

    -- 3) Eliminar astillas (< 1 m²)
    if new.geom is not null and not ST_IsEmpty(new.geom) then
      new.geom := productores.quitar_astillas(new.geom, 1);
    end if;

    if new.geom is null or ST_IsEmpty(new.geom) then
      raise exception 'El lote no tiene área libre dentro del predio % (escenario %): queda por fuera o encima de otros lotes.',
        v_predio.cod_predio, new.escenario;
    end if;
  end if;

  if new.geom is not null then
    new.area_sig_ha := productores.area_ha(new.geom);
  else
    new.area_sig_ha := null;
  end if;

  if tg_op = 'INSERT' then
    if new.num_lote is null then
      select coalesce(max(num_lote), 0) + 1 into new.num_lote
        from productores.lote where predio_id = new.predio_id and escenario = new.escenario;
    end if;
    new.cod_lote := v_predio.cod_predio || case when new.escenario = 'propuesto' then '-P' else '-L' end
                    || lpad(new.num_lote::text, 2, '0');
  end if;
  return new;
end $function$;

-- c) Predio: prospectiva y selección ------------------------------------------
alter table productores.predio
  add column vision_familia        text,
  add column fecha_taller          date,
  add column participantes_hombres integer check (participantes_hombres >= 0),
  add column participantes_mujeres integer check (participantes_mujeres >= 0),
  add column participantes_jovenes integer check (participantes_jovenes >= 0),
  add column crit_ambiental        numeric(5, 2) check (crit_ambiental between 0 and 100),
  add column crit_territorio       numeric(5, 2) check (crit_territorio between 0 and 100),
  add column crit_mejora           numeric(5, 2) check (crit_mejora between 0 and 100),
  add column puntaje_seleccion     numeric(5, 2) generated always as
             (round(0.35 * crit_ambiental + 0.35 * crit_territorio + 0.30 * crit_mejora, 2)) stored,
  add column hab_voluntaria        boolean,
  add column hab_arraigo           boolean,
  add column hab_acceso            boolean,
  add column hab_jac               boolean;

-- d) Plan de acción -------------------------------------------------------------
create table productores.plan_accion (
  id            uuid primary key default gen_random_uuid(),
  predio_id     uuid not null references productores.predio (id) on delete cascade,
  accion_id     integer not null references productores.catalogo_accion (id),
  lote_id       uuid references productores.lote (id) on delete set null,
  cantidad      numeric(12, 2) check (cantidad is null or cantidad > 0),
  unidad        text,
  plazo         text check (plazo in ('corto', 'mediano', 'largo')),
  prioridad     smallint check (prioridad between 1 and 3),
  apoyos        text[] not null default '{}',
  responsable   text,
  estado        text not null default 'borrador' check (estado in ('borrador', 'concertado')),
  observaciones text,
  creado_por    uuid default productores.usuario_actual(),
  creado_en     timestamptz not null default now(),
  editado_por   uuid,
  editado_en    timestamptz
);
create index ix_plan_accion_predio on productores.plan_accion (predio_id);
create index ix_plan_accion_accion on productores.plan_accion (accion_id);

create or replace function productores.tg_plan_accion()
 returns trigger language plpgsql
 set search_path to 'productores', 'extensions', 'public'
as $$
declare v_malos text;
begin
  if tg_op = 'UPDATE' then
    new.predio_id := old.predio_id;               -- la acción no cambia de predio
  end if;
  if new.lote_id is not null and not exists (
       select 1 from productores.lote l where l.id = new.lote_id and l.predio_id = new.predio_id) then
    raise exception 'El lote elegido no pertenece a este predio.';
  end if;
  new.unidad := coalesce(nullif(trim(new.unidad), ''),
                         (select a.unidad from productores.catalogo_accion a where a.id = new.accion_id));
  new.apoyos := coalesce(new.apoyos, '{}');
  select string_agg(x, ', ') into v_malos
    from unnest(new.apoyos) x
   where not exists (select 1 from productores.catalogo_apoyo c where c.codigo = x and c.activo);
  if v_malos is not null then
    raise exception 'Apoyo no reconocido: %', v_malos;
  end if;
  return new;
end $$;

create trigger t10_plan_accion before insert or update on productores.plan_accion
  for each row execute function productores.tg_plan_accion();
create trigger t20_plan_accion_audit before update on productores.plan_accion
  for each row execute function productores.tg_auditoria();

alter table productores.plan_accion enable row level security;
create policy plan_accion_ver on productores.plan_accion for select to authenticated
  using (productores.ve_predio(predio_id));
create policy plan_accion_crear on productores.plan_accion for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_predio(predio_id));
create policy plan_accion_editar on productores.plan_accion for update to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_predio(predio_id));
create policy plan_accion_borrar on productores.plan_accion for delete to authenticated
  using (productores.usuario_activo() and productores.ve_predio(predio_id));
create policy plan_accion_arcgis on productores.plan_accion for select to arcgis_lector using (true);
create policy plan_accion_sig_editor on productores.plan_accion for all to sig_editor using (true) with check (true);
revoke all on productores.plan_accion from public, anon;
grant select, insert, update, delete on productores.plan_accion to authenticated, sig_editor;
grant select on productores.plan_accion to arcgis_lector;

-- e) Lo propuesto no altera los indicadores de hoy ----------------------------
-- v_lote: columnas nuevas al final (el portal decide qué escenario muestra)
create or replace view productores.v_lote with (security_invoker = true) as
 WITH base AS (
         SELECT l_1.id, l_1.cod_lote, l_1.num_lote, l_1.predio_id, l_1.cultivo_id, l_1.variedad, l_1.fecha_siembra,
            l_1.area_declarada_ha, l_1.area_sig_ha, l_1.num_plantas, l_1.dist_surcos_m, l_1.dist_plantas_m,
            l_1.densidad_ha, l_1.sistema, l_1.sombrio, l_1.estado, l_1.observaciones, l_1.geom, l_1.creado_por,
            l_1.creado_en, l_1.editado_por, l_1.editado_en, l_1.trazado,
                CASE
                    WHEN l_1.dist_surcos_m > 0::numeric AND l_1.dist_plantas_m > 0::numeric THEN 10000.0 / (l_1.dist_surcos_m * l_1.dist_plantas_m *
                    CASE
                        WHEN l_1.trazado = 'Tresbolillo'::text THEN 0.866
                        ELSE 1::numeric
                    END)
                    ELSE NULL::numeric
                END AS dens,
            l_1.escenario, l_1.zona_pps_id, l_1.cobertura_clc
           FROM productores.lote l_1
        )
 SELECT l.id, l.cod_lote, l.num_lote, l.predio_id, p.cod_predio, p.nombre AS predio, l.cultivo_id,
    c.nombre AS cultivo, c.tipo AS tipo_cobertura, l.variedad, l.fecha_siembra,
        CASE
            WHEN l.fecha_siembra IS NOT NULL THEN (EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, l.fecha_siembra::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(CURRENT_DATE::timestamp with time zone, l.fecha_siembra::timestamp with time zone)))::integer
            ELSE NULL::integer
        END AS edad_meses,
    l.area_declarada_ha, l.area_sig_ha, l.num_plantas, l.dist_surcos_m, l.dist_plantas_m, l.trazado,
    round(l.dens) AS densidad_ha,
    round(l.dens * l.area_sig_ha) AS sitios_estimados,
        CASE
            WHEN (l.dens * l.area_sig_ha) > 0::numeric AND l.num_plantas IS NOT NULL THEN round(100.0 * l.num_plantas::numeric / (l.dens * l.area_sig_ha), 1)
            ELSE NULL::numeric
        END AS ocupacion_pct,
    l.sistema, l.sombrio, l.estado, l.observaciones,
    st_asgeojson(l.geom, 7)::json AS geojson,
    l.creado_por, l.creado_en, l.editado_en,
    l.escenario, l.zona_pps_id, z.nombre AS zona_pps, z.color AS zona_color, l.cobertura_clc
   FROM base l
     JOIN productores.predio p ON p.id = l.predio_id
     LEFT JOIN productores.cultivo c ON c.id = l.cultivo_id
     LEFT JOIN productores.zona_pps z ON z.id = l.zona_pps_id;

-- Resúmenes de Access: solo lo actual
create or replace view productores.r_resumen_coberturas with (security_invoker = true) as
 SELECT d.nombre AS departamento, m.nombre AS municipio,
    COALESCE(c.tipo, 'Sin clasificar'::text) AS tipo_cobertura,
    count(*)::integer AS n_lotes, count(DISTINCT p.id)::integer AS n_predios,
    count(DISTINCT p.productor_id)::integer AS n_productores,
    round(sum(COALESCE(l.area_sig_ha, l.area_declarada_ha, 0::numeric)), 2)::double precision AS area_ha
   FROM productores.lote l
     JOIN productores.predio p ON p.id = l.predio_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     LEFT JOIN productores.cultivo c ON c.id = l.cultivo_id
  WHERE l.escenario = 'actual'
  GROUP BY d.nombre, m.nombre, (COALESCE(c.tipo, 'Sin clasificar'::text));

create or replace view productores.r_resumen_cultivos with (security_invoker = true) as
 SELECT m.nombre AS municipio, COALESCE(c.nombre, 'Sin cultivo'::text) AS cultivo,
    count(*)::integer AS n_lotes, count(DISTINCT p.id)::integer AS n_predios,
    count(DISTINCT p.productor_id)::integer AS n_productores,
    round(sum(COALESCE(l.area_sig_ha, l.area_declarada_ha, 0::numeric)), 2)::double precision AS area_ha,
    sum(COALESCE(l.num_plantas, 0)) AS plantas,
    COALESCE(max(c.tipo), 'Sin clasificar'::text) AS tipo_cobertura
   FROM productores.lote l
     JOIN productores.predio p ON p.id = l.predio_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.cultivo c ON c.id = l.cultivo_id
  WHERE l.escenario = 'actual'
  GROUP BY m.nombre, (COALESCE(c.nombre, 'Sin cultivo'::text));
create or replace view productores.v_predio with (security_invoker = true) as
 SELECT p.id,
    p.cod_predio,
    p.productor_id,
    p.nombre,
    p.num_predial,
    p.matricula,
    p.tenencia_id,
    t.nombre AS tenencia,
    p.area_declarada_ha,
    p.area_sig_ha,
    p.cod_mpio,
    m.nombre AS municipio,
    p.vereda_id,
    v.nombre AS vereda,
    p.altitud_msnm,
    p.como_llegar,
    st_y(p.punto) AS latitud,
    st_x(p.punto) AS longitud,
    st_asgeojson(p.geom, 7)::json AS geojson,
    pr.num_doc,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    ( SELECT count(*) AS count
           FROM productores.lote l
          WHERE l.predio_id = p.id AND l.escenario = 'actual') AS n_lotes,
    ( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) AS sum
           FROM productores.lote l
          WHERE l.predio_id = p.id AND l.escenario = 'actual') AS area_lotes_ha,
    p.creado_por,
    p.creado_en,
    p.editado_en,
        CASE
            WHEN p.geom IS NULL THEN 'Pendiente de delimitar'::text
            ELSE 'Delimitado'::text
        END AS estado_limite,
    v.validada AS vereda_validada,
    p.cod_humboldt,
    productores.nivel_calidad(rv.pendientes) AS calidad,
    rv.pendientes
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id
     CROSS JOIN LATERAL (SELECT productores.revision_predio(p.id) AS pendientes) rv;

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
          WHERE l.predio_id = p.id AND l.escenario = 'actual'))::integer AS n_lotes,
    (( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) AS sum
           FROM productores.lote l
          WHERE l.predio_id = p.id AND l.escenario = 'actual'))::double precision AS area_lotes_ha,
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
    round(st_y(st_transform(p.punto, 9377))::numeric, 2)::double precision AS norte_9377,
    CASE productores.nivel_calidad(rv.pendientes)
        WHEN 'verde' THEN 'Completo' WHEN 'amarillo' THEN 'Por revisar' ELSE 'Incompleto'
    END AS calidad,
    left(array_to_string(ARRAY(SELECT substr(x, 3) FROM unnest(rv.pendientes) x), ' · '), 255) AS pendientes,
    CASE WHEN pr.num_doc LIKE 'PEND-%' THEN 'Falta' ELSE 'Sí' END AS documento_productor,
    (p.delimitado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_delimitacion
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id
     CROSS JOIN LATERAL (SELECT productores.revision_predio(p.id) AS pendientes) rv;

-- Lotes para Access: «Lotes» = lo actual (como hoy); «Lotes_propuestos» = la finca soñada
create or replace view productores.r_lotes with (security_invoker = true) as
 SELECT v.id::text AS id, v.cod_lote, v.num_lote, v.predio_id::text AS predio_id, v.cod_predio, v.predio, pr.num_doc,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    d.nombre AS departamento, m.nombre AS municipio, ve.nombre AS vereda, v.cultivo, v.tipo_cobertura,
    v.tipo_cobertura AS tipo_cultivo, v.variedad, v.fecha_siembra, v.edad_meses, v.estado, v.sistema, v.sombrio,
    v.area_declarada_ha::double precision AS area_declarada_ha, v.area_sig_ha::double precision AS area_sig_ha,
    v.num_plantas, v.dist_surcos_m::double precision AS dist_surcos_m, v.dist_plantas_m::double precision AS dist_plantas_m,
    v.trazado, v.densidad_ha::double precision AS densidad_ha, v.sitios_estimados::double precision AS sitios_estimados,
    v.ocupacion_pct::double precision AS ocupacion_pct, "left"(v.observaciones, 255) AS observaciones,
    (v.creado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_registro,
    v.zona_pps, v.cobertura_clc
   FROM productores.v_lote v
     JOIN productores.predio p ON p.id = v.predio_id
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     LEFT JOIN productores.vereda ve ON ve.id = p.vereda_id
  WHERE v.escenario = 'actual';

create or replace view productores.r_lotes_propuestos with (security_invoker = true) as
 SELECT v.id::text AS id, v.cod_lote, v.num_lote, v.predio_id::text AS predio_id, v.cod_predio, v.predio, p.cod_humboldt,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    d.nombre AS departamento, m.nombre AS municipio, ve.nombre AS vereda,
    v.zona_pps, v.cultivo, v.tipo_cobertura, v.cobertura_clc,
    v.area_sig_ha::double precision AS area_sig_ha, "left"(v.observaciones, 255) AS observaciones,
    (v.creado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_registro
   FROM productores.v_lote v
     JOIN productores.predio p ON p.id = v.predio_id
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     LEFT JOIN productores.vereda ve ON ve.id = p.vereda_id
  WHERE v.escenario = 'propuesto';
revoke all on productores.r_lotes_propuestos from public, anon;
grant select on productores.r_lotes_propuestos to authenticated, sig_editor, arcgis_lector;

-- Semáforo, tablero y funciones de «lote encima de otro»: solo el mismo escenario
do $$
declare def text; nuevo text;
begin
  -- revision_predio: lotes dibujados, área en lotes y última edición = lo actual
  def := pg_get_functiondef('productores.revision_predio(uuid)'::regprocedure);
  nuevo := replace(def, 'from productores.lote l where l.predio_id = pr.id',
                        'from productores.lote l where l.predio_id = pr.id and l.escenario = ''actual''');
  if (length(nuevo) - length(def)) <> 3 * length(' and l.escenario = ''actual''') then
    raise exception 'revision_predio: no se encontraron las 3 consultas de lotes';
  end if;
  execute nuevo;

  -- tablero: hectáreas por cultivo y número de lotes = lo actual
  def := pg_get_functiondef('productores.tablero(text)'::regprocedure);
  nuevo := regexp_replace(def, '(left join productores\.cultivo c on c\.id = l\.cultivo_id)',
                          '\1 where l.escenario = ''actual''');
  if nuevo = def then raise exception 'tablero: no se encontró la consulta de lotes'; end if;
  execute nuevo;
end $$;

drop function productores.lotes_bajo(uuid, text, uuid);
create function productores.lotes_bajo(p_predio uuid, p_geom text, p_excluir uuid default null,
                                       p_escenario text default 'actual')
returns table (id uuid, cod_lote text, cultivo text, area_solape_ha numeric, area_queda_ha numeric)
language sql stable
set search_path = productores, extensions, public as $$
  with g as (select ST_MakeValid(ST_SetSRID(ST_GeomFromEWKT(p_geom), 4326)) as geom)
  select l.id, l.cod_lote, c.nombre,
         productores.area_ha(ST_CollectionExtract(ST_Intersection(l.geom, g.geom), 3)),
         productores.area_ha(ST_CollectionExtract(ST_Difference(l.geom, g.geom), 3))
    from productores.lote l cross join g
    left join productores.cultivo c on c.id = l.cultivo_id
   where l.predio_id = p_predio and l.geom is not null
     and l.escenario = coalesce(p_escenario, 'actual')
     and (p_excluir is null or l.id <> p_excluir)
     and ST_Intersects(l.geom, g.geom)
     and ST_Area(ST_Intersection(l.geom, g.geom)::geography) >= 1
   order by l.num_lote
$$;

drop function productores.abrir_espacio_lote(uuid, text, uuid[]);
create function productores.abrir_espacio_lote(p_predio uuid, p_geom text, p_lotes uuid[],
                                               p_escenario text default 'actual')
returns integer language plpgsql volatile
set search_path = productores, extensions, public as $$
declare
  g geometry := ST_MakeValid(ST_SetSRID(ST_GeomFromEWKT(p_geom), 4326));
  r record; resto geometry; n integer := 0; k integer;
begin
  for r in select l.id, l.cod_lote, l.geom from productores.lote l
            where l.predio_id = p_predio and l.id = any(p_lotes) and l.geom is not null
              and l.escenario = coalesce(p_escenario, 'actual')
  loop
    resto := ST_CollectionExtract(ST_Difference(r.geom, g), 3);
    if resto is null or ST_IsEmpty(resto) or ST_Area(resto::geography) < 1 then
      raise exception 'El lote % quedaría completamente cubierto por el nuevo. Elimínelo o edítelo antes.', r.cod_lote;
    end if;
    update productores.lote set geom = ST_Multi(resto) where id = r.id;
    get diagnostics k = row_count;
    if k = 0 then raise exception 'No tiene permiso para modificar el lote %.', r.cod_lote; end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function productores.lotes_bajo(uuid, text, uuid, text) from public, anon;
revoke all on function productores.abrir_espacio_lote(uuid, text, uuid[], text) from public, anon;
grant execute on function productores.lotes_bajo(uuid, text, uuid, text) to authenticated;
grant execute on function productores.abrir_espacio_lote(uuid, text, uuid[], text) to authenticated;

-- f) Punto de partida de la finca soñada --------------------------------------
-- Copia los lotes actuales como propuestos (solo si el predio aún no tiene propuestos).
create or replace function productores.copiar_lotes_a_propuesto(p_predio uuid)
returns integer language plpgsql volatile
set search_path = productores, extensions, public as $$
declare n integer;
begin
  if exists (select 1 from productores.lote where predio_id = p_predio and escenario = 'propuesto') then
    raise exception 'Este predio ya tiene lotes propuestos. Elimínelos antes de volver a copiar.';
  end if;
  insert into productores.lote (predio_id, escenario, cultivo_id, variedad, sistema, sombrio,
                                zona_pps_id, cobertura_clc, observaciones, geom)
  select l.predio_id, 'propuesto', l.cultivo_id, l.variedad, l.sistema, l.sombrio,
         l.zona_pps_id, l.cobertura_clc, 'Copiado de ' || l.cod_lote, l.geom
    from productores.lote l
   where l.predio_id = p_predio and l.escenario = 'actual' and l.geom is not null
   order by l.num_lote;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function productores.copiar_lotes_a_propuesto(uuid) from public, anon;
grant execute on function productores.copiar_lotes_a_propuesto(uuid) to authenticated, sig_editor;
