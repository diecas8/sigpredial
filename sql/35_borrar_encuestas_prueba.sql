-- =====================================================================
-- 35 · Borrar encuestas de prueba o de taller (Visita 1)
-- ---------------------------------------------------------------------
-- Para los talleres con técnicos: el administrador puede borrar una
-- encuesta y Sigpredial deja el predio como estaba:
--   · procesar_visita1() guarda lo que había antes de los cambios
--     directos (punto de la visita, precisión, altitud, tipo de
--     documento, teléfono, correo) y lo que quedó después;
--   · revisar_correccion() guarda el valor anterior al aprobar;
--   · borrar_encuesta() deshace las correcciones aprobadas y los cambios
--     directos SOLO si nadie los ha vuelto a cambiar, devuelve a
--     «pendiente» las propuestas que esa encuesta había reemplazado,
--     borra las veredas de campo que creó (si nadie las usa) y borra la
--     encuesta con sus propuestas.
-- =====================================================================

alter table productores.caracterizacion add column if not exists previo jsonb;
alter table productores.correccion_predio
  add column if not exists reemplazada_por uuid references productores.caracterizacion (id) on delete set null;

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
  v_vcreada boolean := false;
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
  -- Lo que había antes de la encuesta (solo la primera vez), para poder deshacerla si era de prueba
  update productores.caracterizacion
     set cod_dpto = v_dpto, predio_id = pr.id, productor_id = pr.productor_id,
         previo = coalesce(previo, jsonb_build_object('antes', jsonb_build_object(
           'punto_visita', extensions.st_astext(pr.punto_visita), 'gps_precision_m', pr.gps_precision_m,
           'altitud_msnm', pr.altitud_msnm, 'tipo_doc', pd.tipo_doc, 'telefono', pd.telefono, 'correo', pd.correo)))
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
          v_vcreada := true;
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
          v_vcreada := true;
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
              jsonb_build_object('vereda_id', v_ver, 'vereda_creada', v_vcreada, 'observacion', nullif(p->>'obs_ubicacion', '')));
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
  update productores.correccion_predio c set estado = 'reemplazada', reemplazada_por = v_id
   where c.predio_id = pr.id and c.estado = 'pendiente' and c.caracterizacion_id <> v_id
     and c.campo in (select campo from productores.correccion_predio where caracterizacion_id = v_id);

  -- Lo que quedó después de los cambios directos (para deshacer solo si nadie lo cambió luego)
  update productores.caracterizacion c set estado = 'procesada', procesado_en = now(),
         previo = c.previo || jsonb_build_object('despues', (select jsonb_build_object(
           'punto_visita', extensions.st_astext(x.punto_visita), 'gps_precision_m', x.gps_precision_m,
           'altitud_msnm', x.altitud_msnm, 'tipo_doc', y.tipo_doc, 'telefono', y.telefono, 'correo', y.correo)
           from productores.predio x join productores.productor y on y.id = x.productor_id where x.id = pr.id))
   where c.id = v_id;
  return jsonb_build_object('id', v_id, 'estado', 'procesada', 'predio_id', pr.id, 'productor_id', pr.productor_id,
                            'correcciones', (select count(*) from productores.correccion_predio where caracterizacion_id = v_id));
end $$;
revoke execute on function productores.procesar_visita1(uuid, jsonb) from public, anon, authenticated;

