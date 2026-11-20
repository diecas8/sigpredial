-- =========================================================================
--  44 · Acciones del catálogo con respaldo en las determinantes de Corpoamazonia
--
--  Fuente: fichas técnicas de las resoluciones de determinantes ambientales de
--  los 8 municipios (Florencia 0054/2021, El Paujil 1283/2021, Morelia 1284/2021,
--  Solita 1281/2021, Belén 1653/2019, Milán 1644/2019, San José del Fragua
--  1646/2019, San Vicente 1649/2019):
--   · Ficha de cambio climático (en los 8): prácticas agropecuarias recomendadas.
--   · DCSAC (fichas de San Vicente, El Paujil y Morelia): actividades permitidas
--     por categoría (preservar, restaurar, rehabilitar, recuperar).
--   · Áreas forestales protectoras, humedales, áreas de importancia estratégica
--     y bosque natural remanente.
--  Solo informa: el plan de acción muestra un chip con la referencia.
-- =========================================================================
alter table productores.catalogo_accion add column if not exists corpo_ref text;

update productores.catalogo_accion c set corpo_ref = v.ref
  from (values
   (5,  'Ficha de cambio climático: sistemas silvopastoriles. DCSAC: permitido en las zonas de rehabilitar y recuperar.'),
   (3,  'Ficha de cambio climático: sistemas silvopastoriles.'),
   (23, 'Ficha de cambio climático: sistemas silvopastoriles y manejo de pasturas.'),
   (58, 'Ficha de cambio climático: manejo de pasturas, uso racional y gestión de las tierras de pastoreo.'),
   (61, 'Ficha de cambio climático: manejo de pasturas y su rehabilitación.'),
   (6,  'Ficha de cambio climático: suplementación de la dieta del ganado. DCSAC (recuperar): ganadería con banco de forrajes.'),
   (62, 'Ficha de cambio climático: suplementación de la dieta del ganado.'),
   (10, 'Ficha de cambio climático: recolección, almacenamiento y distribución de agua lluvia.'),
   (68, 'Ficha de cambio climático: modernización de las técnicas de riego.'),
   (21, 'Ficha de cambio climático: conservación de suelos.'),
   (4,  'DCSAC (rehabilitar y recuperar): cercas vivas para mejorar la conectividad.'),
   (7,  'DCSAC: actividades agroforestales permitidas en restaurar y rehabilitar; se recomienda pasar de modelos silvopastoriles a agroforestales.'),
   (70, 'Ficha de cambio climático: producción y consumo local. DCSAC: agricultura familiar para la seguridad alimentaria.'),
   (8,  'DCSAC: acuicultura permitida en las zonas de rehabilitar y recuperar.'),
   (65, 'DCSAC: acuicultura permitida en las zonas de rehabilitar y recuperar.'),
   (73, 'DCSAC y bosque remanente: aprovechamiento sostenible de productos no maderables del bosque, de bajo impacto.'),
   (71, 'DCSAC: ecoturismo y aviturismo permitidos en todas sus zonas, incluida la de preservar.'),
   (2,  'Área forestal protectora: 100 m alrededor de los nacimientos y faja de mínimo 30 m a cada lado de ríos, quebradas y caños (Decreto 1076 de 2015, art. 2.2.1.1.18.2).'),
   (22, 'Bosque natural remanente: el bosque existente debe mantenerse. Áreas de importancia estratégica: usos de preservación y restauración.'),
   (72, 'Áreas de importancia estratégica y DCSAC: compra de predios o pago por servicios ambientales.'),
   (1,  'Bosque natural remanente: el bosque dentro de la frontera agrícola es suelo de protección; prevenir la deforestación.'),
   (52, 'Ficha de cambio climático: control biológico y uso adecuado de agroquímicos.'),
   (57, 'Ficha de cambio climático: control biológico y uso adecuado de agroquímicos.')
  ) v(id, ref)
 where c.id = v.id;
