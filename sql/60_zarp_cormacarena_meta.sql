-- =========================================================================
--  60 · ZARP de Cormacarena en el Meta (Res. PS-GJ.1.2.6.24.1413 de 2024)
--
--  Lineamientos de la Zonificación Ambiental Rural Participativa (ZARP) de Cormacarena.
--  Solo para predios del Meta (cod_mpio 50…); Caquetá no cambia.
--   a) catalogo_accion.cormacarena_ref: respaldo de la acción en la tabla 8 de los
--      lineamientos (orientaciones de manejo por zona ZARP).
--   b) catalogo_accion.dptos: acciones solo para ciertos departamentos (null = todos).
--      Las acciones nuevas de la tabla 8 quedan solo para el Meta.
--   c) zarp_lotes(predio): zona ZARP sugerida para cada lote actual, cruzando la zona
--      de Cormacarena (AMEM, POMCA Medio y Bajo Ariari, subzonas POF del DMI) con el uso
--      actual del lote (tablas 9 y 10: con o sin conflicto de uso). Es una propuesta
--      para concertar con la familia: orienta, no regula. Donde no hay instrumento de
--      ordenamiento (p. ej. Mapiripán), la cobertura natural va a preservación (tabla 16).
-- =========================================================================

-- a) y b) ------------------------------------------------------------------------------
alter table productores.catalogo_accion add column if not exists cormacarena_ref text;
alter table productores.catalogo_accion add column if not exists dptos text[];

update productores.catalogo_accion c set cormacarena_ref = x.ref
  from (values
    ('Cierre de frontera agrícola', 'Preservación: protección y conservación de la cobertura boscosa.'),
    ('Protección de nacimientos y cauces', 'Preservación: protección y conservación de las fajas de fuentes hídricas y la cobertura boscosa.'),
    ('Pago por servicios ambientales', 'Preservación: incentivos a la conservación.'),
    ('Aislamiento de áreas de conservación', 'Restauración para la preservación: encerramiento de áreas en restauración, aislamiento con barreras y cercas vivas de especies nativas.'),
    ('Cercas vivas', 'Restauración para la preservación: aislamiento con barreras y cercas vivas de especies nativas.'),
    ('Barreras vivas', 'Restauración para la preservación: aislamiento con barreras y cercas vivas de especies nativas.'),
    ('Turismo de naturaleza y aviturismo', 'Preservación y restauración: ecoturismo e infraestructura liviana ecoturística.'),
    ('Sistema silvopastoril', 'Restauración para la recuperación: reconversión de la ganadería a sistemas silvopastoriles con especies nativas promisorias.'),
    ('Árboles dispersos en praderas', 'Restauración para la recuperación: arreglos arbóreos con especies nativas en la reconversión de la ganadería.'),
    ('División de potreros con árboles', 'Restauración para la recuperación: arreglos arbóreos con especies nativas en la reconversión de la ganadería.'),
    ('Parcela agroforestal (frutos amazónicos y maderables)', 'Restauración para la recuperación y uso sostenible: sistemas agroforestales con especies nativas forestales promisorias.'),
    ('Meliponicultura', 'Restauración para la recuperación: meliponicultura (abejas sin aguijón para la producción de miel).'),
    ('Paneles solares', 'Restauración para la recuperación: paneles solares o celdas fotovoltaicas.'),
    ('Cosecha de agua lluvia', 'Restauración para la recuperación: estructuras livianas de reservorios y captación de agua de impacto mínimo; gestión del recurso hídrico.'),
    ('Beneficio ecológico del café', 'Restauración para la recuperación: infraestructura liviana para el beneficio de café.'),
    ('Mejoramiento del beneficio de cacao (fermentación y secado)', 'Restauración para la recuperación: infraestructura liviana para el beneficio de cacao.'),
    ('Manejo integrado de enfermedades del cacao (monilia)', 'Manejo integrado de plagas con estrategias culturales; sin agroquímicos de síntesis en restauración para la recuperación.'),
    ('Manejo integrado de la broca', 'Manejo integrado de plagas con estrategias culturales; sin agroquímicos de síntesis en restauración para la recuperación.'),
    ('Huerta casera para la seguridad alimentaria', 'Aprovechamiento y desarrollo sostenible: huertas ecológicas y cultivos de pancoger para la soberanía alimentaria.'),
    ('Mejoramiento de galpones y corrales', 'Desarrollo sostenible: especies menores con tecnologías ambientalmente sostenibles (galpones, porquerizas).'),
    ('Mejoramiento de vivienda existente', 'Restauración para la recuperación: mejoras en la infraestructura liviana de vivienda.'),
    ('Saneamiento básico de la vivienda (pozo séptico)', 'Trámite del permiso de vertimiento de aguas residuales ante Cormacarena.'),
    ('Aprovechamiento de frutos del bosque (canangucha, asaí)', 'Aprovechamiento de productos no maderables del bosque, con permiso de aprovechamiento forestal ante Cormacarena.')
  ) as x(nombre, ref)
 where c.nombre = x.nombre;

