-- =====================================================================
-- 15 · Fichas prediales en PDF y vistas nuevas para Access
-- ---------------------------------------------------------------------
--  · Almacenamiento privado «fichas»: un PDF por predio (<predio_id>/ficha.pdf).
--    Lo sube el portal (botón «Guardar en Sigpredial» de la ficha predial);
--    cada usuario solo puede ver/subir fichas de los predios de su departamento.
--  · productores.ficha_predial: cuándo y quién guardó la última ficha.
--  · Access (lector_oficina):
--      r_productores  + departamento
--      r_predios      + código Humboldt, estado del límite, vereda validada,
--                       precisión GPS, caracterización y ficha
--      r_caracterizaciones (nueva): una fila por encuesta de Kobo
--      r_usos_declarados   (nueva): una fila por uso del suelo declarado
--      r_fichas            (nueva): enlace para abrir el PDF de cada ficha
--                       (solo lector_oficina y sig_editor; lleva la clave de oficina)
-- =====================================================================

-- 1) Almacenamiento privado de fichas ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fichas', 'fichas', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- ¿El usuario puede ver el predio de la carpeta «<predio_id>/…»?
create or replace function productores.ve_ruta_ficha(p_nombre text)
returns boolean language sql stable security definer set search_path to ''
as $$
  select case when (storage.foldername(p_nombre))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then productores.ve_predio(((storage.foldername(p_nombre))[1])::uuid)
              else false end
$$;
revoke execute on function productores.ve_ruta_ficha(text) from public, anon;
grant execute on function productores.ve_ruta_ficha(text) to authenticated;

drop policy if exists fichas_ver on storage.objects;
create policy fichas_ver on storage.objects for select to authenticated
  using (bucket_id = 'fichas' and productores.ve_ruta_ficha(name));
drop policy if exists fichas_subir on storage.objects;
create policy fichas_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fichas' and productores.usuario_activo() and productores.ve_ruta_ficha(name));
drop policy if exists fichas_reemplazar on storage.objects;
create policy fichas_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'fichas' and productores.ve_ruta_ficha(name))
  with check (bucket_id = 'fichas' and productores.ve_ruta_ficha(name));

-- 2) Registro de fichas -------------------------------------------------------
create table if not exists productores.ficha_predial (
  predio_id    uuid primary key references productores.predio (id) on delete cascade,
  ruta         text not null,
  version      int not null default 1,
  generado_por uuid default productores.usuario_actual(),
  generado_en  timestamptz not null default now()
);
alter table productores.ficha_predial enable row level security;
drop policy if exists ficha_ver on productores.ficha_predial;
create policy ficha_ver on productores.ficha_predial for select to authenticated
  using (productores.ve_predio(predio_id));
drop policy if exists ficha_crear on productores.ficha_predial;
create policy ficha_crear on productores.ficha_predial for insert to authenticated
  with check (productores.usuario_activo() and productores.ve_predio(predio_id));
drop policy if exists ficha_editar on productores.ficha_predial;
create policy ficha_editar on productores.ficha_predial for update to authenticated
  using (productores.ve_predio(predio_id)) with check (productores.ve_predio(predio_id));
drop policy if exists ficha_arcgis on productores.ficha_predial;
create policy ficha_arcgis on productores.ficha_predial for select to arcgis_lector using (true);
drop policy if exists ficha_sig_editor on productores.ficha_predial;
create policy ficha_sig_editor on productores.ficha_predial for all to sig_editor using (true) with check (true);
revoke all on productores.ficha_predial from anon;
grant select, insert, update on productores.ficha_predial to authenticated;
grant select on productores.ficha_predial to arcgis_lector;
grant all on productores.ficha_predial to sig_editor, service_role;

-- El portal llama esto después de subir el PDF (respeta los permisos del usuario)
create or replace function productores.registrar_ficha(p_predio uuid)
returns jsonb language sql security invoker set search_path to ''
as $$
  insert into productores.ficha_predial (predio_id, ruta, generado_por)
  values (p_predio, p_predio::text || '/ficha.pdf', (select auth.uid()))
  on conflict (predio_id) do update
    set version = productores.ficha_predial.version + 1, generado_en = now(), generado_por = (select auth.uid())
  returning jsonb_build_object('predio_id', predio_id, 'version', version, 'generado_en', generado_en)
