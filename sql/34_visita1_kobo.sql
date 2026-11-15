-- =====================================================================
-- 34 · Visita 1 (Anexo 1 v4) desde Kobo
-- ---------------------------------------------------------------------
-- Los formularios «Visita 1 · ZAP II Caquetá / Meta» (proyecto
-- 'zap2_visita1') eligen un predio que YA existe en Sigpredial. Por eso,
-- a diferencia de la caracterización inicial, la encuesta:
--   · se guarda completa en productores.caracterizacion, unida al predio
--     y al productor (se SUMA a la línea base; no reemplaza nada);
--   · llena directamente solo lo que estaba vacío y no es dato oficial:
--     teléfono, correo, tipo de documento, altitud y el punto de la visita
--     (punto_visita, que no mueve el punto oficial del predio);
--   · deja como PROPUESTA DE CORRECCIÓN, para que el coordinador la
--     apruebe o rechace en el portal, todo cambio a datos oficiales:
--     vereda, punto del predio (si el nuevo está a más de 300 m),
--     número de documento, nombre del productor, sexo, nombre y área del
--     predio.
-- La caracterización inicial (otros formularios) sigue igual.
-- =====================================================================

-- Propuestas de corrección ---------------------------------------------
create table if not exists productores.correccion_predio (
  id                 uuid primary key default gen_random_uuid(),
  caracterizacion_id uuid not null references productores.caracterizacion (id) on delete cascade,
  predio_id          uuid not null references productores.predio (id) on delete cascade,
  campo              text not null check (campo in ('vereda', 'punto', 'num_doc', 'nombre_productor', 'sexo',
                                                     'nombre_predio', 'area')),
  valor_actual       text,
  valor_nuevo        text not null,
  dato               jsonb not null default '{}'::jsonb,   -- valores técnicos (vereda_id, lon, lat, distancia, motivo…)
  estado             text not null default 'pendiente'
                     check (estado in ('pendiente', 'aprobada', 'rechazada', 'reemplazada')),
  nota               text,
  revisado_por       uuid references auth.users (id) on delete set null,
  revisado_en        timestamptz,
  creado_en          timestamptz not null default now(),
  unique (caracterizacion_id, campo)
);
create index if not exists ix_correccion_predio_pend on productores.correccion_predio (predio_id) where estado = 'pendiente';

alter table productores.correccion_predio enable row level security;
drop policy if exists correccion_ver on productores.correccion_predio;
create policy correccion_ver on productores.correccion_predio for select to authenticated
  using (productores.ve_predio(predio_id));
drop policy if exists correccion_sig_editor on productores.correccion_predio;
create policy correccion_sig_editor on productores.correccion_predio for all to sig_editor using (true) with check (true);
grant select on productores.correccion_predio to authenticated;
-- Se crean desde Kobo y se revisan con revisar_correccion(); no hay escritura directa desde el portal.

