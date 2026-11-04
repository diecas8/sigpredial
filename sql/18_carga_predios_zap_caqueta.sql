-- =========================================================================
--  18 · Carga de los 240 predios ZAP II del Caquetá (encuesta de línea base)
--
--  Origen: Fuente_correspondencia_normalizada_V5.csv (30 predios en cada uno
--  de los 8 municipios). Los datos se subieron antes a la tabla privada
--  privado.carga_zap (no se guardan en el repositorio: tienen datos personales).
--
--   a) Veredas que no están en la lista oficial → se crean «por validar».
--   b) Productor titular con documento PROVISIONAL «PEND-<código>» (la
--      encuesta no trae cédula). Se reemplaza cuando llegue la cédula, desde
--      el portal o desde Kobo.
--   c) Predio con su código ZAP (cod_humboldt), punto de la encuesta,
--      vereda, tenencia, área declarada, altitud y cómo llegar.
--      Queda «Pendiente de delimitar» para dibujarlo en el portal.
--   d) La encuesta queda como caracterización (sin nombres ni edades de los
--      integrantes del hogar: solo conteos).
--   e) procesar_kobo(): si llega una encuesta de Kobo de un predio cargado
--      aquí, adopta al productor provisional en vez de rechazarla.
-- =========================================================================

create temp table _f on commit drop as
select x->>0 as codigo, x->>1 as cod_mpio, nullif(trim(x->>2), '') as vereda, x->>3 as vereda_cod,
       x->>4 as predio, x->>5 as titular, x->>6 as sexo, x->>7 as tenencia,
       (x->>8)::numeric as area, (x->>9)::int as alt, x->>10 as llegar,
       (x->>11)::float8 as lon, (x->>12)::float8 as lat, (x->>13)::date as fecha, x->>14 as tecnico,
       x->>15 as informante, x->>16 as relacion,
       (x->>17)::int as personas, (x->>18)::int as mujeres, (x->>19)::int as ninos,
       (x->>20)::int as jovenes, (x->>21)::int as mayores,
       x->>22 as usos, x->>23 as lineas, x->>24 as ingreso, x->>25 as conect, x->>26 as obs
  from privado.carga_zap, jsonb_array_elements(filas) x;

-- a) Veredas nuevas (por validar)
insert into productores.vereda (nombre, cod_mpio, origen, validada)
select distinct on (f.cod_mpio, productores.f_normalizar(f.vereda)) f.vereda, f.cod_mpio, 'campo', false
  from _f f
 where f.vereda is not null and f.vereda_cod is null
   and not exists (select 1 from productores.vereda v
                    where v.cod_mpio = f.cod_mpio
                      and productores.f_normalizar(v.nombre) = productores.f_normalizar(f.vereda))
on conflict (cod_mpio, nombre) do nothing;

-- b) Productores (documento provisional)
insert into productores.productor (cod_dpto, tipo_doc, num_doc, nombres, sexo, observaciones)
select left(f.cod_mpio, 2), null, 'PEND-' || f.codigo, f.titular, f.sexo,
       'Cargado de la encuesta ZAP II (línea base). Falta el número de documento.'
  from _f f
on conflict (num_doc) do nothing;

-- c) Predios
insert into productores.predio
  (productor_id, nombre, cod_mpio, vereda_id, tenencia_id, area_declarada_ha, altitud_msnm,
   como_llegar, cod_humboldt, punto, punto_visita)
select pr.id, coalesce(nullif(trim(f.predio), ''), 'Sin nombre'), f.cod_mpio,
       coalesce((select v.id from productores.vereda v where v.cod_vereda = f.vereda_cod and v.cod_mpio = f.cod_mpio),
                (select v.id from productores.vereda v
                  where v.cod_mpio = f.cod_mpio
                    and productores.f_normalizar(v.nombre) = productores.f_normalizar(f.vereda)
                  order by v.validada desc limit 1)),
       (select t.id from productores.tenencia t where t.nombre = f.tenencia),
       nullif(f.area, 0), f.alt, f.llegar, f.codigo,
       extensions.st_setsrid(extensions.st_makepoint(f.lon, f.lat), 4326),
       extensions.st_setsrid(extensions.st_makepoint(f.lon, f.lat), 4326)
  from _f f
  join productores.productor pr on pr.num_doc = 'PEND-' || f.codigo
 where not exists (select 1 from productores.predio p where p.cod_humboldt = f.codigo);

