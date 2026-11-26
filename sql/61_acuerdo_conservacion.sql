-- =========================================================================
--  61 · Interés en firmar acuerdos de conservación (pedido por Cormacarena, Meta)
--
--  predio.acuerdo_conservacion: 'si' | 'no' | 'ya_tiene'. Lo marca el técnico en el portal,
--  en la tarjeta ZARP de la finca soñada; solo se muestra en los predios del Meta.
-- =========================================================================
alter table productores.predio add column if not exists acuerdo_conservacion text
  check (acuerdo_conservacion in ('si', 'no', 'ya_tiene'));

create or replace view productores.v_predio with (security_invoker = true) as
 SELECT p.id, p.cod_predio, p.productor_id, p.nombre, p.num_predial, p.matricula, p.tenencia_id,
    t.nombre AS tenencia, p.area_declarada_ha, p.area_sig_ha, p.cod_mpio, m.nombre AS municipio,
    p.vereda_id, v.nombre AS vereda, p.altitud_msnm, p.como_llegar,
    extensions.st_y(p.punto) AS latitud, extensions.st_x(p.punto) AS longitud,
    extensions.st_asgeojson(p.geom, 7)::json AS geojson,
    pr.num_doc,
    TRIM(BOTH FROM (pr.nombres || ' ') || COALESCE(pr.apellidos, '')) AS productor,
    ( SELECT count(*) FROM productores.lote l WHERE l.predio_id = p.id AND l.escenario = 'actual') AS n_lotes,
    ( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) FROM productores.lote l
       WHERE l.predio_id = p.id AND l.escenario = 'actual') AS area_lotes_ha,
    p.creado_por, p.creado_en, p.editado_en,
    CASE WHEN p.geom IS NULL THEN 'Pendiente de delimitar' ELSE 'Delimitado' END AS estado_limite,
    v.validada AS vereda_validada, p.cod_humboldt,
    productores.nivel_calidad(rv.pendientes) AS calidad, rv.pendientes,
    p.dif_area_motivo, p.dif_area_nota,
    p.delimitado_en,
    CASE WHEN p.delimitado_por IS NOT NULL THEN productores.delimitador_del_predio(p.id) END AS delimitado_por,
    p.acuerdo_conservacion
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id
     CROSS JOIN LATERAL ( SELECT productores.revision_predio(p.id) AS pendientes) rv;
