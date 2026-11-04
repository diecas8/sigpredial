-- =========================================================================
--  21 · Vista de Access r_predios con la calidad del registro
--  Agrega al final: calidad (Completo / Por revisar / Incompleto),
--  pendientes (texto), documento_productor (Sí / Falta) y fecha_delimitacion.
-- =========================================================================
create or replace view productores.r_predios with (security_invoker = true) as
 SELECT p.id::text AS id,
    p.cod_predio,
    p.nombre AS predio,
    p.productor_id::text AS productor_id,
    pr.num_doc,
    TRIM(BOTH FROM (pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text)) AS productor,
    pr.asociacion,
    d.nombre AS departamento,
    m.nombre AS municipio,
    v.nombre AS vereda,
    t.nombre AS tenencia,
    p.area_declarada_ha::double precision AS area_declarada_ha,
    p.area_sig_ha::double precision AS area_sig_ha,
        CASE
            WHEN p.area_declarada_ha > 0::numeric AND p.area_sig_ha > 0::numeric THEN round(100.0 * (p.area_sig_ha - p.area_declarada_ha) / p.area_declarada_ha, 1)::double precision
            ELSE NULL::double precision
        END AS dif_area_pct,
    (( SELECT count(*) AS count
           FROM productores.lote l
          WHERE l.predio_id = p.id))::integer AS n_lotes,
    (( SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) AS sum
           FROM productores.lote l
          WHERE l.predio_id = p.id))::double precision AS area_lotes_ha,
    (( SELECT count(*) AS count
           FROM productores.elemento_punto e
             JOIN productores.tipo_elemento te ON te.id = e.tipo_id
          WHERE e.predio_id = p.id AND te.nombre = 'Nacimiento / afloramiento'::text))::integer AS n_nacimientos,
    (( SELECT round(sum(e.longitud_m)) AS round
           FROM productores.elemento_linea e
             JOIN productores.tipo_elemento te ON te.id = e.tipo_id
          WHERE e.predio_id = p.id AND te.grupo = 'Hídrico'::text))::double precision AS m_cauces,
    (( SELECT round(sum(e.longitud_m)) AS round
           FROM productores.elemento_linea e
             JOIN productores.tipo_elemento te ON te.id = e.tipo_id
          WHERE e.predio_id = p.id AND te.grupo = 'Vial'::text))::double precision AS m_vias,
    round(st_y(p.punto)::numeric, 6)::double precision AS latitud,
    round(st_x(p.punto)::numeric, 6)::double precision AS longitud,
    p.altitud_msnm,
    "left"(p.como_llegar, 255) AS como_llegar,
    (p.creado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_registro,
    (p.editado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_edicion,
    p.cod_humboldt,
        CASE
            WHEN p.geom IS NULL THEN 'Pendiente de delimitar'::text
            ELSE 'Delimitado'::text
        END AS estado_limite,
        CASE
            WHEN v.id IS NULL THEN NULL::text
            WHEN v.validada THEN 'Sí'::text
            ELSE 'Por validar'::text
        END AS vereda_validada,
    p.gps_precision_m::double precision AS gps_precision_m,
    ( SELECT max(c.fecha_visita) AS max
           FROM productores.caracterizacion c
          WHERE c.predio_id = p.id AND c.estado = 'procesada'::text) AS fecha_caracterizacion,
    ( SELECT (f.generado_en AT TIME ZONE 'America/Bogota'::text) AS timezone
           FROM productores.ficha_predial f
          WHERE f.predio_id = p.id) AS fecha_ficha_pdf,
    round(st_x(st_transform(p.punto, 9377))::numeric, 2)::double precision AS este_9377,
    round(st_y(st_transform(p.punto, 9377))::numeric, 2)::double precision AS norte_9377,
    CASE productores.nivel_calidad(rv.pendientes)
        WHEN 'verde' THEN 'Completo' WHEN 'amarillo' THEN 'Por revisar' ELSE 'Incompleto'
    END AS calidad,
    left(array_to_string(ARRAY(SELECT substr(x, 3) FROM unnest(rv.pendientes) x), ' · '), 255) AS pendientes,
    CASE WHEN pr.num_doc LIKE 'PEND-%' THEN 'Falta' ELSE 'Sí' END AS documento_productor,
    (p.delimitado_en AT TIME ZONE 'America/Bogota'::text) AS fecha_delimitacion
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id
     CROSS JOIN LATERAL (SELECT productores.revision_predio(p.id) AS pendientes) rv;
