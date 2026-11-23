-- 48 · Uso «Agricultura campesina (patio productivo)» (pedido de Diego, 23-11-2026)
-- Un solo lote alrededor de la casa que agrupa vivienda, huerta, aves, cerdos o
-- galpones, frutales y medicinales. Lo que es para vender se dibuja aparte.
-- Línea PDEA: Agricultura campesina, familiar y comunitaria (ACFC).
insert into productores.cultivo (nombre, tipo, codigo)
values ('Agricultura campesina (patio productivo)', 'Agricultura campesina', 'acfc')
on conflict (nombre) do nothing;

insert into productores.regla_manejo (cultivo_id, clave, posibilidad, accion_id, linea_hoy, linea_prop, cede_franja)
select id, 'pancoger', 'Patio productivo: huerta, especies menores y frutales para la familia', 70,
       'Agricultura campesina, familiar y comunitaria', 'Agricultura campesina, familiar y comunitaria', true
  from productores.cultivo where codigo = 'acfc'
on conflict (cultivo_id) do update set clave = excluded.clave, posibilidad = excluded.posibilidad,
  accion_id = excluded.accion_id, linea_hoy = excluded.linea_hoy, linea_prop = excluded.linea_prop;
