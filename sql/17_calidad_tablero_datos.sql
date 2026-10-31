-- =========================================================================
--  17 · Semáforo de calidad, tablero de avance y aceptación de datos
--
--   a) predio.delimitado_en: fecha en que el predio recibió su límite
--      (para el avance semanal del tablero).
--   b) revision_predio(id): lista de pendientes de un predio.
--        'R:' = rojo (bloquea el proceso)   'A:' = amarillo (revisar)
--      v_predio agrega: calidad ('verde' | 'amarillo' | 'rojo') y pendientes.
--   c) meta_departamento: metas del proyecto por departamento (las fija el
--      administrador desde el tablero).
--   d) tablero(p_dpto): indicadores de avance en JSON, filtrados por los
--      departamentos que el usuario puede ver.
--   e) usuario_app.acepto_datos_en + aceptar_tratamiento_datos():
--      aceptación del aviso de tratamiento de datos (Ley 1581 de 2012).
-- =========================================================================

-- a) Fecha de delimitación ------------------------------------------------
alter table productores.predio add column if not exists delimitado_en timestamptz;

update productores.predio
   set delimitado_en = coalesce(editado_en, creado_en)
 where geom is not null and delimitado_en is null;

create or replace function productores.tg_predio_delimitado()
returns trigger language plpgsql
set search_path = productores, extensions, public as $$
begin
  if new.geom is null then
    new.delimitado_en := null;
  elsif tg_op = 'INSERT' or old.geom is null then
    new.delimitado_en := now();
  else
    new.delimitado_en := coalesce(old.delimitado_en, now());
  end if;
  return new;
end $$;

drop trigger if exists t15_predio_delimitado on productores.predio;
create trigger t15_predio_delimitado
  before insert or update of geom on productores.predio
  for each row execute function productores.tg_predio_delimitado();

-- b) Revisión de calidad ---------------------------------------------------
create or replace function productores.revision_predio(p_predio uuid)
returns text[] language sql stable
set search_path = productores, extensions, public as $$
  with p as (
    select pr.*, v.validada,
           (select count(*) from productores.lote l where l.predio_id = pr.id and l.geom is not null) as n_lotes_geo,
           (select sum(coalesce(l.area_sig_ha, l.area_declarada_ha)) from productores.lote l where l.predio_id = pr.id) as area_lotes,
           (select max(l.editado_en) from productores.lote l where l.predio_id = pr.id) as lotes_editados,
           exists (select 1 from productores.caracterizacion c
                    where c.predio_id = pr.id and c.estado = 'procesada') as caracterizado,
           (select f.generado_en from productores.ficha_predial f where f.predio_id = pr.id) as ficha_en
      from productores.predio pr
      left join productores.vereda v on v.id = pr.vereda_id
     where pr.id = p_predio
  )
  select coalesce(array_remove(array[
    case when p.geom is null then 'R:Falta dibujar el límite del predio' end,
    case when not p.caracterizado then 'R:Falta la caracterización (encuesta Kobo)' end,
    case when p.vereda_id is null then 'A:Sin vereda asignada'
         when not coalesce(p.validada, true) then 'A:La vereda está por validar' end,
    case when p.geom is not null and p.n_lotes_geo = 0 then 'A:Sin lotes dibujados' end,
    case when p.area_declarada_ha > 0 and p.area_sig_ha > 0
              and abs(p.area_sig_ha - p.area_declarada_ha) / p.area_declarada_ha > 0.30
         then 'A:El área SIG difiere más de 30 % del área declarada' end,
    case when p.area_sig_ha > 0 and p.area_lotes > p.area_sig_ha * 1.001
         then 'A:Los lotes suman más área que el predio' end,
    case when p.gps_precision_m > 15 then 'A:Punto GPS de baja precisión (más de 15 m)' end,
    case when p.geom is not null and p.ficha_en is null then 'A:Sin ficha predial guardada'
         when p.ficha_en < greatest(p.editado_en, p.lotes_editados) - interval '1 minute'
         then 'A:La ficha predial está desactualizada (hubo cambios después)' end
  ], null), '{}')
  from p
$$;

create or replace function productores.nivel_calidad(p_pendientes text[])
returns text language sql immutable as $$
  select case when exists (select 1 from unnest(p_pendientes) x where x like 'R:%') then 'rojo'
              when cardinality(p_pendientes) > 0 then 'amarillo'
              else 'verde' end
