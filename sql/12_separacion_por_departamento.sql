-- =====================================================================
-- 12 · Separación de la información por departamento
-- ---------------------------------------------------------------------
-- Cada técnico y cada coordinador tienen UN departamento (usuario_app.cod_dpto)
-- y solo ven y editan la información de ese departamento:
--   productores (por su departamento de registro), predios (por su municipio),
--   lotes y elementos (por su predio) y veredas (por su municipio).
-- El administrador (rol 'admin', sin departamento) ve todo.
-- Las conexiones de escritorio (QGIS sig_editor, ArcGIS arcgis_lector y
-- Access lector_oficina) no cambian: son de uso del equipo SIG/administrativo.
-- =====================================================================

-- 1) Departamento del usuario ------------------------------------------------
alter table productores.usuario_app
  add column if not exists cod_dpto char(2) references productores.departamento (cod_dpto);
alter table productores.usuario_app drop constraint if exists ck_usuario_dpto;
alter table productores.usuario_app add constraint ck_usuario_dpto
  check (rol = 'admin' or cod_dpto is not null);

-- 2) Departamento del productor ---------------------------------------------
alter table productores.productor
  add column if not exists cod_dpto char(2) references productores.departamento (cod_dpto);
create index if not exists ix_productor_dpto on productores.productor (cod_dpto);
create index if not exists ix_vereda_mpio on productores.vereda (cod_mpio);

-- 3) Funciones de permiso -----------------------------------------------------
create or replace function productores.dpto_usuario()
returns text language sql stable security definer set search_path to ''
as $$
  select u.cod_dpto::text from productores.usuario_app u
   where u.user_id = (select auth.uid()) and u.activo
$$;

-- ¿El usuario activo puede ver el departamento indicado? (admin: todos)
create or replace function productores.ve_dpto(p_dpto text)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (select 1 from productores.usuario_app u
                  where u.user_id = (select auth.uid()) and u.activo
                    and (u.rol = 'admin' or u.cod_dpto::text = p_dpto))
$$;

-- ¿El usuario puede ver el predio? (para lotes y elementos)
create or replace function productores.ve_predio(p_predio uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select productores.ve_dpto(left(p.cod_mpio, 2))
                     from productores.predio p where p.id = p_predio), false)
$$;

revoke execute on function productores.dpto_usuario(), productores.ve_dpto(text), productores.ve_predio(uuid)
  from public, anon;
grant execute on function productores.dpto_usuario(), productores.ve_dpto(text), productores.ve_predio(uuid)
  to authenticated;

-- 4) Reglas automáticas --------------------------------------------------------
-- El productor toma el departamento del técnico que lo registra
create or replace function productores.tg_productor_dpto()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if new.cod_dpto is null then
    new.cod_dpto := productores.dpto_usuario();
  end if;
  if new.cod_dpto is null and tg_op = 'INSERT' then
    raise exception 'Indique el departamento del productor.';
  end if;
  return new;
end $$;
drop trigger if exists t05_productor_dpto on productores.productor;
create trigger t05_productor_dpto before insert or update of cod_dpto on productores.productor
  for each row execute function productores.tg_productor_dpto();

-- El predio debe quedar en el mismo departamento de su productor
create or replace function productores.tg_predio_dpto()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_dpto text;
begin
  select cod_dpto into v_dpto from productores.productor where id = new.productor_id;
  if v_dpto is not null and left(new.cod_mpio, 2) <> v_dpto then
    raise exception 'El predio debe estar en el mismo departamento del productor (%).',
      (select nombre from productores.departamento where cod_dpto = v_dpto);
  end if;
  return new;
end $$;
drop trigger if exists t05_predio_dpto on productores.predio;
create trigger t05_predio_dpto before insert or update of cod_mpio, productor_id on productores.predio
  for each row execute function productores.tg_predio_dpto();

revoke execute on function productores.tg_productor_dpto(), productores.tg_predio_dpto() from public, anon, authenticated;

-- 5) Políticas (usuarios del portal: rol authenticated) --------------------------
-- Productor
drop policy if exists productor_ver    on productores.productor;
drop policy if exists productor_crear  on productores.productor;
drop policy if exists productor_editar on productores.productor;
create policy productor_ver on productores.productor for select to authenticated
  using (productores.ve_dpto(cod_dpto));
