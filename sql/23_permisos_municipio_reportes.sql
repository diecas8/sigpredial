-- =========================================================================
--  23 · Cada técnico ve solo sus municipios + reportes en Excel
--
--   a) usuario_municipio: municipios asignados a cada técnico.
--   b) ve_mpio(): administrador → todo; coordinador sin departamento →
--      todo; coordinador con departamento → su departamento; técnico →
--      solo sus municipios asignados.
--   c) Predios, productores, caracterizaciones y todo lo que cuelga del
--      predio (lotes, elementos, ficha, plan de acción, PDF) pasan a ve_mpio.
--      El productor lo ve el técnico si tiene un predio en sus municipios o
--      si él mismo lo registró (aún sin predio).
--   d) Tablero: mismo filtro; el técnico de cada predio es el asignado al
--      municipio.
--   e) usuario_invitado: usuarios autorizados antes de crear su cuenta; al
--      crear la cuenta en Supabase (Authentication → Invite) quedan activos
--      con su rol y municipios.
--   f) Vistas de reportes (rep_*), con los permisos de quien las consulta.
--  Access, QGIS y ArcGIS (lector_oficina, arcgis_lector, sig_editor) siguen
--  viendo todo, como hoy.
-- =========================================================================

-- a) Municipios asignados ----------------------------------------------------
create table productores.usuario_municipio (
  user_id     uuid not null references productores.usuario_app (user_id) on delete cascade,
  cod_mpio    char(5) not null references productores.municipio (cod_mpio),
  creado_por  uuid default productores.usuario_actual(),
  creado_en   timestamptz not null default now(),
  editado_por uuid,
  editado_en  timestamptz,
  primary key (user_id, cod_mpio)
);
create index ix_usuario_municipio_mpio on productores.usuario_municipio (cod_mpio);
create trigger t20_usuario_municipio_audit before update on productores.usuario_municipio
  for each row execute function productores.tg_auditoria();
alter table productores.usuario_municipio enable row level security;
create policy usuario_municipio_ver on productores.usuario_municipio for select to authenticated
  using (user_id = (select auth.uid()) or productores.es_coordinador());
create policy usuario_municipio_admin on productores.usuario_municipio for all to authenticated
  using (productores.es_admin()) with check (productores.es_admin());
revoke all on productores.usuario_municipio from public, anon;
grant select, insert, update, delete on productores.usuario_municipio to authenticated;
grant select on productores.usuario_municipio to arcgis_lector, sig_editor;

-- El coordinador puede no tener departamento: es coordinador de todos
alter table productores.usuario_app drop constraint ck_usuario_dpto;
alter table productores.usuario_app add constraint ck_usuario_dpto
  check (rol in ('admin', 'coordinador') or cod_dpto is not null);

-- b) Funciones de permiso ----------------------------------------------------
-- Coordinador sin departamento = coordinador de todo
create or replace function productores.ve_dpto(p_dpto text)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from productores.usuario_app u
                  where u.user_id = (select auth.uid()) and u.activo
                    and (u.rol = 'admin' or (u.rol = 'coordinador' and u.cod_dpto is null)
                         or u.cod_dpto::text = p_dpto))
$$;

create or replace function productores.ve_mpio(p_mpio text)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from productores.usuario_app u
                  where u.user_id = (select auth.uid()) and u.activo
                    and (u.rol = 'admin'
                         or (u.rol = 'coordinador' and (u.cod_dpto is null or u.cod_dpto::text = left(p_mpio, 2)))
                         or exists (select 1 from productores.usuario_municipio um
                                     where um.user_id = u.user_id and um.cod_mpio = p_mpio)))
$$;

create or replace function productores.ve_predio(p_predio uuid)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select productores.ve_mpio(p.cod_mpio) from productores.predio p where p.id = p_predio), false)
$$;

-- Productor: coordinador/administrador por departamento; técnico si tiene un predio
-- en sus municipios o si él mismo lo registró
create or replace function productores.ve_productor(p_id uuid)
 returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from productores.productor pr
                  where pr.id = p_id and productores.ve_dpto(pr.cod_dpto::text)
                    and (productores.es_coordinador()
                         or pr.creado_por = (select auth.uid())
                         or exists (select 1 from productores.predio p
                                     where p.productor_id = pr.id and productores.ve_mpio(p.cod_mpio))))
