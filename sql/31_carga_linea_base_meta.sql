-- =========================================================================
--  31 · Carga de la línea base del Meta (formularios QField de campo)
--
--  cargar_linea_base(jsonb): recibe una lista de registros ya revisados
--  ({cod, mpio, vereda, predio, productor, lon, lat, datos}) y por cada uno:
--   - ubica la vereda del catálogo (sin tildes ni mayúsculas); si no existe,
--     la crea como vereda «de campo» sin validar (igual que Kobo con «otra»);
--   - crea o actualiza el productor provisional PEND-<código> (sin cédula aún);
--   - crea o actualiza el predio por su código de campo (cod_humboldt), con el
--     punto GPS; el código Sigpredial lo asigna la base (50590-0001…);
--   - guarda la encuesta en caracterizacion (resumen en el formato de Caquetá).
--  Solo la ejecuta el administrador (o el editor SQL). Sirve para el 4.º municipio.
-- =========================================================================
create or replace function productores.cargar_linea_base(p_regs jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb; v_ver uuid; v_prod uuid; v_pred uuid; v_doc text; v_pt extensions.geometry;
        n_new int := 0; n_upd int := 0; n_ver int := 0; d jsonb;
begin
  if not productores.es_admin() and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Solo el administrador puede cargar la línea base.';
  end if;
  for r in select x from jsonb_array_elements(p_regs) x order by x->>'cod' loop
    d := r->'datos';
    if not exists (select 1 from productores.municipio where cod_mpio = r->>'mpio') then
      raise exception 'Municipio no reconocido: % (%)', r->>'mpio', r->>'cod';
    end if;
    -- Vereda
    v_ver := null;
    if nullif(trim(r->>'vereda'), '') is not null then
      select id into v_ver from productores.vereda
       where cod_mpio = r->>'mpio' and productores.f_normalizar(nombre) = productores.f_normalizar(r->>'vereda') limit 1;
      if v_ver is null then
        insert into productores.vereda (nombre, cod_mpio, origen, validada)
        values (trim(r->>'vereda'), r->>'mpio', 'campo', false) returning id into v_ver;
        n_ver := n_ver + 1;
      end if;
    end if;
    -- Productor provisional (sin cédula todavía)
    v_doc := 'PEND-' || (r->>'cod');
    select id into v_prod from productores.productor where num_doc = v_doc;
    if v_prod is null then
      insert into productores.productor (cod_dpto, num_doc, nombres)
      values (left(r->>'mpio', 2), v_doc, r->>'productor') returning id into v_prod;
    else
      update productores.productor set nombres = r->>'productor' where id = v_prod;
    end if;
    -- Predio
    v_pt := extensions.st_setsrid(extensions.st_makepoint((r->>'lon')::float8, (r->>'lat')::float8), 4326);
    select id into v_pred from productores.predio where cod_humboldt = r->>'cod';
    if v_pred is null then
      insert into productores.predio (productor_id, nombre, cod_mpio, vereda_id, tenencia_id, area_declarada_ha,
                                      altitud_msnm, cod_humboldt, punto, punto_visita)
      values (v_prod, coalesce(nullif(trim(r->>'predio'), ''), 'Sin nombre'), r->>'mpio', v_ver,
              (select t.id from productores.tenencia t where lower(t.codigo) = lower(d->>'tenencia')
                  or lower(t.nombre) = lower(d->>'tenencia') limit 1),
              nullif(d->>'area_declarada_ha', '')::numeric, nullif(round((d->>'altitud_msnm')::numeric), 0),
              r->>'cod', v_pt, v_pt)
      returning id into v_pred;
      n_new := n_new + 1;
    else
      update productores.predio set productor_id = v_prod, nombre = coalesce(nullif(trim(r->>'predio'), ''), nombre),
             vereda_id = coalesce(v_ver, vereda_id), area_declarada_ha = coalesce(nullif(d->>'area_declarada_ha', '')::numeric, area_declarada_ha),
             punto_visita = v_pt, punto = case when geom is null then v_pt else punto end
       where id = v_pred;
      n_upd := n_upd + 1;
    end if;
    -- Encuesta
    insert into productores.caracterizacion (kobo_uuid, formulario, proyecto, cod_dpto, productor_id, predio_id,
                                             fecha_visita, tecnico, estado, datos, procesado_en)
    values ('zap2-linea-base-' || (r->>'cod'), d->>'fuente', 'ZAP II', left(r->>'mpio', 2), v_prod, v_pred,
            nullif(d->>'fecha_visita', '')::date, d->>'tecnico', 'procesada', d, now())
    on conflict (kobo_uuid) do update set datos = excluded.datos, productor_id = excluded.productor_id,
       predio_id = excluded.predio_id, fecha_visita = excluded.fecha_visita, tecnico = excluded.tecnico,
       estado = 'procesada', error = null, procesado_en = now();
  end loop;
  return jsonb_build_object('predios_nuevos', n_new, 'predios_actualizados', n_upd, 'veredas_nuevas', n_ver);
end $$;
revoke all on function productores.cargar_linea_base(jsonb) from public, anon;
grant execute on function productores.cargar_linea_base(jsonb) to authenticated;