create policy productor_crear on productores.productor for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_dpto(cod_dpto));
create policy productor_editar on productores.productor for update to authenticated
  using (productores.ve_dpto(cod_dpto) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_dpto(cod_dpto));

-- Predio
drop policy if exists predio_ver    on productores.predio;
drop policy if exists predio_crear  on productores.predio;
drop policy if exists predio_editar on productores.predio;
create policy predio_ver on productores.predio for select to authenticated
  using (productores.ve_dpto(left(cod_mpio, 2)));
create policy predio_crear on productores.predio for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_dpto(left(cod_mpio, 2)));
create policy predio_editar on productores.predio for update to authenticated
  using (productores.ve_dpto(left(cod_mpio, 2)) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_dpto(left(cod_mpio, 2)));

-- Lote
drop policy if exists lote_ver    on productores.lote;
drop policy if exists lote_crear  on productores.lote;
drop policy if exists lote_editar on productores.lote;
create policy lote_ver on productores.lote for select to authenticated
  using (productores.ve_predio(predio_id));
create policy lote_crear on productores.lote for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_predio(predio_id));
create policy lote_editar on productores.lote for update to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_predio(predio_id));

-- Elementos (líneas y puntos)
drop policy if exists elemento_linea_ver    on productores.elemento_linea;
drop policy if exists elemento_linea_crear  on productores.elemento_linea;
drop policy if exists elemento_linea_editar on productores.elemento_linea;
drop policy if exists elemento_linea_borrar on productores.elemento_linea;
create policy elemento_linea_ver on productores.elemento_linea for select to authenticated
  using (productores.ve_predio(predio_id));
create policy elemento_linea_crear on productores.elemento_linea for insert to authenticated
  with check (productores.usuario_activo() and (predio_id is null or productores.ve_predio(predio_id)));
create policy elemento_linea_editar on productores.elemento_linea for update to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_predio(predio_id));
create policy elemento_linea_borrar on productores.elemento_linea for delete to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()));

drop policy if exists elemento_punto_ver    on productores.elemento_punto;
drop policy if exists elemento_punto_crear  on productores.elemento_punto;
drop policy if exists elemento_punto_editar on productores.elemento_punto;
drop policy if exists elemento_punto_borrar on productores.elemento_punto;
create policy elemento_punto_ver on productores.elemento_punto for select to authenticated
  using (productores.ve_predio(predio_id));
create policy elemento_punto_crear on productores.elemento_punto for insert to authenticated
  with check (productores.usuario_activo() and (predio_id is null or productores.ve_predio(predio_id)));
create policy elemento_punto_editar on productores.elemento_punto for update to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()))
  with check (productores.ve_predio(predio_id));
create policy elemento_punto_borrar on productores.elemento_punto for delete to authenticated
  using (productores.ve_predio(predio_id) and (creado_por = (select auth.uid()) or productores.es_coordinador()));

-- Vereda
drop policy if exists vereda_leer   on productores.vereda;
drop policy if exists vereda_crear  on productores.vereda;
drop policy if exists vereda_editar on productores.vereda;
create policy vereda_leer on productores.vereda for select to authenticated
  using (productores.ve_dpto(left(cod_mpio, 2)));
create policy vereda_crear on productores.vereda for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_dpto(left(cod_mpio, 2))
              and (productores.es_coordinador() or (validada = false and origen = 'campo')));
create policy vereda_editar on productores.vereda for update to authenticated
  using (productores.es_coordinador() and productores.ve_dpto(left(cod_mpio, 2)))
  with check (productores.es_coordinador() and productores.ve_dpto(left(cod_mpio, 2)));

-- Usuarios: cada quien se ve a sí mismo; el coordinador ve los de su departamento; el admin, todos
drop policy if exists usuario_ver on productores.usuario_app;
create policy usuario_ver on productores.usuario_app for select to authenticated
  using (user_id = (select auth.uid())
         or (productores.es_coordinador() and productores.ve_dpto(cod_dpto)));
