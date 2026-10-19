-- =====================================================================
--  SIP-CBS · Acceso de solo lectura para Access (área administrativa)
--
--  Crea:
--   - El usuario "lector_oficina" (SOLO LECTURA: no puede modificar nada).
--   - Vistas de consulta sin geometrías, con nombres legibles:
--       r_productores, r_predios, r_lotes, r_resumen_cultivos
--
--  ANTES DE EJECUTAR: cambie CAMBIAR_CLAVE_OFICINA por una clave
--  (solo letras y números). Se puede ejecutar varias veces.
-- =====================================================================

-- 1. Usuario de solo lectura (hereda los permisos de lectura de arcgis_lector)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lector_oficina') then
    create role lector_oficina login password 'CAMBIAR_CLAVE_OFICINA' in role arcgis_lector;
  end if;
end $$;
alter role lector_oficina set search_path = "$user", public, extensions;
grant usage on schema productores to lector_oficina;


-- 2. Vistas de consulta
create or replace view productores.r_productores
with (security_invoker = true) as
select pr.id::text                                         as id,
       pr.tipo_doc,
       pr.num_doc,
       pr.nombres,
       pr.apellidos,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as nombre_completo,
       pr.sexo,
       pr.fecha_nac,
       pr.telefono,
       pr.correo,
       pr.asociacion,
       (select count(*) from productores.predio p where p.productor_id = pr.id)::int as n_predios,
       (select sum(coalesce(p.area_sig_ha, p.area_declarada_ha)) from productores.predio p
         where p.productor_id = pr.id)::float8           as area_predios_ha,
       left(pr.observaciones, 255)          as observaciones,
       (pr.creado_en at time zone 'America/Bogota')       as fecha_registro
  from productores.productor pr;

create or replace view productores.r_predios
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
       p.num_predial,
       p.matricula,
       p.area_declarada_ha::float8         as area_declarada_ha,
       p.area_sig_ha::float8               as area_sig_ha,
       (select count(*) from productores.lote l where l.predio_id = p.id)::int as n_lotes,
       (select sum(coalesce(l.area_sig_ha, l.area_declarada_ha)) from productores.lote l
         where l.predio_id = p.id)::float8 as area_lotes_ha,
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

create or replace view productores.r_lotes
with (security_invoker = true) as
select l.id::text                         as id,
       l.cod_lote,
       l.num_lote,
       l.predio_id::text                  as predio_id,
       p.cod_predio,
       p.nombre                           as predio,
       pr.num_doc,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       m.nombre                           as municipio,
       v.nombre                           as vereda,
       c.nombre                           as cultivo,
       c.tipo                             as tipo_cultivo,
       l.variedad,
       l.fecha_siembra,
       case when l.fecha_siembra is not null
            then (extract(year from age(current_date, l.fecha_siembra)) * 12
                + extract(month from age(current_date, l.fecha_siembra)))::int end as edad_meses,
       l.estado,
       l.sistema,
       l.sombrio,
       l.area_declarada_ha::float8        as area_declarada_ha,
       l.area_sig_ha::float8              as area_sig_ha,
       l.num_plantas,
       l.dist_surcos_m::float8            as dist_surcos_m,
       l.dist_plantas_m::float8           as dist_plantas_m,
       l.densidad_ha::float8              as densidad_ha,
       left(l.observaciones, 255)         as observaciones,
       (l.creado_en at time zone 'America/Bogota') as fecha_registro
  from productores.lote l
  join productores.predio p      on p.id = l.predio_id
  join productores.productor pr  on pr.id = p.productor_id
  join productores.municipio m   on m.cod_mpio = p.cod_mpio
  left join productores.vereda v on v.id = p.vereda_id
  left join productores.cultivo c on c.id = l.cultivo_id;

create or replace view productores.r_resumen_cultivos
with (security_invoker = true) as
select m.nombre                                   as municipio,
       coalesce(c.nombre, 'Sin cultivo')          as cultivo,
       count(*)::int                              as n_lotes,
       count(distinct p.id)::int                  as n_predios,
       count(distinct p.productor_id)::int        as n_productores,
       round(sum(coalesce(l.area_sig_ha, l.area_declarada_ha, 0)), 2)::float8 as area_ha,
       sum(coalesce(l.num_plantas, 0))::bigint    as plantas
  from productores.lote l
  join productores.predio p    on p.id = l.predio_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  left join productores.cultivo c on c.id = l.cultivo_id
 group by m.nombre, coalesce(c.nombre, 'Sin cultivo');


-- 3. Permisos de lectura sobre las vistas
grant select on productores.r_productores, productores.r_predios,
                productores.r_lotes, productores.r_resumen_cultivos
   to arcgis_lector, lector_oficina, authenticated, service_role;

-- Comprobación
select 'productores' as vista, count(*) from productores.r_productores
union all select 'predios', count(*) from productores.r_predios
union all select 'lotes',   count(*) from productores.r_lotes;
