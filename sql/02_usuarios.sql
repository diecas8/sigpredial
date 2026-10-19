-- =====================================================================
--  SIP-CBS · Registro de usuarios de la aplicación
--
--  Paso previo: cree cada usuario en Supabase › Authentication › Users
--  (botón "Add user" › correo y contraseña, o "Invite").
--  Luego ejecute este bloque cambiando los correos y nombres.
-- =====================================================================

-- 1. Administrador (primero usted)
insert into productores.usuario_app (user_id, nombre, correo, rol, region)
select id, 'Diego Castaño Parra', email, 'admin', 'Valle del Cauca'
  from auth.users where email = 'diego.castano@biocomerciosostenible.org'
on conflict (user_id) do update set rol = excluded.rol, activo = true;

-- 2. Técnicos (repita una fila por técnico)
insert into productores.usuario_app (user_id, nombre, correo, rol, region)
select u.id, t.nombre, u.email, 'tecnico', t.region
  from auth.users u
  join (values
     ('tecnico1@correo.com', 'Nombre Técnico 1', 'Región 1'),
     ('tecnico2@correo.com', 'Nombre Técnico 2', 'Región 2')
  ) as t(correo, nombre, region) on t.correo = u.email
on conflict (user_id) do nothing;

-- Para desactivar a alguien sin borrarlo:
-- update productores.usuario_app set activo = false where correo = 'tecnico1@correo.com';

-- Para ver quién está registrado:
-- select nombre, correo, rol, region, activo from productores.usuario_app order by rol, nombre;
