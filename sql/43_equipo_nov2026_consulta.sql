-- =========================================================================
--  43 · Equipo de noviembre de 2026 y rol de solo consulta
--
--   a) Nuevo rol «consulta»: ve los datos de su departamento (o de todos si no
--      tiene departamento) pero no puede crear, cambiar ni borrar nada.
--      El bloqueo es un disparador en todas las tablas de trabajo, así cubre
--      tanto la edición directa como las funciones del portal. Solo puede
--      tocar su propia fila de usuario_app (cambio de clave, aviso Ley 1581).
--   b) Técnicos del Meta, cambios de correo y alcance de los transversales.
--      Las cuentas nuevas se crean con clave aleatoria; el administrador pone
--      la clave inicial con productores.fijar_clave_inicial(...) en el editor
--      SQL. La clave no queda escrita en el repositorio.
-- =========================================================================

-- a) Rol de consulta ------------------------------------------------------------------
alter table productores.usuario_app drop constraint usuario_app_rol_check;
alter table productores.usuario_app add constraint usuario_app_rol_check
  check (rol in ('tecnico', 'coordinador', 'admin', 'consulta'));
alter table productores.usuario_app drop constraint ck_usuario_dpto;
alter table productores.usuario_app add constraint ck_usuario_dpto
  check (rol in ('admin', 'coordinador', 'consulta') or cod_dpto is not null);
alter table productores.usuario_invitado drop constraint usuario_invitado_rol_check;
alter table productores.usuario_invitado add constraint usuario_invitado_rol_check
  check (rol in ('tecnico', 'coordinador', 'admin', 'consulta'));

create or replace function productores.es_consulta()
 returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from productores.usuario_app
                  where user_id = (select auth.uid()) and activo and rol = 'consulta')
$$;
grant execute on function productores.es_consulta() to authenticated;

-- Consulta ve como un coordinador: todo (sin departamento) o su departamento
create or replace function productores.ve_dpto(p_dpto text)
 returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from productores.usuario_app u where u.user_id = (select auth.uid()) and u.activo
    and (u.rol = 'admin' or (u.rol in ('coordinador', 'consulta') and u.cod_dpto is null) or u.cod_dpto::text = p_dpto)) $$;

create or replace function productores.ve_mpio(p_mpio text)
 returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from productores.usuario_app u where u.user_id = (select auth.uid()) and u.activo
    and (u.rol = 'admin' or (u.rol in ('coordinador', 'consulta') and (u.cod_dpto is null or u.cod_dpto::text = left(p_mpio, 2)))
         or exists (select 1 from productores.usuario_municipio um where um.user_id = u.user_id and um.cod_mpio = p_mpio))) $$;

-- Bloqueo de escritura para consulta en todas las tablas de trabajo
create or replace function productores.bloquear_consulta()
 returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if productores.es_consulta() then
    raise exception 'Su usuario es solo de consulta: no puede crear, cambiar ni borrar información.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'productores' and c.relkind = 'r' and c.relname <> 'usuario_app' loop
    execute format('drop trigger if exists t_bloquear_consulta on productores.%I', t);
    execute format('create trigger t_bloquear_consulta before insert or update or delete on productores.%I
                    for each row execute function productores.bloquear_consulta()', t);
  end loop;
end $$;

-- b) Equipo -----------------------------------------------------------------------------
-- Cambio de correo (cuentas que aún no habían entrado)
do $$
declare r record;
begin
  for r in select * from (values ('pablocesar1981@gmail.com', 'pablopossobiocomercio@gmail.com'),
                                 ('angeldavid2020.loaiza@hotmail.com', 'rosa.biocomercio2026@gmail.com')) v(viejo, nuevo) loop
    update auth.users set email = r.nuevo, updated_at = now() where lower(email) = r.viejo;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', r.nuevo), updated_at = now()
     where provider = 'email' and lower(identity_data->>'email') = r.viejo;
    update productores.usuario_app set correo = r.nuevo where lower(correo) = r.viejo;
  end loop;
end $$;

-- Transversales con cuenta: Luisa pasa a coordinar solo el Meta
update productores.usuario_app set rol = 'coordinador', cod_dpto = '50'
 where correo = 'lflopez@biocomerciosostenible.org';

-- Cuentas nuevas
insert into productores.usuario_invitado (correo, nombre, rol, cod_dpto, municipios) values
  ('navarrohmaria@gmail.com',                    'María de los Ángeles',       'tecnico',     '50', '{50325}'),
  ('luisferlaverde13@gmail.com',                 'Luis Fernando Romero',       'tecnico',     '50', '{50577}'),
  ('nolbertocc31@gmail.com',                     'Nolberto',                   'tecnico',     '50', '{50450}'),
  ('felipeforestal1@gmail.com',                  'Felipe Torres',              'tecnico',     '50', '{50590}'),
  ('alarcos@biocomerciosostenible.org',          'Adriana Lucía Arcos Dorado', 'coordinador', null, '{}'),
  ('faochoa@biocomerciosostenible.org',          'Fredy Ochoa',                'consulta',    '18', '{}'),
  ('yolaida.narvaez@biocomerciosostenible.org',  'Yolaida Narváez',            'consulta',    null, '{}')
on conflict (correo) do update set nombre = excluded.nombre, rol = excluded.rol, cod_dpto = excluded.cod_dpto,
                                   municipios = excluded.municipios;

do $$
declare c text; v uuid;
begin
  foreach c in array array['navarrohmaria@gmail.com', 'luisferlaverde13@gmail.com', 'nolbertocc31@gmail.com',
    'felipeforestal1@gmail.com', 'alarcos@biocomerciosostenible.org', 'faochoa@biocomerciosostenible.org',
    'yolaida.narvaez@biocomerciosostenible.org'] loop
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
