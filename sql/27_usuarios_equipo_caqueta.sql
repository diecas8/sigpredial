-- =========================================================================
--  27 · Usuarios del equipo Caquetá y cambio de clave al primer ingreso
--
--   a) usuario_app.debe_cambiar_clave: el portal obliga a cambiar la clave en
--      el primer ingreso. Toda cuenta activada por invitación la tiene.
--   b) clave_cambiada(): el portal la llama cuando el usuario puso su clave.
--   c) fijar_clave_inicial(clave): el ADMINISTRADOR la ejecuta en el editor SQL
--      de Supabase para poner la clave genérica a las cuentas que aún deben
--      cambiarla. La clave nunca queda escrita en el repositorio ni en el chat.
--   d) Técnicos con su municipio y la coordinadora (ve todo). Las cuentas se
--      crean con una clave aleatoria que nadie conoce hasta ejecutar (c).
-- =========================================================================

-- a) ------------------------------------------------------------------------------------
alter table productores.usuario_app add column debe_cambiar_clave boolean not null default false;

create or replace function productores.activar_invitado(p_user uuid, p_correo text)
 returns void language plpgsql security definer set search_path to '' as $$
declare i productores.usuario_invitado%rowtype;
begin
  select * into i from productores.usuario_invitado where correo = lower(trim(p_correo));
  if not found then return; end if;
  insert into productores.usuario_app (user_id, nombre, correo, rol, cod_dpto, activo, debe_cambiar_clave)
  values (p_user, i.nombre, i.correo, i.rol, i.cod_dpto, true, true)
  on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol, cod_dpto = excluded.cod_dpto,
                                      activo = true, debe_cambiar_clave = true;
  insert into productores.usuario_municipio (user_id, cod_mpio)
  select p_user, m from unnest(i.municipios) m on conflict do nothing;
  delete from productores.usuario_invitado where correo = i.correo;
end $$;
revoke all on function productores.activar_invitado(uuid, text) from public, anon, authenticated;

-- b) ------------------------------------------------------------------------------------
create or replace function productores.clave_cambiada()
 returns void language sql security definer set search_path to '' as $$
  update productores.usuario_app set debe_cambiar_clave = false where user_id = (select auth.uid())
$$;
revoke all on function productores.clave_cambiada() from public, anon;
grant execute on function productores.clave_cambiada() to authenticated;

-- c) ------------------------------------------------------------------------------------
create or replace function productores.fijar_clave_inicial(p_clave text)
 returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  if not productores.es_admin() and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Solo el administrador fija la clave inicial.';
  end if;
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La clave debe tener al menos 8 caracteres.'; end if;
  update auth.users u set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf')), updated_at = now()
    from productores.usuario_app a
   where a.user_id = u.id and a.debe_cambiar_clave and a.activo;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function productores.fijar_clave_inicial(text) from public, anon, authenticated;

-- d) Equipo Caquetá ------------------------------------------------------------------------
insert into productores.usuario_invitado (correo, nombre, rol, cod_dpto, municipios) values
  ('jd89ecov@gmail.com',                'Jesús David Campillo Velasco',   'tecnico', '18', '{18001}'),
  ('ing.dennys@gmail.com',              'Dennys Hasbleidy Silva Agudelo', 'tecnico', '18', '{18479}'),
  ('deriany1995@gmail.com',             'Deriany Janeth Buendía Polania', 'tecnico', '18', '{18094}'),
  ('fajardojulian48@gmail.com',         'Rafael Julián Fajardo Delgado',  'tecnico', '18', '{18610}'),
  ('cristiandiaz2092@gmail.com',        'Cristhian Eduardo Díaz Andrade', 'tecnico', '18', '{18460}'),
  ('jpurazan2001@gmail.com',            'Pedro José Joven Urazan',        'tecnico', '18', '{18256}'),
  ('angeldavid2020.loaiza@hotmail.com', 'Rosalba Loaiza Aldana',          'tecnico', '18', '{18785}'),
  ('pablocesar1981@gmail.com',          'Pablo César Posso Cedeño',       'tecnico', '18', '{18753}')
on conflict (correo) do update set nombre = excluded.nombre, rol = excluded.rol, cod_dpto = excluded.cod_dpto,
                                   municipios = excluded.municipios;
update productores.usuario_invitado set nombre = 'Luisa Fernanda López'
 where correo = 'lflopez@biocomerciosostenible.org';

-- Cuentas de acceso (usuario = correo). El disparador las activa con su rol y municipio.
do $$
declare c text; v uuid;
begin
  foreach c in array array['jd89ecov@gmail.com', 'ing.dennys@gmail.com', 'deriany1995@gmail.com',
    'fajardojulian48@gmail.com', 'cristiandiaz2092@gmail.com', 'jpurazan2001@gmail.com',
    'angeldavid2020.loaiza@hotmail.com', 'pablocesar1981@gmail.com', 'lflopez@biocomerciosostenible.org'] loop
    if exists (select 1 from auth.users where lower(email) = c) then
      perform productores.activar_invitado((select id from auth.users where lower(email) = c), c);
      continue;
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
  end loop;
end $$;
