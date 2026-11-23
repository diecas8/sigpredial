-- 51 · Uso «Potrero con árboles dispersos» (pedido de Diego, 23-11-2026)
-- Para dibujar en la finca soñada el potrero donde se siembran árboles dispersos
-- (también sirve para potreros que ya los tienen hoy). Acción: Árboles dispersos en praderas.
insert into productores.cultivo (nombre, tipo, codigo)
values ('Potrero con árboles dispersos', 'Pecuario', 'arboles_dispersos')
on conflict (nombre) do nothing;

insert into productores.regla_manejo (cultivo_id, clave, posibilidad, accion_id, linea_hoy, linea_prop, cede_franja)
select id, 'silvo', 'Árboles dispersos en el potrero (sombra, forraje y madera)', 3,
       'Ganadería bovina', 'Ganadería bovina', true
  from productores.cultivo where codigo = 'arboles_dispersos'
on conflict (cultivo_id) do update set clave = excluded.clave, posibilidad = excluded.posibilidad,
  accion_id = excluded.accion_id, linea_hoy = excluded.linea_hoy, linea_prop = excluded.linea_prop;