-- Procesar una encuesta de la Visita 1 ------------------------------------
create or replace function productores.procesar_visita1(v_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  v_mpio text; v_dpto text;
  pr  productores.predio%rowtype;
  pd  productores.productor%rowtype;
  v_ver uuid; v_vnom text; v_vact text;
  v_gps text[]; v_lat float8; v_lon float8; v_alt numeric; v_acc numeric; v_dist numeric;
  v_doc text; v_tdoc text; v_sexo text; v_nom text; v_area numeric; v_npred text;
begin
  -- Reproceso: las propuestas pendientes de esta misma encuesta se vuelven a generar
  delete from productores.correccion_predio where caracterizacion_id = v_id and estado = 'pendiente';

  update productores.caracterizacion set
    fecha_visita = coalesce(nullif(p->>'fecha_encuesta', '')::date, nullif(p->>'today', '')::date),
    tecnico      = nullif(trim(p->>'encuestador'), '')
  where id = v_id;

  if coalesce(p->>'acepta', '') <> 'si' then
    update productores.caracterizacion set estado = 'sin_consentimiento', procesado_en = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'estado', 'sin_consentimiento');
  end if;
  if coalesce(p->>'ficha_ok', '') <> 'si' then
    raise exception 'El técnico indicó que la ficha no corresponde al predio visitado';
  end if;

  -- Predio: debe existir y estar en el municipio elegido
  v_mpio := p->>'municipio';
  select * into pr from productores.predio where cod_predio = p->>'predio';
  if pr.id is null then
    raise exception 'El predio «%» no existe en Sigpredial', coalesce(p->>'predio', 'vacío');
  end if;
  if pr.cod_mpio <> v_mpio then
    raise exception 'El predio % no es del municipio %', pr.cod_predio, v_mpio;
  end if;
  v_dpto := left(v_mpio, 2);
  if nullif(p->>'cod_dpto', '') is not null and p->>'cod_dpto' <> v_dpto then
    raise exception 'El municipio % no pertenece al departamento del formulario (%)', v_mpio, p->>'cod_dpto';
  end if;
  select * into pd from productores.productor where id = pr.productor_id;

  update productores.caracterizacion
     set cod_dpto = v_dpto, predio_id = pr.id, productor_id = pr.productor_id
   where id = v_id;

  -- Vereda ------------------------------------------------------------------
  if p->>'vereda_ok' = 'no' then
    if p->>'vereda_correcta' = 'otra' then
      v_vnom := regexp_replace(trim(coalesce(p->>'vereda_otra', '')), '\s+', ' ', 'g');
      if v_vnom <> '' then
        select id into v_ver from productores.vereda
         where cod_mpio = v_mpio and productores.f_normalizar(nombre) = productores.f_normalizar(v_vnom)
         order by validada desc limit 1;
        if v_ver is null then
          insert into productores.vereda (nombre, cod_mpio, origen, validada)
          values (v_vnom, v_mpio, 'campo', false) returning id into v_ver;
        end if;
      end if;
    elsif nullif(p->>'vereda_correcta', '') is not null then
      select id, nombre into v_ver, v_vnom from productores.vereda
       where cod_vereda = p->>'vereda_correcta' and cod_mpio = v_mpio;
      -- Caquetá: veredas del proyecto ZAP sin código oficial («z…»); llegan con su nombre en vereda_nombre
      if v_ver is null and p->>'vereda_correcta' like 'z' || v_mpio || '%' and nullif(trim(p->>'vereda_nombre'), '') is not null then
        v_vnom := regexp_replace(trim(p->>'vereda_nombre'), '\s+', ' ', 'g');
        select id into v_ver from productores.vereda
         where cod_mpio = v_mpio
           and replace(productores.f_normalizar(nombre), ' ', '') = replace(productores.f_normalizar(v_vnom), ' ', '')
         order by validada desc, (cod_vereda is not null) desc limit 1;
        if v_ver is null then
          insert into productores.vereda (nombre, cod_mpio, origen, validada)
          values (v_vnom, v_mpio, 'campo', false) returning id into v_ver;
        end if;
      end if;
      if v_ver is null then
        raise exception 'La vereda % no corresponde al municipio %', p->>'vereda_correcta', v_mpio;
      end if;
    end if;
    if v_ver is not null and v_ver is distinct from pr.vereda_id then
      select nombre into v_vact from productores.vereda where id = pr.vereda_id;
      select nombre into v_vnom from productores.vereda where id = v_ver;
      insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo, dato)
      values (v_id, pr.id, 'vereda', v_vact, v_vnom,
              jsonb_build_object('vereda_id', v_ver, 'observacion', nullif(p->>'obs_ubicacion', '')));
    end if;
  end if;

  -- Punto GPS («lat lon altitud precisión») ----------------------------------
  v_gps := regexp_split_to_array(trim(coalesce(p->>'punto', '')), '\s+');
  if array_length(v_gps, 1) >= 2 and v_gps[1] ~ '^-?[0-9.]+$' and v_gps[2] ~ '^-?[0-9.]+$' then
    v_lat := v_gps[1]::float8; v_lon := v_gps[2]::float8;
    if array_length(v_gps, 1) >= 3 and v_gps[3] ~ '^-?[0-9.]+$' and v_gps[3]::numeric between 0 and 5800 then
      v_alt := round(v_gps[3]::numeric);
    end if;
    if array_length(v_gps, 1) >= 4 and v_gps[4] ~ '^[0-9.]+$' then v_acc := round(v_gps[4]::numeric, 1); end if;
    update productores.predio set
      punto_visita    = extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326),
      gps_precision_m = coalesce(v_acc, gps_precision_m),
      altitud_msnm    = coalesce(altitud_msnm, v_alt::int)
    where id = pr.id;
    if pr.punto is not null then
      v_dist := round(extensions.st_distance(pr.punto::extensions.geography,
                  extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326)::extensions.geography)::numeric);
    end if;
    if pr.punto is null or v_dist > 300 then
      insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo, dato)
      values (v_id, pr.id, 'punto',
              case when pr.punto is not null then
                round(extensions.st_y(pr.punto)::numeric, 6) || ', ' || round(extensions.st_x(pr.punto)::numeric, 6) end,
              round(v_lat::numeric, 6) || ', ' || round(v_lon::numeric, 6),
              jsonb_build_object('lat', v_lat, 'lon', v_lon, 'precision_m', v_acc, 'distancia_m', v_dist,
                                 'motivo', nullif(p->>'motivo_dist', ''), 'motivo_detalle', nullif(p->>'motivo_dist_det', ''),
                                 'observacion', nullif(p->>'obs_ubicacion', '')));
    end if;
  end if;

  -- Productor ------------------------------------------------------------------
  v_tdoc := case p->>'tipo_doc' when 'cc' then 'CC' when 'ti' then 'TI' when 'ce' then 'CE' when 'pa' then 'PAS' end;
  update productores.productor set
    tipo_doc = coalesce(tipo_doc, v_tdoc),
    telefono = coalesce(nullif(telefono, ''), nullif(p->>'celular', '')),
    correo   = coalesce(nullif(correo, ''), nullif(lower(trim(p->>'correo')), ''))
  where id = pd.id;

  v_doc := upper(regexp_replace(coalesce(p->>'num_doc', ''), '[\s\.\-]', '', 'g'));
  if v_doc <> '' and v_doc is distinct from pd.num_doc then
    insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo, dato)
    values (v_id, pr.id, 'num_doc', case when pd.num_doc like 'PEND-%' then null else pd.num_doc end, v_doc,
            jsonb_build_object('tipo_doc', v_tdoc, 'productor_id', pd.id,
                               'otro_productor_id', (select id from productores.productor where num_doc = v_doc and id <> pd.id)));
  end if;

  v_nom := regexp_replace(trim(coalesce(p->>'prop_nombre', '')), '\s+', ' ', 'g');
  if v_nom <> '' and productores.f_normalizar(v_nom)
       is distinct from productores.f_normalizar(trim(coalesce(pd.nombres, '') || ' ' || coalesce(pd.apellidos, ''))) then
    insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo, dato)
    values (v_id, pr.id, 'nombre_productor', trim(coalesce(pd.nombres, '') || ' ' || coalesce(pd.apellidos, '')), v_nom,
            jsonb_build_object('productor_id', pd.id));
  end if;

  v_sexo := case p->>'prop_sexo' when 'masculino' then 'Hombre' when 'femenino' then 'Mujer' end;
  if v_sexo is not null and v_sexo is distinct from pd.sexo then
    insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo, dato)
    values (v_id, pr.id, 'sexo', pd.sexo, v_sexo, jsonb_build_object('productor_id', pd.id));
  end if;

  -- Predio: nombre y área ------------------------------------------------------
  v_npred := regexp_replace(trim(coalesce(p->>'nombre_predio', '')), '\s+', ' ', 'g');
  if v_npred <> '' and productores.f_normalizar(v_npred) is distinct from productores.f_normalizar(pr.nombre) then
    insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo)
    values (v_id, pr.id, 'nombre_predio', pr.nombre, v_npred);
  end if;
  v_area := nullif(p->>'area_total', '')::numeric;
  if v_area > 0 and (pr.area_declarada_ha is null or abs(v_area - pr.area_declarada_ha) >= 0.01) then
    insert into productores.correccion_predio (caracterizacion_id, predio_id, campo, valor_actual, valor_nuevo)
    values (v_id, pr.id, 'area', pr.area_declarada_ha::text, v_area::text);
  end if;

  -- Una propuesta nueva deja «reemplazadas» las pendientes anteriores del mismo dato
  update productores.correccion_predio c set estado = 'reemplazada'
   where c.predio_id = pr.id and c.estado = 'pendiente' and c.caracterizacion_id <> v_id
     and c.campo in (select campo from productores.correccion_predio where caracterizacion_id = v_id);

  update productores.caracterizacion set estado = 'procesada', procesado_en = now() where id = v_id;
  return jsonb_build_object('id', v_id, 'estado', 'procesada', 'predio_id', pr.id, 'productor_id', pr.productor_id,
                            'correcciones', (select count(*) from productores.correccion_predio where caracterizacion_id = v_id));
