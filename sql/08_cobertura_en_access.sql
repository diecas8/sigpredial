-- =====================================================================
--  SIP-CBS · Tipo de cobertura en las consultas de Access
--  - r_resumen_cultivos: agrega la columna "tipo_cobertura" al final.
--  - r_resumen_coberturas (nueva): totales por municipio y tipo de
--    cobertura (Permanente, Transitorio, Conservación, Descanso…).
--  Se puede ejecutar varias veces. No modifica datos.
-- =====================================================================
set search_path = productores, extensions, public;

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

grant select on productores.r_resumen_cultivos, productores.r_resumen_coberturas
   to arcgis_lector, lector_oficina, authenticated, service_role;

-- Comprobación
select * from productores.r_resumen_coberturas order by departamento, municipio, tipo_cobertura;