$$;
revoke execute on function productores.registrar_ficha(uuid) from public, anon;
grant execute on function productores.registrar_ficha(uuid) to authenticated;

-- 3) Clave de la oficina (enlaces de Access) -----------------------------------
insert into privado.config (clave, valor)
values ('oficina_clave', encode(extensions.gen_random_bytes(18), 'hex'))
on conflict (clave) do nothing;

create or replace function productores.clave_oficina_valida(k text)
returns boolean language sql stable security definer set search_path to ''
as $$ select k is not null and k = (select valor from privado.config where clave = 'oficina_clave') $$;
revoke execute on function productores.clave_oficina_valida(text) from public, anon, authenticated;
grant execute on function productores.clave_oficina_valida(text) to service_role;

-- 4) Vistas para Access ----------------------------------------------------------
create or replace view productores.r_productores with (security_invoker = true) as
select (pr.id)::text AS id, pr.tipo_doc, pr.num_doc, pr.nombres, pr.apellidos,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) AS nombre_completo,
       pr.sexo, pr.fecha_nac, pr.telefono, pr.correo, pr.asociacion,
       ((select count(*) from productores.predio p where p.productor_id = pr.id))::integer AS n_predios,
       ((select sum(coalesce(p.area_sig_ha, p.area_declarada_ha)) from productores.predio p
          where p.productor_id = pr.id))::double precision AS area_predios_ha,
       left(pr.observaciones, 255) AS observaciones,
       (pr.creado_en at time zone 'America/Bogota') AS fecha_registro,
       d.nombre AS departamento
  from productores.productor pr
  left join productores.departamento d on d.cod_dpto = pr.cod_dpto;

create or replace view productores.r_predios with (security_invoker = true) as
select p.id::text                          as id,
       p.cod_predio,
       p.nombre                            as predio,
       p.productor_id::text                as productor_id,
       pr.num_doc,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       pr.asociacion,
       d.nombre                            as departamento,
       m.nombre                            as municipio,
       v.nombre                            as vereda,
       t.nombre                            as tenencia,
       p.area_declarada_ha::float8         as area_declarada_ha,
       p.area_sig_ha::float8               as area_sig_ha,
       case when p.area_declarada_ha > 0 and p.area_sig_ha > 0
            then round(100.0 * (p.area_sig_ha - p.area_declarada_ha) / p.area_declarada_ha, 1)::float8
       end                                 as dif_area_pct,
       (select count(*) from productores.lote l where l.predio_id = p.id)::int as n_lotes,
       (select sum(coalesce(l.area_sig_ha, l.area_declarada_ha)) from productores.lote l
         where l.predio_id = p.id)::float8 as area_lotes_ha,
       (select count(*) from productores.elemento_punto e join productores.tipo_elemento te on te.id = e.tipo_id
         where e.predio_id = p.id and te.nombre = 'Nacimiento / afloramiento')::int as n_nacimientos,
       (select round(sum(e.longitud_m)) from productores.elemento_linea e join productores.tipo_elemento te on te.id = e.tipo_id
         where e.predio_id = p.id and te.grupo = 'Hídrico')::float8 as m_cauces,
       (select round(sum(e.longitud_m)) from productores.elemento_linea e join productores.tipo_elemento te on te.id = e.tipo_id
         where e.predio_id = p.id and te.grupo = 'Vial')::float8 as m_vias,
       round(ST_Y(p.punto)::numeric, 6)::float8 as latitud,
       round(ST_X(p.punto)::numeric, 6)::float8 as longitud,
       p.altitud_msnm,
       left(p.como_llegar, 255)            as como_llegar,
       (p.creado_en  at time zone 'America/Bogota') as fecha_registro,
       (p.editado_en at time zone 'America/Bogota') as fecha_edicion,
       -- nuevas (sql 15)
       p.cod_humboldt,
       case when p.geom is null then 'Pendiente de delimitar' else 'Delimitado' end as estado_limite,
       case when v.id is null then null when v.validada then 'Sí' else 'Por validar' end as vereda_validada,
       p.gps_precision_m::float8           as gps_precision_m,
       (select max(c.fecha_visita) from productores.caracterizacion c
         where c.predio_id = p.id and c.estado = 'procesada') as fecha_caracterizacion,
       (select (f.generado_en at time zone 'America/Bogota') from productores.ficha_predial f
         where f.predio_id = p.id)          as fecha_ficha_pdf
  from productores.predio p
  join productores.productor pr    on pr.id = p.productor_id
  join productores.municipio m     on m.cod_mpio = p.cod_mpio
  join productores.departamento d  on d.cod_dpto = m.cod_dpto
  left join productores.vereda v   on v.id = p.vereda_id
  left join productores.tenencia t on t.id = p.tenencia_id;