$$;

-- Municipios que puede trabajar el usuario (para el portal)
create or replace function productores.mis_municipios()
 returns setof text language sql stable security definer set search_path to ''
as $$
  select m.cod_mpio::text from productores.municipio m where productores.ve_mpio(m.cod_mpio)
$$;

revoke all on function productores.ve_mpio(text), productores.ve_productor(uuid), productores.mis_municipios() from public, anon;
grant execute on function productores.ve_mpio(text), productores.ve_productor(uuid), productores.mis_municipios() to authenticated;

-- c) Políticas ----------------------------------------------------------------
drop policy predio_ver on productores.predio;
drop policy predio_crear on productores.predio;
drop policy predio_editar on productores.predio;
drop policy predio_borrar on productores.predio;
create policy predio_ver on productores.predio for select to authenticated
  using (productores.ve_mpio(cod_mpio));
create policy predio_crear on productores.predio for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_mpio(cod_mpio));
create policy predio_editar on productores.predio for update to authenticated
  using (productores.ve_mpio(cod_mpio) and (creado_por = (select auth.uid()) or productores.es_coordinador()
                                            or creado_por is null))
  with check (productores.ve_mpio(cod_mpio));
create policy predio_borrar on productores.predio for delete to authenticated
  using (productores.usuario_activo() and productores.ve_mpio(cod_mpio));

drop policy productor_ver on productores.productor;
drop policy productor_editar on productores.productor;
create policy productor_ver on productores.productor for select to authenticated
  using (productores.ve_productor(id));
create policy productor_editar on productores.productor for update to authenticated
  using (productores.ve_productor(id) and (creado_por = (select auth.uid()) or productores.es_coordinador()
                                          or creado_por is null))
  with check (productores.ve_dpto(cod_dpto::text));

drop policy caracterizacion_ver on productores.caracterizacion;
create policy caracterizacion_ver on productores.caracterizacion for select to authenticated
  using (case when predio_id is not null then productores.ve_predio(predio_id)
              else productores.es_coordinador() and productores.ve_dpto(cod_dpto::text) end);

-- Veredas nuevas solo en municipios propios
drop policy vereda_crear on productores.vereda;
create policy vereda_crear on productores.vereda for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_mpio(cod_mpio)
              and (productores.es_coordinador() or (validada = false and origen = 'campo')));

-- d) Tablero: mismo filtro y técnico asignado al municipio --------------------
do $$
declare def text; nuevo text;
begin
  def := pg_get_functiondef('productores.tablero(text)'::regprocedure);
  nuevo := replace(def, 'where productores.ve_dpto(left(p.cod_mpio, 2))', 'where productores.ve_mpio(p.cod_mpio)');
  nuevo := replace(nuevo, 'coalesce(u.nombre,',
    'coalesce((select string_agg(ua.nombre, '', '' order by ua.nombre) from productores.usuario_municipio um
                       join productores.usuario_app ua on ua.user_id = um.user_id
                      where um.cod_mpio = p.cod_mpio and ua.rol = ''tecnico'' and ua.activo),
                    u.nombre,');
  if nuevo = def or position('ve_mpio' in nuevo) = 0 or position('usuario_municipio' in nuevo) = 0 then
    raise exception 'tablero: no se pudo ajustar';
  end if;
  execute nuevo;
end $$;

-- e) Usuarios autorizados antes de crear su cuenta ------------------------------
create table productores.usuario_invitado (
  correo      text primary key check (correo = lower(trim(correo))),
  nombre      text not null,
  rol         text not null check (rol in ('tecnico', 'coordinador', 'admin')),
  cod_dpto    char(2) references productores.departamento (cod_dpto),
  municipios  text[] not null default '{}',
  creado_por  uuid default productores.usuario_actual(),
  creado_en   timestamptz not null default now(),
  editado_por uuid,
  editado_en  timestamptz
);
create trigger t20_usuario_invitado_audit before update on productores.usuario_invitado
  for each row execute function productores.tg_auditoria();
