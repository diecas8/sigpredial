-- 52 · Usuario nuevo de consulta (23-11-2026)
--   Jorge Lotero: seguimiento del Meta, solo consulta (ve y descarga el Excel, no edita).
--   Recibe la misma clave genérica inicial que las cuentas que aún no la han cambiado
--   (se copia la clave cifrada de una de ellas; la clave no queda escrita aquí) y el portal
--   le pide cambiarla al entrar.
--   También se completa el nombre de Luisa Fernanda López Osorio.
insert into productores.usuario_invitado (correo, nombre, rol, cod_dpto, municipios)
values ('jorgelotero@hotmail.com', 'Jorge Lotero', 'consulta', '50', '{}')
on conflict (correo) do update set nombre = excluded.nombre, rol = excluded.rol, cod_dpto = excluded.cod_dpto,
                                   municipios = excluded.municipios;

do $$
declare c text := 'jorgelotero@hotmail.com'; v uuid; h text;
begin
  select u.encrypted_password into h from auth.users u join productores.usuario_app a on a.user_id = u.id
   where a.debe_cambiar_clave and lower(u.email) = 'faochoa@biocomerciosostenible.org';
  if exists (select 1 from auth.users where lower(email) = c) then
    perform productores.activar_invitado((select id from auth.users where lower(email) = c), c);
    return;
  end if;
  v := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', c,
          coalesce(h, extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (v::text, v, jsonb_build_object('sub', v::text, 'email', c, 'email_verified', true, 'phone_verified', false),
          'email', now(), now());
  perform productores.activar_invitado(v, c);
end $$;

update productores.usuario_app set nombre = 'Luisa Fernanda López Osorio'
 where correo = 'lflopez@biocomerciosostenible.org';