end $$;
revoke execute on function productores.procesar_visita1(uuid, jsonb) from public, anon, authenticated;

-- procesar_kobo(): las encuestas de la Visita 1 van por su propio camino -------
do $$
declare def text; nuevo text;
begin
  def := pg_get_functiondef('productores.procesar_kobo(jsonb, jsonb, text)'::regprocedure);
  if position('procesar_visita1' in def) > 0 then return; end if;   -- ya ajustada
  nuevo := replace(def,
$v$  begin
    if coalesce(p->>'acepta_tratamiento', '') <> 'si' then$v$,
$v$  begin
    -- Visita 1 (Anexo 1 v4): predio existente; se suma y propone correcciones
    if p->>'proyecto' = 'zap2_visita1' then
      v_res := productores.procesar_visita1(v_id, p);
      return v_res;
    end if;
    if coalesce(p->>'acepta_tratamiento', '') <> 'si' then$v$);
  if nuevo = def then raise exception 'No se pudo ajustar procesar_kobo'; end if;
  execute nuevo;
end $$;

-- Revisar una propuesta (coordinador o administrador del departamento) ----------
create or replace function productores.revisar_correccion(p_id uuid, p_aprobar boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c productores.correccion_predio%rowtype; pr productores.predio%rowtype; v_otro uuid; v_dpto text;
begin
  select * into c from productores.correccion_predio where id = p_id for update;
  if c.id is null then raise exception 'La propuesta no existe'; end if;
  select * into pr from productores.predio where id = c.predio_id;
  if not (productores.es_coordinador() and productores.ve_predio(pr.id)) then
    raise exception 'Solo el coordinador del departamento puede revisar correcciones';
  end if;
  if c.estado <> 'pendiente' then raise exception 'La propuesta ya fue revisada (%)', c.estado; end if;

  if p_aprobar then
    case c.campo
      when 'vereda' then
        update productores.predio set vereda_id = (c.dato->>'vereda_id')::uuid where id = pr.id;
      when 'punto' then
        update productores.predio
           set punto = extensions.st_setsrid(extensions.st_makepoint((c.dato->>'lon')::float8, (c.dato->>'lat')::float8), 4326)
         where id = pr.id;
      when 'num_doc' then
        select id, cod_dpto into v_otro, v_dpto from productores.productor where num_doc = c.valor_nuevo and id <> pr.productor_id;
        if v_otro is not null then
          -- El documento ya es de otro productor (p. ej. tiene otro predio): el predio pasa a ese productor
          if v_dpto is distinct from left(pr.cod_mpio, 2) then
            raise exception 'El documento % ya está registrado en otro departamento (%)', c.valor_nuevo, v_dpto;
          end if;
          update productores.predio set productor_id = v_otro where id = pr.id;
          update productores.caracterizacion set productor_id = v_otro where predio_id = pr.id;
        else
          update productores.productor
             set num_doc = c.valor_nuevo, tipo_doc = coalesce(c.dato->>'tipo_doc', tipo_doc)
           where id = pr.productor_id;
        end if;
      when 'nombre_productor' then
        update productores.productor set nombres = c.valor_nuevo, apellidos = null where id = pr.productor_id;
      when 'sexo' then
        update productores.productor set sexo = c.valor_nuevo where id = pr.productor_id;
      when 'nombre_predio' then
        update productores.predio set nombre = c.valor_nuevo where id = pr.id;
      when 'area' then
        update productores.predio set area_declarada_ha = c.valor_nuevo::numeric where id = pr.id;
    end case;
  end if;

  update productores.correccion_predio
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         nota = nullif(trim(p_nota), ''), revisado_por = auth.uid(), revisado_en = now()
   where id = c.id;
  return jsonb_build_object('id', c.id, 'estado', case when p_aprobar then 'aprobada' else 'rechazada' end);
end $$;
revoke execute on function productores.revisar_correccion(uuid, boolean, text) from public, anon;
grant execute on function productores.revisar_correccion(uuid, boolean, text) to authenticated;

-- Vista para el portal: propuestas con su predio y quién las tomó ------------
create or replace view productores.r_correcciones with (security_invoker = true) as
select c.id, c.estado, c.campo,
       case c.campo when 'vereda' then 'Vereda' when 'punto' then 'Punto del predio' when 'num_doc' then 'Número de documento'
                    when 'nombre_productor' then 'Nombre del productor' when 'sexo' then 'Sexo'
                    when 'nombre_predio' then 'Nombre del predio' when 'area' then 'Área declarada (ha)' end as dato_corregido,
       c.valor_actual, c.valor_nuevo, (c.dato->>'distancia_m')::numeric as distancia_m,
       coalesce(c.dato->>'motivo_detalle', c.dato->>'motivo') as motivo, c.dato->>'observacion' as observacion,
       p.cod_predio, p.cod_humboldt, p.nombre as predio, m.nombre as municipio, d.nombre as departamento,
       k.fecha_visita, k.tecnico, c.creado_en, c.nota, c.revisado_en,
       (select nombre from productores.usuario_app u where u.user_id = c.revisado_por) as revisado_por
  from productores.correccion_predio c
  join productores.predio p on p.id = c.predio_id
  join productores.municipio m on m.cod_mpio = p.cod_mpio
  join productores.departamento d on d.cod_dpto = m.cod_dpto
  join productores.caracterizacion k on k.id = c.caracterizacion_id;
grant select on productores.r_correcciones to authenticated;