alter table productores.usuario_invitado enable row level security;
create policy usuario_invitado_admin on productores.usuario_invitado for all to authenticated
  using (productores.es_admin()) with check (productores.es_admin());
revoke all on productores.usuario_invitado from public, anon;
grant select, insert, update, delete on productores.usuario_invitado to authenticated;

-- Activa al usuario invitado cuando se crea su cuenta (o de inmediato si ya existe)
create or replace function productores.activar_invitado(p_user uuid, p_correo text)
 returns void language plpgsql security definer set search_path to ''
as $$
declare i productores.usuario_invitado%rowtype;
begin
  select * into i from productores.usuario_invitado where correo = lower(trim(p_correo));
  if not found then return; end if;
  insert into productores.usuario_app (user_id, nombre, correo, rol, cod_dpto, activo)
  values (p_user, i.nombre, i.correo, i.rol, i.cod_dpto, true)
  on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol,
                                      cod_dpto = excluded.cod_dpto, activo = true;
  insert into productores.usuario_municipio (user_id, cod_mpio)
  select p_user, m from unnest(i.municipios) m on conflict do nothing;
  delete from productores.usuario_invitado where correo = i.correo;
end $$;
revoke all on function productores.activar_invitado(uuid, text) from public, anon, authenticated;

create or replace function productores.tg_auth_usuario_nuevo()
 returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  perform productores.activar_invitado(new.id, new.email);
  return new;
end $$;
revoke all on function productores.tg_auth_usuario_nuevo() from public, anon, authenticated;
create trigger t_sigpredial_invitado after insert on auth.users
  for each row execute function productores.tg_auth_usuario_nuevo();

-- Asignar municipios a un usuario ya registrado (solo administrador)
create or replace function productores.asignar_municipios(p_correo text, p_municipios text[])
 returns integer language plpgsql security definer set search_path to ''
as $$
declare v uuid; n integer;
begin
  if not productores.es_admin() and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Solo el administrador asigna municipios.';
  end if;
  select user_id into v from productores.usuario_app where lower(correo) = lower(trim(p_correo));
  if v is null then raise exception 'No existe el usuario %', p_correo; end if;
  delete from productores.usuario_municipio where user_id = v and cod_mpio <> all (p_municipios);
  insert into productores.usuario_municipio (user_id, cod_mpio)
  select v, m from unnest(p_municipios) m on conflict do nothing;
  select count(*) into n from productores.usuario_municipio where user_id = v;
  return n;
end $$;
revoke all on function productores.asignar_municipios(text, text[]) from public, anon;
grant execute on function productores.asignar_municipios(text, text[]) to authenticated;

-- lflopez: coordinador de todos los departamentos (el nombre se corrige en usuario_app)
insert into productores.usuario_invitado (correo, nombre, rol, cod_dpto)
values ('lflopez@biocomerciosostenible.org', 'lflopez', 'coordinador', null)
on conflict (correo) do nothing;
select productores.activar_invitado(id, email) from auth.users where lower(email) = 'lflopez@biocomerciosostenible.org';

-- f) Vistas de reportes (con los permisos de quien consulta) ----------------------
create or replace view productores.rep_predios with (security_invoker = true) as
select d.nombre as departamento, m.nombre as municipio, v.nombre as vereda,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap, t.nombre as tenencia,
       p.area_declarada_ha::double precision as area_declarada_ha, p.area_sig_ha::double precision as area_sig_ha,
       case when p.geom is null then 'Pendiente de delimitar' else 'Delimitado' end as estado_limite,
       (select count(*) from productores.lote l where l.predio_id = p.id and l.escenario = 'actual')::integer as lotes
  from productores.predio p
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id
  left join productores.tenencia t on t.id = p.tenencia_id;