-- Una fila por encuesta de caracterización (campos de texto cortados a 255 para Access)
create or replace view productores.r_caracterizaciones with (security_invoker = true) as
select c.id::text                                   as id,
       c.estado,
       c.fecha_visita,
       c.tecnico,
       c.kobo_usuario,
       c.proyecto,
       d.nombre                                     as departamento,
       m.nombre                                     as municipio,
       ve.nombre                                    as vereda,
       p.cod_predio,
       p.cod_humboldt,
       p.nombre                                     as predio,
       pr.num_doc,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       nullif(c.datos->>'nucleo_zap', '')           as nucleo_zap,
       nullif(c.datos->>'informante_es_propietario', '') as responde_propietario,
       nullif(c.datos->>'informante_relacion', '')  as relacion_informante,
       nullif(c.datos->>'personas_hogar', '')::int  as personas_hogar,
       nullif(c.datos->>'mujeres', '')::int         as mujeres,
       nullif(c.datos->>'ninos', '')::int           as ninos,
       nullif(c.datos->>'jovenes', '')::int         as jovenes,
       nullif(c.datos->>'adultos_mayores', '')::int as adultos_mayores,
       nullif(c.datos->>'discapacidad', '')::int    as discapacidad,
       nullif(c.datos->>'grupo_diferencial', '')    as grupo_diferencial,
       nullif(c.datos->>'mujer_cabeza', '')         as jefatura_femenina,
       nullif(c.datos->>'servicios', '')            as servicios,
       nullif(c.datos->>'fuente_agua_consumo', '')  as fuente_agua,
       nullif(c.datos->>'infraestructura', '')      as infraestructura,
       nullif(c.datos->>'acceso_via', '')           as acceso_via,
       nullif(c.datos->>'area_declarada_ha', '')::float8 as area_declarada_ha,
       nullif(c.datos->>'lineas_productivas', '')   as lineas_productivas,
       nullif(c.datos->>'autoconsumo', '')          as autoconsumo,
       nullif(c.datos->>'huerta', '')               as huerta,
       nullif(c.datos->>'principal_ingreso', '')    as principal_ingreso,
       nullif(c.datos->>'asistencia_tecnica', '')   as asistencia_tecnica,
       nullif(c.datos->>'pertenece_asociacion', '') as pertenece_asociacion,
       left(nullif(c.datos->>'nombre_asociacion', ''), 255) as asociacion,
       nullif(c.datos->>'tiene_fuentes', '')        as fuentes_hidricas,
       nullif(c.datos->>'tiene_conservacion', '')   as areas_conservacion,
       nullif(c.datos->>'area_conservacion_ha', '')::float8 as area_conservacion_ha,
       nullif(c.datos->>'tiene_degradadas', '')     as areas_degradadas,
       nullif(c.datos->>'tipo_degradacion', '')     as tipo_degradacion,
       nullif(c.datos->>'conectividad', '')         as conectividad,
       nullif(c.datos->>'determinantes', '')        as determinantes,
       nullif(c.datos->>'conflicto_uso', '')        as conflicto_uso,
       left(nullif(c.datos->>'problematicas', ''), 255)     as problematicas,
       left(nullif(c.datos->>'oportunidades', ''), 255)     as oportunidades,
       left(nullif(c.datos->>'intereses_familia', ''), 255) as intereses_familia,
       left(nullif(c.datos->>'observaciones_generales', ''), 255) as observaciones,
       left(c.error, 255)                           as error,
       (c.recibido_en at time zone 'America/Bogota') as fecha_registro
  from productores.caracterizacion c
  left join productores.predio p        on p.id = c.predio_id
  left join productores.productor pr    on pr.id = c.productor_id
  left join productores.municipio m     on m.cod_mpio = coalesce(p.cod_mpio, c.datos->>'municipio')
  left join productores.departamento d  on d.cod_dpto = coalesce(m.cod_dpto, c.cod_dpto)
  left join productores.vereda ve       on ve.id = p.vereda_id;

