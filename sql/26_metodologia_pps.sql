-- =========================================================================
--  26 · Ajustes metodológicos de la PPS (tablas 1, 2 y 3 del equipo)
--
--   a) Tabla 2 · Zonas del mapa futuro: cada zona con su explicación sencilla
--      y ejemplos; zona nueva «Soberanía alimentaria» («lo que comemos»).
--   b) Tabla 3 · Visión de futuro por aspecto (ambiental, productivo,
--      alimentación, infraestructura y bienestar, cambios prioritarios a
--      3/6/10 años, capacidades y apoyos).
--   c) Tabla 1 · Mapa actual: microcuenca, relación con áreas protegidas y
--      sistema productivo principal del predio; usos y elementos nuevos
--      (infraestructura productiva, zonas de riesgo, conflictos de uso).
--   d) Reportes: la finca soñada incluye la zona nueva y la visión por aspecto.
-- =========================================================================

-- a) Zonas PPS ---------------------------------------------------------------------
alter table productores.zona_pps add column explicacion text, add column ejemplos text;
update productores.zona_pps z set explicacion = x.e, ejemplos = x.j
  from (values
    ('preservacion', 'Lo que no se toca', 'Bosques, nacimientos, rondas de quebradas.'),
    ('restauracion', 'Lo que se recupera para no tocar', 'Rondas sin árboles, nacimientos desprotegidos, conectores entre bosques.'),
    ('recuperacion', 'Lo que se recupera para producir', 'Potreros o suelos degradados, erosionados o en conflicto de uso.'),
    ('produccion_sostenible', 'Donde se produce', 'Cultivos, potreros, sistemas agroforestales y silvopastoriles.')) x(c, e, j)
 where z.codigo = x.c;
insert into productores.zona_pps (codigo, nombre, color, orden, explicacion, ejemplos)
values ('soberania_alimentaria', 'Soberanía alimentaria', '#ad1457', 5, 'Lo que comemos',
        'Huerta, patio productivo, pancoger, especies menores.')
on conflict (codigo) do nothing;

-- b) y c) Predio: visión por aspecto y contexto del mapa actual -------------------------
alter table productores.predio
  add column vision_ambiental text,
  add column vision_productiva text,
  add column vision_alimentacion text,
  add column vision_infraestructura text,
  add column vision_cambios text,
  add column vision_capacidades text,
  add column microcuenca text,
  add column area_protegida text,
  add column relacion_area_protegida text check (relacion_area_protegida in
    ('Dentro del área protegida', 'En zona de amortiguación', 'Cerca', 'Ninguna')),
  add column sistema_principal_id integer references productores.cultivo (id);

-- c) Usos del suelo y elementos del mapa actual --------------------------------------------
update productores.cultivo set nombre = 'Rastrojo (regeneración natural)' where nombre = 'Regeneración natural';
insert into productores.cultivo (nombre, tipo)
select x.n, x.t from (values ('Piscicultura', 'Pecuario'), ('Frutales amazónicos', 'Permanente'),
                             ('Huerta', 'Transitorio'), ('Especies menores', 'Pecuario')) x(n, t)
 where not exists (select 1 from productores.cultivo c where c.nombre = x.n);

insert into productores.tipo_elemento (nombre, geometria, grupo)
select x.n, 'punto', x.g from (values
    ('Sitio de procesamiento de leche', 'Infraestructura'), ('Secadero de café o cacao', 'Infraestructura'),
    ('Estanque', 'Infraestructura'), ('Trapiche', 'Infraestructura'), ('Galpón', 'Infraestructura'),
    ('Pendiente fuerte', 'Riesgo'), ('Zona que se inunda', 'Riesgo'), ('Deslizamiento', 'Riesgo'),
    ('Agrietamiento', 'Riesgo'), ('Conflicto de uso', 'Conflicto de uso')) x(n, g)
 where not exists (select 1 from productores.tipo_elemento t where t.nombre = x.n);

-- d) Reporte de la finca soñada (columnas nuevas al final) -----------------------------------
create or replace view productores.rep_finca_sonada with (security_invoker = true) as
select d.nombre as departamento, m.nombre as municipio, v.nombre as vereda, trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap, p.area_sig_ha::double precision as area_predio_ha,
       p.vision_familia, p.fecha_taller, p.participantes_hombres, p.participantes_mujeres, p.participantes_jovenes,
       p.puntaje_seleccion::double precision as puntaje_seleccion,
       z.lotes_propuestos, z.ha_propuesta, z.ha_preservacion, z.ha_restauracion, z.ha_recuperacion, z.ha_produccion_sostenible, z.ha_sin_zona,
       (select count(*) from productores.plan_accion a where a.predio_id = p.id)::integer as acciones,
       (select count(*) from productores.plan_accion a where a.predio_id = p.id and a.estado = 'concertado')::integer as acciones_concertadas,
       z.ha_soberania_alimentaria,
       p.vision_ambiental, p.vision_productiva, p.vision_alimentacion, p.vision_infraestructura, p.vision_cambios, p.vision_capacidades
  from productores.predio p join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id
  cross join lateral (
    select count(*)::integer as lotes_propuestos, round(coalesce(sum(l.area_sig_ha), 0), 4)::double precision as ha_propuesta,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'preservacion'), 0), 4)::double precision as ha_preservacion,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'restauracion'), 0), 4)::double precision as ha_restauracion,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'recuperacion'), 0), 4)::double precision as ha_recuperacion,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'produccion_sostenible'), 0), 4)::double precision as ha_produccion_sostenible,
           round(coalesce(sum(l.area_sig_ha) filter (where l.zona_pps_id is null), 0), 4)::double precision as ha_sin_zona,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'soberania_alimentaria'), 0), 4)::double precision as ha_soberania_alimentaria
      from productores.lote l left join productores.zona_pps zz on zz.id = l.zona_pps_id
     where l.predio_id = p.id and l.escenario = 'propuesto') z
 where z.lotes_propuestos > 0 or p.vision_familia is not null or p.fecha_taller is not null
    or coalesce(p.vision_ambiental, p.vision_productiva, p.vision_alimentacion, p.vision_infraestructura,
                p.vision_cambios, p.vision_capacidades) is not null
    or exists (select 1 from productores.plan_accion a where a.predio_id = p.id);