-- d) Caracterización (encuesta de línea base)
insert into productores.caracterizacion
  (kobo_uuid, formulario, proyecto, cod_dpto, productor_id, predio_id, fecha_visita, tecnico,
   estado, procesado_en, datos)
select 'zap2-linea-base-' || f.codigo, 'Encuesta ZAP II (línea base)', 'ZAP II', left(f.cod_mpio, 2),
       p.productor_id, p.id, f.fecha, f.tecnico, 'procesada', now(),
       jsonb_strip_nulls(jsonb_build_object(
         'fuente', 'Encuesta ZAP II (línea base)', 'id_predio', f.codigo, 'municipio', f.cod_mpio,
         'vereda_declarada', f.vereda, 'nombre_predio', f.predio, 'fecha_visita', f.fecha, 'tecnico', f.tecnico,
         'informante_nombre', f.informante, 'informante_relacion', f.relacion,
         'personas_hogar', f.personas, 'mujeres', f.mujeres, 'ninos', f.ninos, 'jovenes', f.jovenes,
         'adultos_mayores', f.mayores, 'tenencia', f.tenencia, 'area_declarada_ha', f.area,
         'usos_suelo', (select jsonb_agg(jsonb_build_object(
              'tipo_uso', case left(u, 1) when 'b' then 'bosque_natural' when 'r' then 'rastrojo'
                                          when 'c' then 'cultivo' when 'p' then 'pasto'
                                          when 'v' then 'vivienda' else 'infraestructura' end,
              'area_uso_ha', substr(u, 2)::numeric))
            from unnest(string_to_array(nullif(f.usos, ''), ';')) u),
         'lineas_productivas', f.lineas, 'principal_ingreso', f.ingreso, 'conectividad', f.conect,
         'observaciones_generales', f.obs))
  from _f f
  join productores.predio p on p.cod_humboldt = f.codigo
on conflict (kobo_uuid) do nothing;

-- e) Kobo: adoptar al productor provisional del predio
do $$
declare def text; nuevo text;
begin
  def := pg_get_functiondef('productores.procesar_kobo(jsonb, jsonb, text)'::regprocedure);
  nuevo := replace(def,
$v$    select id, cod_dpto into v_prod, v_pdpto from productores.productor where num_doc = v_doc;$v$,
$v$    -- Predio cargado antes con productor provisional («PEND-…»): recibe la cédula real
    if not exists (select 1 from productores.productor where num_doc = v_doc) then
      update productores.productor pr set num_doc = v_doc
        from productores.predio pd
       where pd.cod_humboldt = nullif(upper(trim(coalesce(p->>'id_predio', ''))), '')
         and pd.productor_id = pr.id and pr.num_doc like 'PEND-%';
    end if;
    select id, cod_dpto into v_prod, v_pdpto from productores.productor where num_doc = v_doc;$v$);
  nuevo := replace(nuevo,
$v$      if v_predprod <> v_prod then$v$,
$v$      if v_predprod <> v_prod and exists (select 1 from productores.productor
                                           where id = v_predprod and num_doc like 'PEND-%') then
        update productores.predio set productor_id = v_prod where id = v_pred;
        v_predprod := v_prod;
      end if;
      if v_predprod <> v_prod then$v$);
  if nuevo = def or position('PEND-%' in nuevo) = 0 then
    raise exception 'No se pudo ajustar procesar_kobo';
  end if;
  execute nuevo;
end $$;

-- Limpieza: la tabla de carga ya no se necesita
drop table privado.carga_zap;