insert into productores.catalogo_accion (nombre, tipo, unidad, activo, dptos, cormacarena_ref)
select x.nombre, x.tipo, x.unidad, true, array['50'], x.ref
  from (values
    ('Restauración ecológica con especies nativas', 'Restauración', 'ha',
     'Restauración para la preservación: restauración de áreas degradadas de interés ecológico (restauración ecológica o rehabilitación).'),
    ('Enriquecimiento de bosques y rastrojos con especies nativas', 'Restauración', 'ha',
     'Preservación y restauración: enriquecimiento de bosques fragmentados, fajas de protección y rastrojos con especies nativas.'),
    ('Reconversión de potreros o monocultivos a sistemas agroforestales', 'Restauración', 'ha',
     'Restauración para la recuperación: reconversión de ganadería, monocultivos y cultivos de mayor impacto a sistemas agroforestales, silvopastoriles y otros arreglos arbóreos con especies nativas.'),
    ('Aprovechamiento de productos no maderables del bosque', 'Diversificación', 'ha',
     'Preservación y restauración: aprovechamiento sostenible de productos no maderables del bosque, con permiso de aprovechamiento forestal ante Cormacarena.'),
    ('Especies menores para la economía campesina', 'Diversificación', 'sistemas',
     'Restauración para la recuperación y uso sostenible: especies menores con énfasis en la economía campesina y la soberanía alimentaria, con tecnologías sostenibles.'),
    ('Abonos orgánicos y compostaje', 'Producción sostenible', 'sistemas',
     'Restauración para la recuperación y uso sostenible: compostaje, abonos orgánicos y manejo integrado de plagas.'),
    ('Estufa ecoeficiente y banco dendroenergético', 'Vivienda y saneamiento', 'sistemas',
     'Restauración para la recuperación: estufas ecoeficientes y bancos dendroenergéticos.'),
    ('Concesión de aguas y permiso de vertimientos', 'Vivienda y saneamiento', 'trámites',
     'Trámite de permisos ambientales (concesión de aguas y vertimiento de aguas residuales) ante Cormacarena.'),
    ('Educación ambiental y monitoreo comunitario', 'Conservación', 'actividades',
     'Preservación: investigación, monitoreo ambiental y educación ambiental.')
  ) as x(nombre, tipo, unidad, ref)
 where not exists (select 1 from productores.catalogo_accion c where c.nombre = x.nombre);

-- c) ------------------------------------------------------------------------------------
create or replace function productores.zarp_lotes(p_predio uuid)
returns table (lote_id uuid, clase text, determinante text, pct numeric, uso text, tipo_uso text,
               conflicto boolean, zarp text, zona_pps text, motivo text)