-- Una fila por uso del suelo declarado en la encuesta
create or replace view productores.r_usos_declarados with (security_invoker = true) as
select c.id::text || '-' || u.n                     as id,
       c.id::text                                   as caracterizacion_id,
       c.fecha_visita,
       d.nombre                                     as departamento,
       m.nombre                                     as municipio,
       ve.nombre                                    as vereda,
       p.cod_predio,
       p.cod_humboldt,
       p.nombre                                     as predio,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       replace(u.uso->>'tipo_uso', '_', ' ')        as tipo_uso,
       replace(nullif(u.uso->>'cultivo_cual', ''), '_', ' ') as cultivo,
       left(nullif(u.uso->>'uso_otro', ''), 255)    as otro_uso,
       nullif(u.uso->>'area_uso_ha', '')::float8    as area_ha,
       nullif(u.uso->>'estado_uso', '')             as estado,
       left(nullif(u.uso->>'uso_obs', ''), 255)     as observaciones,
       (c.recibido_en at time zone 'America/Bogota') as fecha_registro
  from productores.caracterizacion c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.datos->'usos_suelo') = 'array'
                                               then c.datos->'usos_suelo' else '[]'::jsonb end)
       with ordinality as u(uso, n)
  join productores.predio p            on p.id = c.predio_id
  join productores.productor pr        on pr.id = p.productor_id
  join productores.municipio m         on m.cod_mpio = p.cod_mpio
  join productores.departamento d      on d.cod_dpto = m.cod_dpto
  left join productores.vereda ve      on ve.id = p.vereda_id
 where c.estado = 'procesada';

-- Enlace a la ficha PDF (lleva la clave de oficina: solo Access y QGIS)
create or replace view productores.r_fichas as
select p.id::text                              as id,
       p.cod_predio,
       p.nombre                                as predio,
       trim(pr.nombres || ' ' || coalesce(pr.apellidos, '')) as productor,
       d.nombre                                as departamento,
       m.nombre                                as municipio,
       f.version,
       (f.generado_en at time zone 'America/Bogota') as fecha_registro,
       u.nombre                                as generada_por,
       'https://usbqciezxkbyixqlnlhm.supabase.co/functions/v1/ficha-pdf?predio=' || p.id::text ||
         '&k=' || (select valor from privado.config where clave = 'oficina_clave') as url_ficha
  from productores.ficha_predial f
  join productores.predio p           on p.id = f.predio_id
  join productores.productor pr       on pr.id = p.productor_id
  join productores.municipio m        on m.cod_mpio = p.cod_mpio
  join productores.departamento d     on d.cod_dpto = m.cod_dpto
  left join productores.usuario_app u on u.user_id = f.generado_por;
revoke all on productores.r_fichas from public, anon, authenticated, arcgis_lector;
grant select on productores.r_fichas to lector_oficina, sig_editor;

grant select on productores.r_productores, productores.r_predios,
                productores.r_caracterizaciones, productores.r_usos_declarados
   to arcgis_lector, lector_oficina, sig_editor, service_role, authenticated;
revoke all on productores.r_caracterizaciones, productores.r_usos_declarados from anon;
