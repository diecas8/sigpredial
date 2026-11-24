-- =====================================================================
-- 55 · Por qué el área dibujada no coincide con la declarada
-- ---------------------------------------------------------------------
-- Al delimitar, el área SIG suele diferir del área que dio la familia o
-- que dice el documento. El técnico deja el motivo y una nota en el
-- predio, en vez de cambiar el área declarada (las dos se comparan).
-- =====================================================================
alter table productores.predio
  add column if not exists dif_area_motivo text
    check (dif_area_motivo in ('aproximada', 'documento', 'no_recorrido', 'otros_predios', 'compraventa', 'otro')),
  add column if not exists dif_area_nota text;

comment on column productores.predio.dif_area_motivo is
  'Motivo de la diferencia entre área SIG y declarada: aproximada (la familia dio un dato aproximado), documento (el documento tiene otra área), no_recorrido (parte del lindero sin recorrer), otros_predios (el área declarada incluye otros predios), compraventa (compras, ventas o divisiones), otro.';
comment on column productores.predio.dif_area_nota is 'Explicación del técnico sobre la diferencia de área.';

-- La vista del portal trae los dos campos (se agregan al final, sin cambiar lo demás)
create or replace view productores.v_predio with (security_invoker = true) as
 SELECT p.id, p.cod_predio, p.productor_id, p.nombre, p.num_predial, p.matricula, p.tenencia_id,
    t.nombre AS tenencia, p.area_declarada_ha, p.area_sig_ha, p.cod_mpio, m.nombre AS municipio,
    p.vereda_id, v.nombre AS vereda, p.altitud_msnm, p.como_llegar,
    st_y(p.punto) AS latitud, st_x(p.punto) AS longitud, st_asgeojson(p.geom, 7)::json AS geojson,
    pr.num_doc, TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    ( SELECT count(*) AS count FROM productores.lote l
       WHERE l.predio_id = p.id AND l.escenario = 'actual'::text) AS n_lotes,
    ( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) AS sum FROM productores.lote l
       WHERE l.predio_id = p.id AND l.escenario = 'actual'::text) AS area_lotes_ha,
    p.creado_por, p.creado_en, p.editado_en,
    CASE WHEN p.geom IS NULL THEN 'Pendiente de delimitar'::text ELSE 'Delimitado'::text END AS estado_limite,
    v.validada AS vereda_validada, p.cod_humboldt,
    productores.nivel_calidad(rv.pendientes) AS calidad, rv.pendientes,
    p.dif_area_motivo, p.dif_area_nota
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id
     CROSS JOIN LATERAL ( SELECT productores.revision_predio(p.id) AS pendientes) rv;
