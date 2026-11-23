-- 50 · Uso «Sistema agroforestal (cultivos con árboles)» (pedido de Diego, 23-11-2026)
-- Para la finca soñada (y también para lo que ya existe hoy): cultivos como cacao,
-- copoazú, arazá o plátano asociados con maderables o frutales amazónicos.
-- Línea PDEA: Frutas · Silvicultura.
insert into productores.cultivo (nombre, tipo, codigo)
values ('Sistema agroforestal (cultivos con árboles)', 'Agroforestal', 'agroforestal')
on conflict (nombre) do nothing;

insert into productores.regla_manejo (cultivo_id, clave, posibilidad, accion_id, linea_hoy, linea_prop, cede_franja)
select id, 'agrof', 'Fortalecer el sistema agroforestal (frutales amazónicos y maderables)', 7,
       'Frutas · Silvicultura', 'Frutas · Silvicultura', true
  from productores.cultivo where codigo = 'agroforestal'
on conflict (cultivo_id) do update set clave = excluded.clave, posibilidad = excluded.posibilidad,
  accion_id = excluded.accion_id, linea_hoy = excluded.linea_hoy, linea_prop = excluded.linea_prop;
