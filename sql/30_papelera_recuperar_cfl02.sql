-- =========================================================================
--  30 · Papelera de predios y recuperación del predio 18001-0002 (CFL 02)
--
--   a) papelera: antes de borrar un predio, lote, elemento, acción del plan,
--      ficha o plancha se guarda una copia completa (quién y cuándo).
--      La ven el administrador y la coordinación.
--   b) recuperar_predio('18001-0002'): el administrador devuelve un predio
--      borrado con sus lotes, elementos, plan, ficha, plancha y su encuesta.
--   c) El predio 18001-0002 «El Mesón» (Alberto Llanos), borrado por error el
--      7-nov-2026, se vuelve a crear con su código desde su encuesta Kobo y se
--      le devuelve la plancha CFL 02.
-- =========================================================================

-- a) Papelera ----------------------------------------------------------------------
create table productores.papelera (
  id          bigserial primary key,
  tabla       text not null,
  registro_id uuid,
  cod         text,
  datos       jsonb not null,
  borrado_por uuid default auth.uid(),
  borrado_en  timestamptz not null default now()
);
create index ix_papelera_cod on productores.papelera (tabla, cod);
alter table productores.papelera enable row level security;
create policy papelera_ver on productores.papelera for select to authenticated
  using (productores.es_admin() or productores.es_coordinador());
revoke all on productores.papelera from public, anon;
grant select on productores.papelera to authenticated;

create or replace function productores.tg_papelera()
 returns trigger language plpgsql security definer set search_path to '' as $$
declare j jsonb := to_jsonb(old);
begin
  insert into productores.papelera (tabla, registro_id, cod, datos)
  values (tg_table_name, (j->>'id')::uuid,
          coalesce(j->>'cod_predio', j->>'cod_lote', j->>'nombre'), j);
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array['predio', 'lote', 'elemento_linea', 'elemento_punto', 'plan_accion', 'ficha_predial', 'plancha'] loop
    execute format('create trigger t99_%1$s_papelera before delete on productores.%1$I
                    for each row execute function productores.tg_papelera()', t);
  end loop;
end $$;

-- b) Recuperar un predio borrado -------------------------------------------------------
create or replace function productores.insertar_desde_json(p_tabla text, p_datos jsonb)
 returns void language plpgsql security definer set search_path to '' as $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'productores' and table_name = p_tabla and is_generated = 'NEVER';
  execute format('insert into productores.%1$I (%2$s) select %2$s from jsonb_populate_record(null::productores.%1$I, $1)', p_tabla, cols)
    using p_datos;
end $$;
revoke all on function productores.insertar_desde_json(text, jsonb) from public, anon, authenticated;

create or replace function productores.recuperar_predio(p_cod text)
 returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; v_en timestamptz; v_pred jsonb; r record; cuenta jsonb := '{}'; t text; n int;
begin
  if not productores.es_admin() and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Solo el administrador puede recuperar predios.';
  end if;
  if exists (select 1 from productores.predio where cod_predio = p_cod) then
    raise exception 'El predio % ya existe.', p_cod;
  end if;
  select registro_id, borrado_en, datos into v_id, v_en, v_pred
    from productores.papelera where tabla = 'predio' and cod = p_cod order by borrado_en desc limit 1;
  if v_id is null then raise exception 'El predio % no está en la papelera.', p_cod; end if;

  perform productores.insertar_desde_json('predio', v_pred);
  foreach t in array array['lote', 'elemento_linea', 'elemento_punto', 'plan_accion', 'ficha_predial', 'plancha'] loop
    n := 0;
    for r in select datos from productores.papelera
              where tabla = t and borrado_en = v_en and datos->>'predio_id' = v_id::text order by id loop
      perform productores.insertar_desde_json(t, r.datos);
      n := n + 1;
    end loop;
    cuenta := cuenta || jsonb_build_object(t, n);
  end loop;
  -- La encuesta Kobo quedó sin predio al borrarlo: se vuelve a ligar
  update productores.caracterizacion c set predio_id = v_id
   where c.predio_id is null and c.productor_id = (v_pred->>'productor_id')::uuid
     and upper(trim(c.datos->>'id_predio')) = upper(v_pred->>'cod_humboldt');
  get diagnostics n = row_count;
  return jsonb_build_object('predio', p_cod, 'encuestas', n) || cuenta;
end $$;
revoke all on function productores.recuperar_predio(text) from public, anon;
grant execute on function productores.recuperar_predio(text) to authenticated;

-- c) Predio 18001-0002 «El Mesón» ------------------------------------------------------
-- Se crea con su código original y los datos de su encuesta (cargada del CSV, sin _uuid de Kobo);
-- el punto es el de la plancha CFL 02, que se hizo con la ubicación original.
insert into productores.predio (productor_id, nombre, cod_mpio, cod_predio, cod_humboldt, vereda_id, tenencia_id,
                                area_declarada_ha, punto, punto_visita)
select pr.id, coalesce(nullif(trim(c.datos->>'nombre_predio'), ''), 'El meson'), '18001', '18001-0002', 'CFL 02',
       (select v.id from productores.vereda v where v.cod_mpio = '18001'
          and productores.f_normalizar(v.nombre) = productores.f_normalizar(c.datos->>'vereda_declarada') limit 1),
       (select t.id from productores.tenencia t where lower(t.codigo) = lower(c.datos->>'tenencia') or lower(t.nombre) = lower(c.datos->>'tenencia') limit 1),
       nullif(c.datos->>'area_declarada_ha', '')::numeric,
       extensions.st_setsrid(extensions.st_makepoint((-75.76157618 + -75.74362097) / 2, (1.60615137 + 1.61621467) / 2), 4326),
       extensions.st_setsrid(extensions.st_makepoint((-75.76157618 + -75.74362097) / 2, (1.60615137 + 1.61621467) / 2), 4326)
  from productores.productor pr
  join productores.caracterizacion c on c.id = '8e8e8021-a4ae-41ed-9c10-ab2b04e52761'
 where pr.id = '5b2392e0-5217-49b2-95be-166a460d7963'
   and not exists (select 1 from productores.predio where cod_predio = '18001-0002');

update productores.caracterizacion c
   set predio_id = p.id, productor_id = p.productor_id
  from productores.predio p
 where c.id = '8e8e8021-a4ae-41ed-9c10-ab2b04e52761' and p.cod_predio = '18001-0002';

insert into productores.plancha (predio_id, etiqueta, sur, oeste, norte, este, estado)
select p.id, 'CFL 02', 1.60615137, -75.76157618, 1.61621467, -75.74362097, 'ok'
  from productores.predio p where p.cod_predio = '18001-0002'
on conflict (predio_id) do nothing;