create or replace function productores.revisar_correccion(p_id uuid, p_aprobar boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c productores.correccion_predio%rowtype; pr productores.predio%rowtype; pd productores.productor%rowtype;
        v_otro uuid; v_dpto text; v_antes jsonb := '{}'::jsonb;
begin
  select * into c from productores.correccion_predio where id = p_id for update;
  if c.id is null then raise exception 'La propuesta no existe'; end if;
  select * into pr from productores.predio where id = c.predio_id;
  if not (productores.es_coordinador() and productores.ve_predio(pr.id)) then
    raise exception 'Solo el coordinador del departamento puede revisar correcciones';
  end if;
  if c.estado <> 'pendiente' then raise exception 'La propuesta ya fue revisada (%)', c.estado; end if;

  if p_aprobar then
    select * into pd from productores.productor where id = pr.productor_id;
    v_antes := case c.campo
      when 'vereda' then jsonb_build_object('vereda_id', pr.vereda_id)
      when 'punto' then jsonb_build_object('punto', extensions.st_astext(pr.punto))
      when 'num_doc' then jsonb_build_object('productor_id', pr.productor_id, 'num_doc', pd.num_doc, 'tipo_doc', pd.tipo_doc)
      when 'nombre_productor' then jsonb_build_object('nombres', pd.nombres, 'apellidos', pd.apellidos)
      when 'sexo' then jsonb_build_object('sexo', pd.sexo)
      when 'nombre_predio' then jsonb_build_object('nombre', pr.nombre)
      when 'area' then jsonb_build_object('area', pr.area_declarada_ha) end;
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
          v_antes := v_antes || jsonb_build_object('reasignado_a', v_otro);
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
         nota = nullif(trim(p_nota), ''), revisado_por = auth.uid(), revisado_en = now(),
         dato = case when p_aprobar then dato || jsonb_build_object('antes', v_antes) else dato end
   where id = c.id;
  return jsonb_build_object('id', c.id, 'estado', case when p_aprobar then 'aprobada' else 'rechazada' end);
end $$;
revoke execute on function productores.revisar_correccion(uuid, boolean, text) from public, anon;
grant execute on function productores.revisar_correccion(uuid, boolean, text) to authenticated;


-- Borrar una encuesta (de prueba o de un taller) y deshacer lo que cambió --------------------
-- Solo el administrador. Deshace las correcciones que se aprobaron desde esa encuesta y los
-- datos que llenó directamente, SOLO si nadie los ha vuelto a cambiar después.
create or replace function productores.borrar_encuesta(p_id uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  c productores.caracterizacion%rowtype; k record; pr productores.predio%rowtype; pd productores.productor%rowtype;
  a jsonb; d jsonb; v_rev int := 0; v_omit int := 0; v_ok boolean;
begin
  -- Dentro de una función «security definer» current_user es el dueño: se usa la sesión real
  if (auth.uid() is not null and not productores.es_admin())
     or (auth.uid() is null and session_user not in ('postgres', 'supabase_admin')) then
    raise exception 'Solo el administrador puede borrar encuestas';
  end if;
  select * into c from productores.caracterizacion where id = p_id for update;
  if c.id is null then raise exception 'La encuesta no existe'; end if;

  if c.proyecto = 'zap2_visita1' and c.predio_id is not null then
    -- 1) Correcciones aprobadas desde esta encuesta, de la más reciente a la más antigua
    for k in select * from productores.correccion_predio
              where caracterizacion_id = c.id and estado = 'aprobada' order by revisado_en desc loop
      select * into pr from productores.predio where id = k.predio_id;
      select * into pd from productores.productor where id = pr.productor_id;
      a := coalesce(k.dato->'antes', '{}'::jsonb); v_ok := false;
      if k.campo = 'vereda' and pr.vereda_id = (k.dato->>'vereda_id')::uuid then
        update productores.predio set vereda_id = (a->>'vereda_id')::uuid where id = pr.id; v_ok := true;
      elsif k.campo = 'punto' and a ? 'punto' and extensions.st_equals(pr.punto,
            extensions.st_setsrid(extensions.st_makepoint((k.dato->>'lon')::float8, (k.dato->>'lat')::float8), 4326)) then
        update productores.predio set punto = extensions.st_geomfromtext(a->>'punto', 4326) where id = pr.id; v_ok := true;
      elsif k.campo = 'num_doc' and a ? 'reasignado_a' and pr.productor_id = (a->>'reasignado_a')::uuid then
        update productores.predio set productor_id = (a->>'productor_id')::uuid where id = pr.id;
        update productores.caracterizacion set productor_id = (a->>'productor_id')::uuid where id = c.id; v_ok := true;
      elsif k.campo = 'num_doc' and not a ? 'reasignado_a' and pd.num_doc = k.valor_nuevo and a ? 'num_doc' then
        update productores.productor set num_doc = a->>'num_doc', tipo_doc = a->>'tipo_doc' where id = pd.id; v_ok := true;
      elsif k.campo = 'nombre_productor' and pd.nombres = k.valor_nuevo and a ? 'nombres' then
        update productores.productor set nombres = a->>'nombres', apellidos = a->>'apellidos' where id = pd.id; v_ok := true;
      elsif k.campo = 'sexo' and pd.sexo = k.valor_nuevo and a ? 'sexo' then
        update productores.productor set sexo = a->>'sexo' where id = pd.id; v_ok := true;
      elsif k.campo = 'nombre_predio' and pr.nombre = k.valor_nuevo and a ? 'nombre' then
        update productores.predio set nombre = a->>'nombre' where id = pr.id; v_ok := true;
      elsif k.campo = 'area' and pr.area_declarada_ha = k.valor_nuevo::numeric and a ? 'area' then
        update productores.predio set area_declarada_ha = (a->>'area')::numeric where id = pr.id; v_ok := true;
      end if;
      if v_ok then v_rev := v_rev + 1; else v_omit := v_omit + 1; end if;
    end loop;

    -- 2) Datos que la encuesta llenó directamente (punto de la visita, precisión, teléfono…)
    a := c.previo->'antes'; d := c.previo->'despues';
    if a is not null and d is not null then
      select * into pr from productores.predio where id = c.predio_id;
      select * into pd from productores.productor where id = pr.productor_id;
      update productores.predio set
        punto_visita    = case when extensions.st_astext(punto_visita) is not distinct from d->>'punto_visita'
                               then extensions.st_geomfromtext(a->>'punto_visita', 4326) else punto_visita end,
        gps_precision_m = case when gps_precision_m is not distinct from (d->>'gps_precision_m')::numeric
                               then (a->>'gps_precision_m')::numeric else gps_precision_m end,
        altitud_msnm    = case when altitud_msnm is not distinct from (d->>'altitud_msnm')::int
                               then (a->>'altitud_msnm')::int else altitud_msnm end
      where id = pr.id;
      update productores.productor set
        tipo_doc = case when tipo_doc is not distinct from d->>'tipo_doc' then a->>'tipo_doc' else tipo_doc end,
        telefono = case when telefono is not distinct from d->>'telefono' then a->>'telefono' else telefono end,
        correo   = case when correo   is not distinct from d->>'correo'   then a->>'correo'   else correo end
      where id = pd.id;
    end if;

    -- 3) Propuestas de otras encuestas que esta había dejado «reemplazadas» vuelven a quedar pendientes
    update productores.correccion_predio set estado = 'pendiente', reemplazada_por = null
     where reemplazada_por = c.id and estado = 'reemplazada';

    -- 4) Veredas de campo que creó esta encuesta y que ningún predio usa
    delete from productores.vereda v
     where v.id in (select (k2.dato->>'vereda_id')::uuid from productores.correccion_predio k2
                     where k2.caracterizacion_id = c.id and (k2.dato->>'vereda_creada')::boolean)
       and v.origen = 'campo' and not v.validada
       and not exists (select 1 from productores.predio x where x.vereda_id = v.id);
  end if;

  delete from productores.caracterizacion where id = c.id;   -- sus propuestas se borran en cascada
  return jsonb_build_object('borrada', c.id, 'predio_id', c.predio_id, 'deshechas', v_rev, 'no_deshechas', v_omit);
end $$;
revoke execute on function productores.borrar_encuesta(uuid) from public, anon;
grant execute on function productores.borrar_encuesta(uuid) to authenticated;

-- Misma corrección para reprocesar_kobo(): antes cualquier usuario con sesión pasaba el control,
-- porque current_user dentro de la función es su dueño (postgres)
create or replace function productores.reprocesar_kobo(p_id uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare c record;
begin
  if (auth.uid() is not null and not productores.es_admin())
     or (auth.uid() is null and session_user not in ('postgres', 'supabase_admin')) then
    raise exception 'Solo el administrador puede reprocesar encuestas';
  end if;
  select datos, crudo into c from productores.caracterizacion where id = p_id;
  return productores.procesar_kobo(c.datos, c.crudo, (select valor from privado.config where clave = 'kobo_clave'));
end $$;
revoke execute on function productores.reprocesar_kobo(uuid) from public, anon;
grant execute on function productores.reprocesar_kobo(uuid) to authenticated, service_role;
