-- =====================================================================
-- 37 · Vista de correcciones para la pantalla del coordinador
-- ---------------------------------------------------------------------
-- Agrega a r_correcciones (al final, sin cambiar las columnas que ya
-- tenía) el predio y las coordenadas del punto actual y del propuesto,
-- para abrir el predio y mostrar los dos puntos en el mapa.
-- Sigue con security_invoker: cada quien ve solo lo de su zona.
-- =====================================================================
create or replace view productores.r_correcciones with (security_invoker = true) as
select c.id, c.estado, c.campo,
       case c.campo when 'vereda' then 'Vereda' when 'punto' then 'Punto del predio' when 'num_doc' then 'Número de documento'
                    when 'nombre_productor' then 'Nombre del productor' when 'sexo' then 'Sexo'
                    when 'nombre_predio' then 'Nombre del predio' when 'area' then 'Área declarada (ha)' end as dato_corregido,
       c.valor_actual, c.valor_nuevo, (c.dato->>'distancia_m')::numeric as distancia_m,
       coalesce(c.dato->>'motivo_detalle', c.dato->>'motivo') as motivo, c.dato->>'observacion' as observacion,
       p.cod_predio, p.cod_humboldt, p.nombre as predio, m.nombre as municipio, d.nombre as departamento,
       k.fecha_visita, k.tecnico, c.creado_en, c.nota, c.revisado_en,
       (select nombre from productores.usuario_app u where u.user_id = c.revisado_por) as revisado_por,
       c.predio_id, p.productor_id, m.cod_dpto,
       extensions.st_y(p.punto) as lat_actual, extensions.st_x(p.punto) as lon_actual,
       (c.dato->>'lat')::float8 as lat_nueva, (c.dato->>'lon')::float8 as lon_nueva,
       (c.dato->>'precision_m')::numeric as precision_m, c.caracterizacion_id
  from productores.correccion_predio c
  join productores.predio p on p.id = c.predio_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  join productores.caracterizacion k on k.id = c.caracterizacion_id;
grant select on productores.r_correcciones to authenticated;
