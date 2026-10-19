-- =====================================================================
--  SIP-CBS · Coberturas y cultivos adicionales
--  Se puede ejecutar varias veces: no duplica ni borra nada.
-- =====================================================================
insert into productores.cultivo (nombre, tipo) values
  ('Humedal',              'Conservación'),
  ('Bosque de galería',    'Conservación'),
  ('Regeneración natural', 'Conservación'),
  ('Área en descanso',     'Descanso'),
  ('Palma de aceite',      'Permanente'),
  ('Arroz',                'Transitorio'),
  ('Pancoger',             'Transitorio')
on conflict (nombre) do nothing;

-- Comprobación
select nombre, tipo from productores.cultivo order by tipo, nombre;
