-- =========================================================================
--  34 · Segunda coordinadora: Helena Grosso Rodríguez
--
--   Mismos privilegios que Luisa Fernanda López:
--     rol = 'coordinador' y cod_dpto = NULL  →  ve Caquetá y Meta (todos los
--     departamentos), el tablero con sus pestañas por departamento, los
--     reportes y el Excel. No administra usuarios ni metas (eso es del admin).
--
--   Si se decide que Helena vea SOLO el Meta, cambie NULL por '50' en la
--   línea marcada (★) antes de ejecutar.
--
--   La cuenta se crea con una clave aleatoria que nadie conoce. Después de
--   ejecutar este archivo, el ADMINISTRADOR pone la clave genérica con
--       select productores.fijar_clave_inicial('<clave genérica>');
--   y el portal le pide a Helena cambiarla en su primer ingreso.
--   La clave nunca queda escrita en el repositorio ni en el chat.
-- =========================================================================

insert into productores.usuario_invitado (correo, nombre, rol, cod_dpto, municipios) values
  ('helena.grosso@biocomerciosostenible.org', 'Helena Grosso Rodríguez', 'coordinador',
   null,   -- (★) NULL = ve todos los departamentos, igual que Luisa · '50' = solo Meta
   '{}')
on conflict (correo) do update set nombre = excluded.nombre, rol = excluded.rol,
                                   cod_dpto = excluded.cod_dpto, municipios = excluded.municipios;

-- Cuenta de acceso (usuario = correo). El disparador la activa con su rol.
do $$
declare c text := 'helena.grosso@biocomerciosostenible.org'; v uuid;
begin
  if exists (select 1 from auth.users where lower(email) = c) then
    perform productores.activar_invitado((select id from auth.users where lower(email) = c), c);
    return;
  end if;
  v := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', c,
          extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v::text, v, jsonb_build_object('sub', v::text, 'email', c, 'email_verified', true, 'phone_verified', false),
          'email', now(), now());
end $$;

-- Verificación: debe salir una fila con rol 'coordinador'
select nombre, correo, rol, cod_dpto, activo, debe_cambiar_clave
  from productores.usuario_app where correo = 'helena.grosso@biocomerciosostenible.org';