$$;

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
          WHERE l.predio_id = p.id) AS n_lotes,
    ( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) AS sum
           FROM productores.lote l
          WHERE l.predio_id = p.id) AS area_lotes_ha,
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

-- c) Metas por departamento ----------------------------------------------
create table if not exists productores.meta_departamento (
  cod_dpto       char(2) primary key references productores.departamento (cod_dpto),
  predios        integer check (predios is null or predios >= 0),
  hectareas      numeric(12, 2) check (hectareas is null or hectareas >= 0),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
alter table productores.meta_departamento enable row level security;

drop policy if exists meta_ver on productores.meta_departamento;
create policy meta_ver on productores.meta_departamento
  for select to authenticated using (productores.ve_dpto(cod_dpto::text));
drop policy if exists meta_admin on productores.meta_departamento;
create policy meta_admin on productores.meta_departamento
  for all to authenticated using (productores.es_admin()) with check (productores.es_admin());

revoke all on productores.meta_departamento from public, anon;
grant select, insert, update, delete on productores.meta_departamento to authenticated;

-- d) Tablero ---------------------------------------------------------------
create or replace function productores.tablero(p_dpto text default null)
returns jsonb language plpgsql stable security definer
set search_path = productores, extensions, public as $$
declare
  r jsonb;
begin
  if not productores.usuario_activo() then
    raise exception 'Usuario no habilitado';
  end if;

  with pr as (   -- predios visibles para el usuario (y del departamento pedido)
    select p.*, left(p.cod_mpio, 2) as cod_dpto, m.nombre as municipio,
           productores.revision_predio(p.id) as pendientes,
           exists (select 1 from productores.caracterizacion c
                    where c.predio_id = p.id and c.estado = 'procesada') as caracterizado,
           exists (select 1 from productores.ficha_predial f where f.predio_id = p.id) as con_ficha,
           coalesce(u.nombre,
                    (select c.tecnico from productores.caracterizacion c
                      where c.predio_id = p.id and c.tecnico is not null
                      order by c.fecha_visita desc nulls last limit 1),
                    'Sin asignar') as tecnico
      from productores.predio p
      join productores.municipio m on m.cod_mpio = p.cod_mpio
      left join productores.usuario_app u on u.user_id = p.creado_por
     where productores.ve_dpto(left(p.cod_mpio, 2))
       and (p_dpto is null or left(p.cod_mpio, 2) = p_dpto)
  ),
  pc as (select pr.*, productores.nivel_calidad(pr.pendientes) as calidad from pr),
  lo as (
    select l.*, c.nombre as cultivo, coalesce(c.tipo, 'Otro') as tipo
      from productores.lote l
      join pc on pc.id = l.predio_id
      left join productores.cultivo c on c.id = l.cultivo_id
  ),
  dptos as (
    select d.cod_dpto, d.nombre
      from productores.departamento d
     where productores.ve_dpto(d.cod_dpto::text)
       and (p_dpto is null or d.cod_dpto = p_dpto)
       and (exists (select 1 from pc where pc.cod_dpto = d.cod_dpto)
            or exists (select 1 from productores.meta_departamento md
                        where md.cod_dpto = d.cod_dpto and (md.predios > 0 or md.hectareas > 0))
            or d.cod_dpto = productores.dpto_usuario())
  ),
  semanas as (
    select generate_series(date_trunc('week', now() - interval '11 weeks'),
                           date_trunc('week', now()), interval '1 week')::date as semana
  )
  select jsonb_build_object(
    'generado_en', now(),
    'totales', (select jsonb_build_object(
        'productores',   count(distinct productor_id),
        'predios',       count(*),
        'caracterizados', count(*) filter (where caracterizado),
        'delimitados',   count(*) filter (where geom is not null),
        'con_ficha',     count(*) filter (where con_ficha),
        'ha_sig',        coalesce(round(sum(area_sig_ha), 2), 0),
        'verde',         count(*) filter (where calidad = 'verde'),
        'amarillo',      count(*) filter (where calidad = 'amarillo'),
        'rojo',          count(*) filter (where calidad = 'rojo'),
        'lotes',         (select count(*) from lo),
        'ha_lotes',      (select coalesce(round(sum(coalesce(area_sig_ha, area_declarada_ha)), 2), 0) from lo)
      ) from pc),
    'departamentos', coalesce((select jsonb_agg(jsonb_build_object(
        'cod_dpto', d.cod_dpto, 'nombre', d.nombre,
        'predios',  (select count(*) from pc where pc.cod_dpto = d.cod_dpto),
        'caracterizados', (select count(*) from pc where pc.cod_dpto = d.cod_dpto and pc.caracterizado),
        'delimitados', (select count(*) from pc where pc.cod_dpto = d.cod_dpto and pc.geom is not null),
        'con_ficha', (select count(*) from pc where pc.cod_dpto = d.cod_dpto and pc.con_ficha),
        'ha_sig', (select coalesce(round(sum(pc.area_sig_ha), 2), 0) from pc where pc.cod_dpto = d.cod_dpto),
        'meta_predios', md.predios, 'meta_hectareas', md.hectareas
      ) order by d.nombre) from dptos d left join productores.meta_departamento md on md.cod_dpto = d.cod_dpto), '[]'),
    'municipios', coalesce((select jsonb_agg(x order by x->>'departamento', x->>'municipio') from (
        select jsonb_build_object('cod_mpio', cod_mpio, 'municipio', municipio,
          'departamento', (select nombre from productores.departamento where cod_dpto = pc.cod_dpto),
          'predios', count(*), 'caracterizados', count(*) filter (where caracterizado),
          'delimitados', count(*) filter (where geom is not null), 'con_ficha', count(*) filter (where con_ficha),
          'rojo', count(*) filter (where calidad = 'rojo'), 'amarillo', count(*) filter (where calidad = 'amarillo'),
          'ha_sig', coalesce(round(sum(area_sig_ha), 2), 0)) as x
          from pc group by cod_dpto, cod_mpio, municipio) s), '[]'),
    'tecnicos', coalesce((select jsonb_agg(x order by (x->>'predios')::int desc, x->>'tecnico') from (
        select jsonb_build_object('tecnico', tecnico,
          'predios', count(*), 'caracterizados', count(*) filter (where caracterizado),
          'delimitados', count(*) filter (where geom is not null), 'con_ficha', count(*) filter (where con_ficha),
          'por_corregir', count(*) filter (where calidad <> 'verde')) as x
          from pc group by tecnico) s), '[]'),
    'cultivos', coalesce((select jsonb_agg(x order by (x->>'ha')::numeric desc) from (
        select jsonb_build_object('cultivo', coalesce(cultivo, 'Sin cultivo'), 'tipo', tipo,
          'lotes', count(*), 'ha', round(sum(coalesce(area_sig_ha, area_declarada_ha, 0)), 2)) as x
          from lo group by cultivo, tipo) s), '[]'),
    'pendientes', coalesce((select jsonb_agg(x order by (x->>'predios')::int desc) from (
        select jsonb_build_object('pendiente', substr(t, 3), 'nivel', case when t like 'R:%' then 'rojo' else 'amarillo' end,
          'predios', count(*)) as x
          from pc, unnest(pc.pendientes) t group by t) s), '[]'),
    'semanas', (select jsonb_agg(jsonb_build_object(
        'semana', s.semana,
        'caracterizados', (select count(distinct c.predio_id) from productores.caracterizacion c join pc on pc.id = c.predio_id
                            where c.estado = 'procesada' and date_trunc('week', c.fecha_visita)::date = s.semana),
        'delimitados', (select count(*) from pc where date_trunc('week', pc.delimitado_en at time zone 'America/Bogota')::date = s.semana)
      ) order by s.semana) from semanas s)
  ) into r;
  return r;
end $$;

revoke all on function productores.tablero(text) from public, anon;
grant execute on function productores.tablero(text) to authenticated;

-- e) Aceptación del tratamiento de datos (Ley 1581 de 2012) ---------------
alter table productores.usuario_app add column if not exists acepto_datos_en timestamptz;

create or replace function productores.aceptar_tratamiento_datos()
returns timestamptz language sql volatile security definer
set search_path = '' as $$
  update productores.usuario_app
     set acepto_datos_en = coalesce(acepto_datos_en, now())
   where user_id = (select auth.uid())
  returning acepto_datos_en
$$;
revoke all on function productores.aceptar_tratamiento_datos() from public, anon;
grant execute on function productores.aceptar_tratamiento_datos() to authenticated;
