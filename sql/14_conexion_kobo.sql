-- =====================================================================
-- 14 · Conexión con KoboToolbox
-- ---------------------------------------------------------------------
-- Cada encuesta de caracterización que llega de Kobo (servicio REST →
-- Edge Function «kobo-recibir») se guarda completa en
-- productores.caracterizacion y se procesa:
--   · productor: se crea o actualiza por número de documento (en el
--     departamento del municipio de la encuesta);
--   · vereda: por su código; si es «Otra», se crea como vereda de campo
--     POR VALIDAR (o se usa la que ya exista con ese nombre);
--   · predio: se crea o actualiza por el código del Instituto Humboldt
--     (cod_humboldt), con el punto GPS de la visita. Si aún no tiene
--     límite queda «Pendiente de delimitar» en el portal.
-- Si algo falla (municipio desconocido, productor de otro departamento…)
-- la encuesta queda guardada con estado «error» y el motivo, para
-- corregirla y reprocesarla.
-- =====================================================================

-- Configuración privada (fuera del API) ---------------------------------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create table if not exists privado.config (clave text primary key, valor text not null);
insert into privado.config (clave, valor)
values ('kobo_clave', encode(extensions.gen_random_bytes(18), 'hex'))
on conflict (clave) do nothing;

-- Predio: código Humboldt y punto de la visita ---------------------------
alter table productores.predio
  add column if not exists cod_humboldt    text,
  add column if not exists punto_visita    geometry(Point, 4326),
  add column if not exists gps_precision_m numeric;
create unique index if not exists uq_predio_cod_humboldt
  on productores.predio (cod_humboldt) where cod_humboldt is not null;

-- Usuario de Kobo de cada técnico (para saber quién registró cada predio)
alter table productores.usuario_app add column if not exists kobo_usuario text;
create unique index if not exists uq_usuario_kobo on productores.usuario_app (lower(kobo_usuario))
  where kobo_usuario is not null;

-- Caracterizaciones -------------------------------------------------------
create table if not exists productores.caracterizacion (
  id            uuid primary key default gen_random_uuid(),
  kobo_uuid     text not null unique,
  kobo_id       bigint,
  formulario    text,
  proyecto      text,
  cod_dpto      char(2) references productores.departamento (cod_dpto),
  productor_id  uuid references productores.productor (id) on delete set null,
  predio_id     uuid references productores.predio (id) on delete set null,
  fecha_visita  date,
  tecnico       text,
  kobo_usuario  text,
  estado        text not null default 'recibida'
                check (estado in ('recibida', 'procesada', 'sin_consentimiento', 'error')),
  error         text,
  datos         jsonb not null,
  crudo         jsonb,
  recibido_en   timestamptz not null default now(),
  procesado_en  timestamptz
);
create index if not exists ix_carac_predio    on productores.caracterizacion (predio_id);
create index if not exists ix_carac_productor on productores.caracterizacion (productor_id);
create index if not exists ix_carac_dpto      on productores.caracterizacion (cod_dpto);

alter table productores.caracterizacion enable row level security;
drop policy if exists caracterizacion_ver on productores.caracterizacion;
create policy caracterizacion_ver on productores.caracterizacion for select to authenticated
  using (productores.ve_dpto(cod_dpto));
drop policy if exists caracterizacion_sig_editor on productores.caracterizacion;
create policy caracterizacion_sig_editor on productores.caracterizacion for all to sig_editor
  using (true) with check (true);
drop policy if exists caracterizacion_arcgis on productores.caracterizacion;
create policy caracterizacion_arcgis on productores.caracterizacion for select to arcgis_lector using (true);
grant select on productores.caracterizacion to authenticated, arcgis_lector;
grant all on productores.caracterizacion to sig_editor, service_role;

