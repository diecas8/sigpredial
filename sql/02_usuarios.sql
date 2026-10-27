-- =====================================================================
--  SIP-CBS · Registro de usuarios de la aplicación
--
--  Paso previo: cree cada usuario en Supabase › Authentication › Users
--  (botón "Add user" › correo y contraseña, o "Invite").
--  Luego ejecute este bloque cambiando los correos y nombres.
--
--  Desde el SQL 12 cada técnico y cada coordinador tiene UN departamento
--  (cod_dpto, código DANE de 2 dígitos) y solo ve la información de ese
--  departamento.  "18" = Caquetá · "50" = Meta · "76" = Valle del Cauca.
--  El administrador no lleva departamento: ve todo.
-- =====================================================================

-- 1. Administrador (primero usted)
insert into productores.usuario_app (user_id, nombre, correo, rol, region)
select id, 'Diego Castaño Parra', email, 'admin', 'Valle del Cauca'
  from auth.users where email = 'diego.castano@biocomerciosostenible.org'
on conflict (user_id) do update set rol = excluded.rol, activo = true;

-- 2. Técnicos y coordinadores (una fila por persona: correo, nombre, rol, departamento)
insert into productores.usuario_app (user_id, nombre, correo, rol, cod_dpto, region)
select u.id, t.nombre, u.email, t.rol, t.cod_dpto, d.nombre
  from auth.users u
  join (values
     ('tecnico1@correo.com',     'Nombre Técnico 1',     'tecnico',     '18'),   -- Caquetá
     ('tecnico2@correo.com',     'Nombre Técnico 2',     'tecnico',     '50'),   -- Meta
     ('coordinador1@correo.com', 'Nombre Coordinador 1', 'coordinador', '50')    -- Meta
  ) as t(correo, nombre, rol, cod_dpto) on t.correo = u.email
  join productores.departamento d on d.cod_dpto = t.cod_dpto
on conflict (user_id) do update
  set nombre = excluded.nombre, rol = excluded.rol, cod_dpto = excluded.cod_dpto,
      region = excluded.region, activo = true;

-- Para cambiar a alguien de departamento:
-- update productores.usuario_app set cod_dpto = '50' where correo = 'tecnico1@correo.com';

-- Para desactivar a alguien sin borrarlo:
-- update productores.usuario_app set activo = false where correo = 'tecnico1@correo.com';

-- Para ver quién está registrado:
-- select nombre, correo, rol, cod_dpto, activo from productores.usuario_app order by cod_dpto, rol, nombre;
