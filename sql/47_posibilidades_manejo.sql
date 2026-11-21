-- =====================================================================
-- 47 · Posibilidades de acciones de manejo (mapa guía de la finca soñada)
-- ---------------------------------------------------------------------
-- A partir de los lotes de HOY y del agua dibujada en el predio, propone
-- por reglas qué se podría hacer en cada parte. Es una ayuda para que el
-- técnico oriente la conversación con la familia: no crea lotes propuestos
-- ni acciones; la familia define su finca soñada.
--
-- Reglas:
--  1. Cada uso de hoy tiene una posibilidad (tabla productores.regla_manejo):
--     pastos → silvopastoril, descanso → parcela agroforestal, frutos del
--     bosque → aprovechamiento de frutos, bosque y humedal → conservar, etc.
--  2. Franja de 30 m a cada lado de quebradas, ríos y caños (Decreto 1076 de
--     2015, art. 2.2.1.1.18.2), 100 m alrededor de los nacimientos y 30 m
--     alrededor de los humedales dibujados como lote. Solo se le quita a lo
--     productivo: bosque, rastrojo, humedal y frutos del bosque quedan igual.
-- =====================================================================

create table if not exists productores.regla_manejo (
  cultivo_id   int primary key references productores.cultivo (id),
  clave        text not null,          -- grupo de color en el mapa
  posibilidad  text not null,
  accion_id    int references productores.catalogo_accion (id),
  linea_hoy    text,                   -- línea PDEA del uso de hoy (null = conservación o sin línea)
  linea_prop   text,                   -- línea PDEA de la posibilidad
  cede_franja  boolean not null default true
);
alter table productores.regla_manejo enable row level security;
drop policy if exists regla_manejo_ver on productores.regla_manejo;
create policy regla_manejo_ver on productores.regla_manejo for select to authenticated using (true);
drop policy if exists regla_manejo_admin on productores.regla_manejo;
create policy regla_manejo_admin on productores.regla_manejo for all to authenticated
  using (productores.es_admin()) with check (productores.es_admin());
grant select on productores.regla_manejo to authenticated;

insert into productores.regla_manejo (cultivo_id, clave, posibilidad, accion_id, linea_hoy, linea_prop, cede_franja)
select c.id, r.clave, r.posibilidad, r.accion_id, r.linea_hoy, r.linea_prop, r.cede
  from productores.cultivo c
  join (values
    ('Pastos y forrajes',                     'silvo',   'Sistema silvopastoril',                                  5,  'Ganadería bovina', 'Ganadería bovina', true),
    ('Forrajes / bancos de forraje',          'silvo',   'Sistema silvopastoril con bancos de forraje',            6,  'Ganadería bovina', 'Ganadería bovina', true),
    ('Área en descanso',                      'agrof',   'Parcela agroforestal (frutales amazónicos y maderables)', 7, null,              'Frutas · Silvicultura', true),
    ('Rastrojo (regeneración natural)',       'regen',   'Dejar que se regenere (restauración)',                   22, null,              null, false),
    ('Bosque / forestal',                     'bosque',  'Bosque: conservar',                                      22, null,              null, false),
    ('Bosque de galería',                     'bosque',  'Bosque de galería: conservar',                           2,  null,              null, false),
    ('Humedal',                               'humedal', 'Humedal: conservar',                                     22, null,              null, false),
    ('Frutos del bosque (canangucha, asaí)',  'pnmb',    'Aprovechamiento de frutos del bosque',                   73, 'Productos no maderables del bosque', 'Productos no maderables del bosque', false),
    ('Café',                                  'cultivo', 'Café con sombrío',                                       55, 'Café',             'Café', true),
    ('Cacao',                                 'cultivo', 'Cacao con manejo de sombra',                             51, 'Cacao',            'Cacao', true),
    ('Caña panelera',                         'cultivo', 'Renovar el cañaduzal con buenas prácticas',              63, 'Caña panelera',    'Caña panelera', true),
    ('Plátano',                               'cultivo', 'Renovar la platanera con semilla limpia',                67, 'Plátano',          'Plátano', true),
    ('Banano',                                'cultivo', 'Renovar la platanera con semilla limpia',                67, 'Plátano',          'Plátano', true),
    ('Caucho',                                'cultivo', 'Caucho con buenas prácticas',                            null, 'Caucho',         'Caucho', true),
    ('Frutales amazónicos',                   'cultivo', 'Frutales con buenas prácticas',                          69, 'Frutas',           'Frutas', true),
    ('Copoazú',                               'cultivo', 'Frutales con buenas prácticas',                          69, 'Frutas',           'Frutas', true),
    ('Arazá',                                 'cultivo', 'Frutales con buenas prácticas',                          69, 'Frutas',           'Frutas', true),
    ('Aguacate',                              'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Cítricos',                              'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Guayaba',                               'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Mora',                                  'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Granadilla',                            'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Lulo',                                  'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Maracuyá',                              'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Tomate de árbol',                       'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Piña',                                  'cultivo', 'Frutales con buenas prácticas',                          null, 'Frutas',         'Frutas', true),
    ('Yuca',                                  'pancoger','Pancoger para la alimentación de la familia',            70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Maíz',                                  'pancoger','Pancoger para la alimentación de la familia',            70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Fríjol',                                'pancoger','Pancoger para la alimentación de la familia',            70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Arroz',                                 'pancoger','Pancoger para la alimentación de la familia',            70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Hortalizas',                            'pancoger','Huerta casera',                                          70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Huerta',                                'pancoger','Huerta casera',                                          70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Pancoger',                              'pancoger','Pancoger para la alimentación de la familia',            70, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Especies menores',                      'pancoger','Especies menores con galpones y corrales mejorados',     66, 'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true),
    ('Piscicultura',                          'cultivo', 'Piscicultura con estanques mejorados',                   65, 'Acuicultura',      'Acuicultura', true),
    ('Forestal maderable',                    'cultivo', 'Plantación forestal con manejo sostenible',              null, 'Silvicultura',   'Silvicultura', true),
    ('Palma de aceite',                       'cultivo', 'Palma con buenas prácticas',                             null, null,             null, true),
    ('Otro',                                  'revisar', 'Revisar con la familia',                                 null, null,             null, true)
  ) as r(nombre, clave, posibilidad, accion_id, linea_hoy, linea_prop, cede) on r.nombre = c.nombre