-- v_predio con el código Humboldt (columna nueva al final) ----------------
create or replace view productores.v_predio with (security_invoker = true) as
 SELECT p.id, p.cod_predio, p.productor_id, p.nombre, p.num_predial, p.matricula, p.tenencia_id,
    t.nombre AS tenencia, p.area_declarada_ha, p.area_sig_ha, p.cod_mpio, m.nombre AS municipio,
    p.vereda_id, v.nombre AS vereda, p.altitud_msnm, p.como_llegar,
    st_y(p.punto) AS latitud, st_x(p.punto) AS longitud,
    (st_asgeojson(p.geom, 7))::json AS geojson,
    pr.num_doc,
    TRIM(BOTH FROM ((pr.nombres || ' '::text) || COALESCE(pr.apellidos, ''::text))) AS productor,
    (SELECT count(*) FROM productores.lote l WHERE l.predio_id = p.id) AS n_lotes,
    (SELECT sum(COALESCE(l.area_sig_ha, l.area_declarada_ha)) FROM productores.lote l WHERE l.predio_id = p.id) AS area_lotes_ha,
    p.creado_por, p.creado_en, p.editado_en,
    CASE WHEN p.geom IS NULL THEN 'Pendiente de delimitar' ELSE 'Delimitado' END AS estado_limite,
    v.validada AS vereda_validada,
    p.cod_humboldt
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id;