language sql stable security definer
set search_path to 'productores', 'extensions', 'public'
as $$
  with l as (
    select l.id, l.geom, p.cod_mpio, productores.area_ha(l.geom) as ha, c.nombre as uso, c.tipo as tipo_uso,
           case
             when c.id is null or c.tipo = 'Otro' then 'O'
             when c.tipo = 'Conservación' or c.nombre in ('Bosque / forestal', 'Frutos del bosque (canangucha, asaí)') then 'N'
             when c.tipo in ('Agroforestal', 'Agricultura campesina', 'Descanso')
               or c.nombre in ('Pancoger', 'Huerta', 'Especies menores', 'Piscicultura', 'Forestal maderable') then 'S'
             else 'H' end as u,
           (c.tipo = 'Agricultura campesina' or c.nombre in ('Pancoger', 'Huerta', 'Especies menores')) as alimentos
      from productores.lote l
      join productores.predio p on p.id = l.predio_id
      left join productores.cultivo c on c.id = l.cultivo_id
     where l.predio_id = p_predio and l.escenario = 'actual' and l.geom is not null
       and p.cod_mpio like '50%' and productores.ve_predio(p_predio)
  ),
  d as (
    select d.cod_mpio, d.grupo, d.categoria, d.geom,
           case
             when d.grupo = 'Área de Manejo Especial La Macarena (AMEM)' then
               case when d.categoria ~ '^(PNN|Preservación)' then 'C'
                    when d.categoria ~ '^Recuperación para la Preservación' then 'R'
                    when d.categoria ~ '^Recuperación para la Producción' then 'RP'
                    when d.categoria ~ '^Producción' then 'P' end
             when d.grupo = 'DMI Macarena Norte · subzonas POF' then
               case when d.categoria ~ '^Subzona de preservación' then 'C'
                    when d.categoria ~ '^Subzona de restauración' then 'R' else 'P' end
             when d.grupo = 'POMCA Río Medio y Bajo Ariari' then
               case when d.categoria in ('Áreas de importancia ambiental', 'Áreas complementarias para la conservación',
                                         'Áreas con reglamentación especial', 'Áreas protegidas (SINAP)', 'Áreas de amenazas naturales') then 'C'
                    when d.categoria = 'Áreas de restauración ecológica' then 'R'
                    when d.categoria = 'Áreas de recuperación para el uso múltiple' then 'RP'
                    when d.categoria in ('Áreas agrícolas', 'Áreas agrosilvopastoriles') then 'P' end
           end as clase
      from productores.determinante d
     where d.grupo in ('Área de Manejo Especial La Macarena (AMEM)', 'DMI Macarena Norte · subzonas POF',
                       'POMCA Río Medio y Bajo Ariari')
  ),
  x as (   -- porcentaje del lote en cada zona de Cormacarena
    select l.id, d.clase, d.grupo, d.categoria,
           100 * productores.area_ha(ST_Union(ST_CollectionExtract(ST_Intersection(d.geom, l.geom), 3))) / nullif(l.ha, 0) as pct
      from l join d on d.cod_mpio = l.cod_mpio and d.clase is not null and d.geom && l.geom and ST_Intersects(d.geom, l.geom)
     group by l.id, l.ha, d.clase, d.grupo, d.categoria
  ),
  k as (   -- por clase: la más restrictiva que cubra al menos 20 % del lote; si ninguna, la de mayor área
    select x.id, x.clase, sum(x.pct) as pct,
           (array_agg(x.categoria || ' · ' || split_part(x.grupo, ' (', 1) order by x.pct desc))[1] as det
      from x where x.pct >= 1 group by x.id, x.clase
  ),
  dom as (
    select distinct on (k.id) k.id, k.clase, k.det, k.pct
      from k
     order by k.id, (k.pct >= 20) desc,
              case k.clase when 'C' then 1 when 'R' then 2 when 'RP' then 3 else 4 end, k.pct desc
  ),
  r as (
    select l.id, dom.clase, dom.det, round(least(dom.pct, 100), 0) as pct, l.uso, l.tipo_uso, l.u, l.alimentos
      from l left join dom on dom.id = l.id
  )
  select r.id, r.clase, r.det, r.pct, r.uso, r.tipo_uso,
         case when r.u = 'N' then false
              when r.clase is null or r.u = 'O' then null
              when r.clase in ('C', 'R') then true
              when r.clase = 'RP' then r.u = 'H'
              else false end,
         case when r.u = 'N' then 'Preservación'
              when r.clase is null then null
              when r.u = 'O' then case r.clase when 'C' then 'Preservación' when 'R' then 'Restauración para la preservación'
                                              when 'RP' then 'Restauración para la recuperación' else 'Desarrollo sostenible' end
              when r.clase in ('C', 'R') then case when r.u = 'S' then 'Restauración para la recuperación' else 'Restauración para la preservación' end
              when r.clase = 'RP' then case when r.u = 'H' then 'Restauración para la recuperación' else 'Aprovechamiento sostenible' end
              else 'Desarrollo sostenible' end,
         case when r.u = 'N' then 'preservacion'
              when r.clase is null then null
              when r.u = 'O' then case r.clase when 'C' then 'preservacion' when 'R' then 'restauracion'
                                              when 'RP' then 'recuperacion' else 'produccion_sostenible' end
              when r.clase in ('C', 'R') then case when r.u = 'S' then 'recuperacion' else 'restauracion' end
              when r.clase = 'RP' then case when r.u = 'H' then 'recuperacion' else 'produccion_sostenible' end
              when r.alimentos then 'soberania_alimentaria'
              else 'produccion_sostenible' end,
         case when r.clase is null and r.u = 'N' then 'Sin instrumento de ordenamiento de Cormacarena: la cobertura natural se conserva (tabla 16).'
              when r.clase is null then 'Sin instrumento de ordenamiento de Cormacarena: proteger rondas hídricas y coberturas naturales (tabla 16) y concertar el resto según el uso.'
              when r.u = 'O' then 'Revise el uso del lote para confirmar si hay conflicto.'
              when r.u = 'N' then 'Cobertura natural: se conserva.'
              when r.clase in ('C', 'R') and r.u = 'S' then 'Zona de conservación con uso productivo: reconvertir a sistemas con árboles nativos.'
              when r.clase in ('C', 'R') then 'Zona de conservación con uso de mayor impacto: restaurar.'
              when r.clase = 'RP' and r.u = 'H' then 'Zona de recuperación con uso de mayor impacto: reconversión productiva.'
              when r.clase = 'RP' then 'Uso compatible con la recuperación para la producción.'
              when r.u = 'H' then 'Zona de producción: producir con buenas prácticas y árboles.'
              else 'Zona de producción: uso compatible.' end
    from r
   order by r.id
$$;
revoke all on function productores.zarp_lotes(uuid) from public, anon;
grant execute on function productores.zarp_lotes(uuid) to authenticated;