-- Lotes con su ubicación: punto interior del lote en grados y en Origen Nacional (9377)
create or replace view productores.rep_lotes with (security_invoker = true) as
select l.escenario, d.nombre as departamento, m.nombre as municipio, v.nombre as vereda,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap, l.cod_lote,
       c.nombre as uso, coalesce(c.tipo, 'Sin clasificar') as tipo_cobertura, z.nombre as zona_pps, l.cobertura_clc,
       l.sistema, l.estado, l.variedad,
       l.area_sig_ha::double precision as area_sig_ha, l.area_declarada_ha::double precision as area_declarada_ha,
       round(ST_Y(pt)::numeric, 6)::double precision as latitud, round(ST_X(pt)::numeric, 6)::double precision as longitud,
       round(ST_X(ST_Transform(pt, 9377))::numeric, 1)::double precision as este_9377,
       round(ST_Y(ST_Transform(pt, 9377))::numeric, 1)::double precision as norte_9377,
       l.observaciones
  from productores.lote l
  join productores.predio p on p.id = l.predio_id
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id
  left join productores.cultivo c on c.id = l.cultivo_id
  left join productores.zona_pps z on z.id = l.zona_pps_id
  cross join lateral (select case when l.geom is null then null else ST_PointOnSurface(l.geom) end as pt) g;

-- Finca soñada por predio: prospectiva y hectáreas por zona (actual frente a propuesta)
create or replace view productores.rep_finca_sonada with (security_invoker = true) as
select d.nombre as departamento, m.nombre as municipio, v.nombre as vereda,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap,
       p.area_sig_ha::double precision as area_predio_ha,
       p.vision_familia, p.fecha_taller, p.participantes_hombres, p.participantes_mujeres, p.participantes_jovenes,
       p.puntaje_seleccion::double precision as puntaje_seleccion,
       z.lotes_propuestos, z.ha_propuesta, z.ha_preservacion, z.ha_restauracion, z.ha_recuperacion,
       z.ha_produccion_sostenible, z.ha_sin_zona,
       (select count(*) from productores.plan_accion a where a.predio_id = p.id)::integer as acciones,
       (select count(*) from productores.plan_accion a where a.predio_id = p.id and a.estado = 'concertado')::integer as acciones_concertadas
  from productores.predio p
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id
  cross join lateral (
    select count(*)::integer as lotes_propuestos,
           round(coalesce(sum(l.area_sig_ha), 0), 4)::double precision as ha_propuesta,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'preservacion'), 0), 4)::double precision as ha_preservacion,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'restauracion'), 0), 4)::double precision as ha_restauracion,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'recuperacion'), 0), 4)::double precision as ha_recuperacion,
           round(coalesce(sum(l.area_sig_ha) filter (where zz.codigo = 'produccion_sostenible'), 0), 4)::double precision as ha_produccion_sostenible,
           round(coalesce(sum(l.area_sig_ha) filter (where l.zona_pps_id is null), 0), 4)::double precision as ha_sin_zona
      from productores.lote l left join productores.zona_pps zz on zz.id = l.zona_pps_id
     where l.predio_id = p.id and l.escenario = 'propuesto') z
 where z.lotes_propuestos > 0 or p.vision_familia is not null or p.fecha_taller is not null
    or exists (select 1 from productores.plan_accion a where a.predio_id = p.id);

create or replace view productores.rep_plan_accion with (security_invoker = true) as
select d.nombre as departamento, m.nombre as municipio, v.nombre as vereda,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as propietario,
       p.nombre as finca, p.cod_predio, p.cod_humboldt as codigo_zap,
       ca.tipo, ca.nombre as accion, l.cod_lote as lote, a.cantidad::double precision as cantidad, a.unidad,
       a.plazo, a.prioridad, a.estado,
       (select string_agg(ap.nombre, ', ' order by ap.nombre) from productores.catalogo_apoyo ap where ap.codigo = any (a.apoyos)) as apoyos,
       a.responsable, a.observaciones
  from productores.plan_accion a
  join productores.catalogo_accion ca on ca.id = a.accion_id
  join productores.predio p on p.id = a.predio_id
  join productores.productor pr on pr.id = p.productor_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  left join productores.vereda v on v.id = p.vereda_id
  left join productores.lote l on l.id = a.lote_id;

revoke all on productores.rep_predios, productores.rep_lotes, productores.rep_finca_sonada, productores.rep_plan_accion from public, anon;
grant select on productores.rep_predios, productores.rep_lotes, productores.rep_finca_sonada, productores.rep_plan_accion
  to authenticated, arcgis_lector, sig_editor;