-- Función que procesa una encuesta ----------------------------------------
-- p     : respuestas con el nombre corto de cada pregunta (sin grupos)
-- crudo : el envío original de Kobo
-- clave : clave del receptor (privado.config)
create or replace function productores.procesar_kobo(p jsonb, crudo jsonb, clave text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id    uuid;
  v_uuid  text := replace(coalesce(p->>'_uuid', p->>'instanceID', ''), 'uuid:', '');
  v_mpio  text; v_dpto text; v_user uuid;
  v_doc   text; v_prod uuid; v_pdpto text;
  v_ver   uuid; v_vnom text;
  v_gps   text[]; v_punto extensions.geometry; v_alt int; v_acc numeric;
  v_hum   text; v_pred uuid; v_predprod uuid;
  v_area  numeric; v_res jsonb;
begin
  if clave is null or clave is distinct from (select valor from privado.config where privado.config.clave = 'kobo_clave') then
    raise exception 'Clave del receptor inválida' using errcode = '28000';
  end if;
  if v_uuid = '' then
    raise exception 'La encuesta no trae identificador (_uuid)';
  end if;

  insert into productores.caracterizacion
    (kobo_uuid, kobo_id, formulario, proyecto, datos, crudo, fecha_visita, tecnico, kobo_usuario)
  values
    (v_uuid, nullif(p->>'_id', '')::bigint, p->>'_xform_id_string', p->>'proyecto', p, crudo,
     nullif(p->>'fecha_visita', '')::date, p->>'tecnico', coalesce(p->>'_submitted_by', p->>'username'))
  on conflict (kobo_uuid) do update
    set datos = excluded.datos, crudo = excluded.crudo, kobo_id = excluded.kobo_id,
        formulario = excluded.formulario, proyecto = excluded.proyecto,
        fecha_visita = excluded.fecha_visita, tecnico = excluded.tecnico,
        kobo_usuario = excluded.kobo_usuario, estado = 'recibida', error = null
  returning id into v_id;

  begin
    -- Sin consentimiento: se guarda la constancia y no se crean datos personales
    if coalesce(p->>'acepta_tratamiento', '') <> 'si' then
      update productores.caracterizacion set estado = 'sin_consentimiento', procesado_en = now() where id = v_id;
      return jsonb_build_object('id', v_id, 'estado', 'sin_consentimiento');
    end if;

    -- Municipio y departamento
    v_mpio := p->>'municipio';
    if v_mpio is null or v_mpio !~ '^\d{5}$'
       or not exists (select 1 from productores.municipio where cod_mpio = v_mpio) then
      raise exception 'Municipio no reconocido: «%»', coalesce(v_mpio, 'vacío');
    end if;
    v_dpto := left(v_mpio, 2);
    update productores.caracterizacion set cod_dpto = v_dpto where id = v_id;
    if nullif(p->>'cod_dpto', '') is not null and p->>'cod_dpto' <> v_dpto then
      raise exception 'El municipio % no pertenece al departamento del formulario (%)', v_mpio, p->>'cod_dpto';
    end if;

    -- Técnico (usuario de Kobo registrado en Sigpredial)
    select u.user_id into v_user from productores.usuario_app u
     where u.activo and lower(u.kobo_usuario) = lower(coalesce(p->>'_submitted_by', p->>'username'));

    -- Productor (por documento)
    v_doc := upper(regexp_replace(coalesce(p->>'documento', ''), '[\s\.\-]', '', 'g'));
    if v_doc = '' then raise exception 'La encuesta no trae número de documento'; end if;
    select id, cod_dpto into v_prod, v_pdpto from productores.productor where num_doc = v_doc;
    if v_prod is null then
      insert into productores.productor
        (cod_dpto, tipo_doc, num_doc, nombres, apellidos, sexo, fecha_nac, telefono, creado_por)
      values
        (v_dpto, upper(nullif(p->>'tipo_doc', '')), v_doc, coalesce(nullif(trim(p->>'nombres'), ''), 'Sin nombre'),
         nullif(trim(p->>'apellidos'), ''), initcap(nullif(p->>'sexo', '')), nullif(p->>'fecha_nac', '')::date,
         nullif(p->>'contacto_telefono', ''), v_user)
      returning id into v_prod;
    else
      if v_pdpto is distinct from v_dpto then
        raise exception 'El productor con documento % ya está registrado en otro departamento (%)', v_doc, v_pdpto;
      end if;
      update productores.productor set
        tipo_doc  = coalesce(upper(nullif(p->>'tipo_doc', '')), tipo_doc),
        nombres   = coalesce(nullif(trim(p->>'nombres'), ''), nombres),
        apellidos = coalesce(nullif(trim(p->>'apellidos'), ''), apellidos),
        sexo      = coalesce(initcap(nullif(p->>'sexo', '')), sexo),
        fecha_nac = coalesce(nullif(p->>'fecha_nac', '')::date, fecha_nac),
        telefono  = coalesce(nullif(p->>'contacto_telefono', ''), telefono)
      where id = v_prod;
    end if;

    -- Vereda
    if p->>'vereda' = 'otra' then
      v_vnom := regexp_replace(trim(coalesce(p->>'vereda_otra', '')), '\s+', ' ', 'g');
      if v_vnom <> '' then
        select id into v_ver from productores.vereda
         where cod_mpio = v_mpio and productores.f_normalizar(nombre) = productores.f_normalizar(v_vnom);
        if v_ver is null then
          insert into productores.vereda (nombre, cod_mpio, origen, validada)
          values (v_vnom, v_mpio, 'campo', false) returning id into v_ver;
        end if;
      end if;
    elsif nullif(p->>'vereda', '') is not null then
      select id into v_ver from productores.vereda where cod_vereda = p->>'vereda' and cod_mpio = v_mpio;
      if v_ver is null then
        raise exception 'La vereda % no corresponde al municipio %', p->>'vereda', v_mpio;
      end if;
    end if;

    -- Punto GPS de la visita («lat lon altitud precisión»)
    v_gps := regexp_split_to_array(trim(coalesce(p->>'ubicacion_predio', '')), '\s+');
    if array_length(v_gps, 1) >= 2 and v_gps[1] ~ '^-?[0-9.]+$' and v_gps[2] ~ '^-?[0-9.]+$' then
      v_punto := extensions.st_setsrid(extensions.st_makepoint(v_gps[2]::float8, v_gps[1]::float8), 4326);
      if array_length(v_gps, 1) >= 3 and v_gps[3] ~ '^-?[0-9.]+$' and v_gps[3]::numeric between 0 and 5800 then
        v_alt := round(v_gps[3]::numeric);
      end if;
      if array_length(v_gps, 1) >= 4 and v_gps[4] ~ '^[0-9.]+$' then v_acc := round(v_gps[4]::numeric, 1); end if;
    end if;

    v_area := nullif(p->>'area_declarada_ha', '')::numeric;
    if v_area is not null and v_area <= 0 then v_area := null; end if;

    -- Predio (por código Humboldt)
    v_hum := nullif(upper(trim(coalesce(p->>'id_predio', ''))), '');
    if v_hum is not null then
      select id, productor_id into v_pred, v_predprod from productores.predio where cod_humboldt = v_hum;
    end if;
    if v_pred is null then
      insert into productores.predio
        (productor_id, nombre, cod_mpio, vereda_id, tenencia_id, area_declarada_ha, altitud_msnm,
         como_llegar, matricula, num_predial, cod_humboldt, punto, punto_visita, gps_precision_m, creado_por)
      values
        (v_prod, coalesce(nullif(trim(p->>'nombre_predio'), ''), 'Sin nombre'), v_mpio, v_ver,
         (select id from productores.tenencia where codigo = p->>'tenencia'), v_area, v_alt,
         nullif(trim(p->>'como_llegar'), ''), nullif(trim(p->>'matricula'), ''), nullif(trim(p->>'num_predial'), ''),
         v_hum, v_punto, v_punto, v_acc, v_user)
      returning id into v_pred;
    else
      if v_predprod <> v_prod then
        raise exception 'El predio % ya está registrado a nombre de otro productor', v_hum;
      end if;
      update productores.predio set
        nombre            = coalesce(nullif(trim(p->>'nombre_predio'), ''), nombre),
        cod_mpio          = v_mpio,
        vereda_id         = coalesce(v_ver, vereda_id),
        tenencia_id       = coalesce((select id from productores.tenencia where codigo = p->>'tenencia'), tenencia_id),
        area_declarada_ha = coalesce(v_area, area_declarada_ha),
        altitud_msnm      = coalesce(v_alt, altitud_msnm),
        como_llegar       = coalesce(nullif(trim(p->>'como_llegar'), ''), como_llegar),
        matricula         = coalesce(nullif(trim(p->>'matricula'), ''), matricula),
        num_predial       = coalesce(nullif(trim(p->>'num_predial'), ''), num_predial),
        punto_visita      = coalesce(v_punto, punto_visita),
        gps_precision_m   = coalesce(v_acc, gps_precision_m),
        punto             = case when geom is null then coalesce(v_punto, punto) else punto end
      where id = v_pred;
    end if;

    update productores.caracterizacion
       set estado = 'procesada', productor_id = v_prod, predio_id = v_pred, procesado_en = now()
     where id = v_id;
  exception when others then
    update productores.caracterizacion
       set estado = 'error', error = sqlerrm, procesado_en = now()
     where id = v_id;
  end;

  select jsonb_build_object('id', c.id, 'estado', c.estado, 'error', c.error,
                            'productor_id', c.productor_id, 'predio_id', c.predio_id)
    into v_res from productores.caracterizacion c where c.id = v_id;
  return v_res;
end
$$;

revoke execute on function productores.procesar_kobo(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function productores.procesar_kobo(jsonb, jsonb, text) to service_role;

-- Reprocesar las encuestas con error (después de corregir la causa), solo administrador
create or replace function productores.reprocesar_kobo(p_id uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c record;
begin
  if not productores.es_admin() and current_user not in ('postgres', 'service_role') then
    raise exception 'Solo el administrador puede reprocesar encuestas';
  end if;
  select datos, crudo into c from productores.caracterizacion where id = p_id;
  return productores.procesar_kobo(c.datos, c.crudo, (select valor from privado.config where clave = 'kobo_clave'));
end $$;
revoke execute on function productores.reprocesar_kobo(uuid) from public, anon;
grant execute on function productores.reprocesar_kobo(uuid) to authenticated, service_role;
