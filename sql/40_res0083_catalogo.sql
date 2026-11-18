-- =====================================================================
-- 40 · Catálogo de acciones PPS frente a la Resolución 0083 de 2026
-- ---------------------------------------------------------------------
-- Minambiente, Res. 0083 del 5 de febrero de 2026 (Diario Oficial 53.390),
-- corregida por la Res. 0122 de 2026: actividades de bajo impacto que se
-- pueden hacer en reservas forestales (Ley 2ª y protectoras) sin sustracción.
--
-- · catalogo_accion.res0083_num: numeral del art. 2 que permite la acción.
-- · res0083_estado: permitida · con_condiciones · por_revisar · no_aplica.
--   «por_revisar» = la norma no la nombra; queda pendiente del concepto
--   jurídico (cuadro de revisión «Acciones PPS frente a la Res. 0083»).
-- · res0083_nota: fundamento y condiciones, en palabras sencillas.
-- · Grupo nuevo «Vivienda y saneamiento» con tres acciones (num. 15, 16 y 8).
-- Lectura técnica para revisión jurídica; no es un concepto jurídico.
-- =====================================================================

alter table productores.catalogo_accion drop constraint if exists catalogo_accion_tipo_check;
alter table productores.catalogo_accion add constraint catalogo_accion_tipo_check
  check (tipo in ('Conservación', 'Restauración', 'Producción sostenible', 'Diversificación', 'Vivienda y saneamiento'));

alter table productores.catalogo_accion
  add column if not exists res0083_num    text,
  add column if not exists res0083_estado text,
  add column if not exists res0083_nota   text;
alter table productores.catalogo_accion drop constraint if exists catalogo_accion_res0083_estado_check;
alter table productores.catalogo_accion add constraint catalogo_accion_res0083_estado_check
  check (res0083_estado is null or res0083_estado in ('permitida', 'con_condiciones', 'por_revisar', 'no_aplica'));