on conflict (cultivo_id) do update set clave = excluded.clave, posibilidad = excluded.posibilidad,
  accion_id = excluded.accion_id, linea_hoy = excluded.linea_hoy, linea_prop = excluded.linea_prop,
  cede_franja = excluded.cede_franja;

-- Posibilidades por lote de hoy, con las franjas de protección ya restadas.
create or replace function productores.posibilidades_manejo(p_predio uuid)
returns table (cod_lote text, uso_hoy text, clave text, posibilidad text, accion text,
               res0083_num text, res0083_estado text, linea_hoy text, linea_prop text,
               area_ha numeric, geojson json)
language sql stable security definer
set search_path to 'productores', 'extensions', 'public'
as $$
  with p as (
    select id, geom from productores.predio
     where id = p_predio and productores.ve_predio(p_predio) and geom is not null
  ),
  lotes as (
    select l.cod_lote, c.nombre as uso, l.cultivo_id, ST_Transform(l.geom, 9377) as g
      from p join productores.lote l on l.predio_id = p.id
      left join productores.cultivo c on c.id = l.cultivo_id
     where l.escenario = 'actual' and l.geom is not null
  ),
  franja as (   -- 30 m a cada lado del agua, 100 m alrededor de nacimientos, 30 m alrededor de humedales
    select ST_Union(g) as g from (
      select ST_Buffer(ST_Transform(e.geom, 9377), 30) as g
        from p join productores.elemento_linea e on e.predio_id = p.id
        join productores.tipo_elemento t on t.id = e.tipo_id
       where coalesce(e.escenario, 'actual') = 'actual' and t.nombre in ('Quebrada', 'Río', 'Caño / drenaje')
      union all
      select ST_Buffer(ST_Transform(e.geom, 9377), 100)
        from p join productores.elemento_punto e on e.predio_id = p.id
        join productores.tipo_elemento t on t.id = e.tipo_id
       where coalesce(e.escenario, 'actual') = 'actual' and t.nombre = 'Nacimiento / afloramiento'
      union all
      select ST_Buffer(g, 30) from lotes where uso = 'Humedal'
    ) x
  ),
  piezas as (
    select l.cod_lote, coalesce(l.uso, 'Sin uso') as uso, coalesce(r.clave, 'revisar') as clave,
           coalesce(r.posibilidad, 'Revisar con la familia') as posibilidad, r.accion_id, r.linea_hoy, r.linea_prop,
           case when coalesce(r.cede_franja, true) and f.g is not null then ST_Difference(l.g, f.g) else l.g end as g
      from lotes l left join productores.regla_manejo r on r.cultivo_id = l.cultivo_id cross join franja f
    union all
    select l.cod_lote, coalesce(l.uso, 'Sin uso'), 'franja', 'Franja de protección del agua (dejar crecer bosque)',
           2, r.linea_hoy, null, ST_Intersection(l.g, f.g)
      from lotes l left join productores.regla_manejo r on r.cultivo_id = l.cultivo_id cross join franja f
     where coalesce(r.cede_franja, true) and f.g is not null and ST_Intersects(l.g, f.g)
  )
  select x.cod_lote, x.uso, x.clave, x.posibilidad, a.nombre, a.res0083_num, a.res0083_estado,
         x.linea_hoy, x.linea_prop,
         round((ST_Area(x.g) / 10000)::numeric, 2),
         ST_AsGeoJSON(ST_Transform(ST_Multi(ST_CollectionExtract(x.g, 3)), 4326), 6)::json
    from piezas x left join productores.catalogo_accion a on a.id = x.accion_id
   where not ST_IsEmpty(ST_CollectionExtract(x.g, 3)) and ST_Area(x.g) >= 50
   order by x.cod_lote, x.clave = 'franja'
$$;
revoke all on function productores.posibilidades_manejo(uuid) from public, anon;
grant execute on function productores.posibilidades_manejo(uuid) to authenticated;