update productores.catalogo_accion c
   set res0083_num = v.num, res0083_estado = v.estado, res0083_nota = v.nota
  from (values
    ('Cierre de frontera agrícola', '28', 'permitida', 'Num. 28: restauración, recuperación o rehabilitación de ecosistemas. Es conservación, no una obra.'),
    ('Protección de nacimientos y cauces', '28', 'permitida', 'Num. 28. El art. 3 b exige proteger nacimientos y rondas hídricas.'),
    ('Aislamiento de áreas de conservación', '28', 'permitida', 'Num. 28. Cercado sin abrir vías ni accesos (art. 3 a).'),
    ('Pago por servicios ambientales', null, 'no_aplica', 'Es un incentivo, no una obra ni una actividad en el terreno: no necesita encuadre en la 0083.'),
    ('Piscicultura', null, 'por_revisar', 'No está nombrada. Requiere concesión de aguas y permiso de vertimientos (arts. 4 a y 5). En humedales, solo si el plan de manejo la prevé (art. 3 c).'),
    ('Meliponicultura', '17', 'por_revisar', 'No está nombrada. Es compatible con la agroecología del num. 17 y no transforma coberturas.'),
    ('Establecimiento de frutales amazónicos', '17', 'con_condiciones', 'Num. 17: agricultura campesina o agroecología en áreas aptas, manteniendo las coberturas naturales e incorporando el componente forestal.'),
    ('Huerta casera para la seguridad alimentaria', '17', 'con_condiciones', 'Num. 17 (agricultura familiar), cerca de la vivienda y sin talar coberturas naturales.'),
    ('Turismo de naturaleza y aviturismo', '9', 'con_condiciones', 'Num. 9: miradores, plataformas y señalización con infraestructura verde. Sin abrir caminos nuevos ni construir hospedaje o comercio.'),
    ('Aprovechamiento de frutos del bosque (canangucha, asaí)', '20', 'con_condiciones', 'Num. 20: acopio, transformación y venta de productos no maderables amparados en acto administrativo. Requiere permiso de aprovechamiento (arts. 4 f y 5).'),
    ('Sistema silvopastoril', '17', 'por_revisar', 'La norma no nombra la ganadería; el componente forestal acerca la acción al num. 17. Confirmar con la zona de Ley 2ª (A o B).'),
    ('Bancos de proteína', '17', 'por_revisar', 'Igual que el silvopastoril: forraje arbóreo para ganado, y la ganadería no está nombrada.'),
    ('Parcela agroforestal (frutos amazónicos y maderables)', '17', 'con_condiciones', 'Num. 17: es el arreglo que la norma describe (agricultura campesina con componente forestal, manteniendo coberturas naturales).'),
    ('Cosecha de agua lluvia', '7 o 17', 'por_revisar', 'No está nombrada. El num. 7 cubre captación y almacenamiento de acueductos rurales y el 17 las instalaciones agropecuarias. Es de bajo impacto.'),
    ('Paneles solares', '21', 'permitida', 'Num. 21: soluciones fotovoltaicas individuales aisladas. Las baterías usadas se manejan como residuo peligroso (art. 4 l).'),
    ('Barreras vivas', '28', 'permitida', 'Num. 28 (recuperación de suelos): siembra de especies, sin obras.'),
    ('División de potreros con árboles', '28', 'con_condiciones', 'La siembra de árboles es restauración (num. 28); el uso ganadero del potrero sigue por revisar.'),
    ('Poda de formación y mantenimiento del cacao', '17', 'con_condiciones', 'Num. 17: manejo del cultivo existente con buenas prácticas agropecuarias.'),
    ('Renovación o injertación de cacao', '17', 'con_condiciones', 'Num. 17: renovar en el área ya cultivada, sin ampliar sobre coberturas naturales.'),
    ('Manejo de sombra en cacao', '17', 'con_condiciones', 'Num. 17: la sombra es el componente forestal que pide la norma.'),
    ('Manejo integrado de enfermedades del cacao (monilia)', '17', 'con_condiciones', 'Num. 17 con buenas prácticas agropecuarias.'),
    ('Mejoramiento del beneficio de cacao (fermentación y secado)', '17', 'con_condiciones', 'El num. 17 cubre instalaciones de almacenamiento y alistamiento. Manejo de residuos y vertimientos (art. 4 a y b).'),
    ('Renovación de cafetales', '17', 'con_condiciones', 'Num. 17: renovar en el área ya cultivada, sin ampliar sobre coberturas naturales.'),
    ('Sombrío en café', '17', 'con_condiciones', 'Num. 17: el sombrío es el componente forestal que pide la norma.'),
    ('Beneficio ecológico del café', '17', 'con_condiciones', 'Instalación de alistamiento (num. 17). Vertimientos con permiso (art. 4 a).'),
    ('Manejo integrado de la broca', '17', 'con_condiciones', 'Num. 17 con buenas prácticas agropecuarias.'),
    ('Rotación de potreros', null, 'por_revisar', 'La 0083 no nombra la ganadería. Revisar el régimen de usos de la zona de Ley 2ª.'),
    ('Acueducto ganadero y bebederos', '7', 'por_revisar', 'El num. 7 habla de acueductos rurales; el uso pecuario no está explícito. Requiere concesión de aguas (art. 5).'),
    ('Mejoramiento genético del ganado', null, 'no_aplica', 'No es una intervención en el terreno: no necesita encuadre. La ganadería en sí sigue por revisar.'),
    ('Renovación de praderas con pastos mejorados', null, 'por_revisar', 'Ganadería no nombrada. En ningún caso puede ampliar la pradera sobre coberturas naturales.'),
    ('Conservación de forraje (ensilaje o henolaje)', null, 'por_revisar', 'Instalación pecuaria no nombrada; el num. 17 solo cubre almacenamiento de la agricultura campesina.'),
    ('Renovación del cañaduzal', '17', 'con_condiciones', 'Num. 17: renovar en el área ya cultivada, sin ampliar sobre coberturas naturales.'),
    ('Mejoramiento del trapiche', null, 'por_revisar', 'Es transformación: el num. 17 cubre almacenamiento y alistamiento, no transformación. Vertimientos y emisiones (art. 4 a y k).'),
    ('Mejoramiento de estanques', null, 'por_revisar', 'Como la piscicultura: no está nombrada; requiere concesión de aguas y permiso de vertimientos.'),
    ('Mejoramiento de galpones y corrales', '17', 'por_revisar', 'Infraestructura pecuaria existente. El num. 17 nombra instalaciones de almacenamiento y alistamiento, no corrales.'),
    ('Renovación de platanera con semilla limpia', '17', 'con_condiciones', 'Num. 17: renovar en el área ya cultivada, sin ampliar sobre coberturas naturales.'),
    ('Sistema de riego', '18', 'con_condiciones', 'Num. 18: riego individual o comunitario de hasta 30 ha para agricultura campesina, sin degradar humedales ni suelos. No aplica en reservas forestales protectoras. Concesión de aguas (art. 5).'),
    ('Árboles dispersos en praderas', '28', 'permitida', 'Num. 28: restauración, recuperación o rehabilitación de ecosistemas.'),
    ('Cercas vivas', '28', 'permitida', 'Num. 28: restauración, recuperación o rehabilitación de ecosistemas.')
  ) v(nombre, num, estado, nota)
 where c.nombre = v.nombre;

insert into productores.catalogo_accion (nombre, tipo, unidad, res0083_num, res0083_estado, res0083_nota)
select v.* from (values
    ('Mejoramiento de vivienda existente', 'Vivienda y saneamiento', 'viviendas', '15', 'con_condiciones', 'Num. 15: adecuar, reforzar o reconstruir la vivienda rural aislada que existía al zonificar la Ley 2ª, con su saneamiento. En reservas protectoras, según el plan de manejo.'),
    ('Construcción de vivienda rural en predio titulado', 'Vivienda y saneamiento', 'viviendas', '16', 'con_condiciones', 'Num. 16: vivienda unifamiliar rural aislada en predio con título individual o colectivo, de uso residencial y sin obras de uso común.'),
    ('Saneamiento básico de la vivienda (pozo séptico)', 'Vivienda y saneamiento', 'sistemas', '15 y 8', 'con_condiciones', 'Num. 15 (sistemas de tratamiento de la vivienda existente) y num. 8 (alcantarillado de vivienda rural aislada). Vertimientos con permiso (art. 4 a).')
  ) v(nombre, tipo, unidad, num, estado, nota)
 where not exists (select 1 from productores.catalogo_accion a where a.nombre = v.nombre);
