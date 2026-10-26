-- =====================================================================
-- 11a · Preparación para el flujo con Kobo
-- ---------------------------------------------------------------------
--  a) Búsqueda sin tildes ni mayúsculas (función buscar).
--  b) Veredas: origen (oficial / campo) y validación. Se cargan las
--     1275 veredas del Caquetá con el MISMO código que usa el formulario
--     de Kobo (veredas.csv). Las que agregan los técnicos quedan "por validar".
--     No se permiten nombres repetidos en un municipio aunque cambien
--     tildes o mayúsculas ("Agualinda" = "agualinda" = "Agualínda").
--  c) Catálogos alineados con Kobo: tipo de documento (PAS), sexo
--     (Intersexual), código Kobo en tenencia y cultivo, y cultivos
--     amazónicos (caucho, copoazú, arazá, forrajes, forestal maderable).
--  d) v_predio: estado del límite (Delimitado / Pendiente de delimitar).
-- =====================================================================

-- a) Búsqueda sin tildes -------------------------------------------------
create extension if not exists unaccent with schema extensions;

create or replace function productores.f_normalizar(t text)
returns text language sql immutable parallel safe
set search_path to 'extensions', 'public'
as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))) $$;

-- b) Veredas -------------------------------------------------------------
alter table productores.vereda
  add column if not exists origen   text    not null default 'campo',
  add column if not exists validada boolean not null default false;
alter table productores.vereda drop constraint if exists ck_vereda_origen;
alter table productores.vereda add constraint ck_vereda_origen check (origen in ('oficial', 'campo'));
update productores.vereda set validada = true where true;   -- las que ya existían quedan validadas

create unique index if not exists uq_vereda_nombre_norm
  on productores.vereda (cod_mpio, productores.f_normalizar(nombre));
create unique index if not exists uq_vereda_codigo
  on productores.vereda (cod_vereda) where cod_vereda is not null;

-- Un técnico solo puede crear veredas "de campo" y sin validar; validan coordinadores
drop policy if exists vereda_crear on productores.vereda;
create policy vereda_crear on productores.vereda for insert to authenticated
  with check (productores.usuario_activo()
              and (productores.es_coordinador() or (validada = false and origen = 'campo')));

-- (las veredas se cargan en 11b_veredas_caqueta.sql)

-- c) Catálogos alineados con Kobo ----------------------------------------
alter table productores.productor drop constraint if exists productor_tipo_doc_check;
alter table productores.productor add constraint productor_tipo_doc_check
  check (tipo_doc = any (array['CC','TI','CE','PPT','PAS','NIT','Otro']));
alter table productores.productor drop constraint if exists productor_sexo_check;
alter table productores.productor add constraint productor_sexo_check
  check (sexo = any (array['Mujer','Hombre','Intersexual']));

alter table productores.tenencia add column if not exists codigo text unique;
update productores.tenencia t set codigo = c.codigo from (values
  ('Propietario','propietario'), ('Poseedor','poseedor'), ('Arrendatario','arrendatario'),
  ('Comodato','comodato'), ('Usufructo','usufructo'), ('Sucesión ilíquida','sucesion'),
  ('Ocupante de baldío','ocupante'), ('Otro','otro')) c(nombre, codigo)
where t.nombre = c.nombre;

alter table productores.cultivo add column if not exists codigo text unique;
insert into productores.cultivo (nombre, tipo) values
  ('Caucho', 'Permanente'), ('Copoazú', 'Permanente'), ('Arazá', 'Permanente'),
  ('Forrajes / bancos de forraje', 'Pecuario'), ('Forestal maderable', 'Forestal')
on conflict (nombre) do nothing;
update productores.cultivo k set codigo = c.codigo from (values
  ('Café','cafe'), ('Cacao','cacao'), ('Caucho','caucho'), ('Plátano','platano'), ('Banano','banano'),
  ('Yuca','yuca'), ('Maíz','maiz'), ('Arroz','arroz'), ('Fríjol','frijol'), ('Caña panelera','cana'),
  ('Piña','pina'), ('Copoazú','copoazu'), ('Arazá','araza'), ('Aguacate','aguacate'),
  ('Cítricos','citricos'), ('Maracuyá','maracuya'), ('Palma de aceite','palma'),
  ('Hortalizas','hortalizas'), ('Forrajes / bancos de forraje','forrajes'),
  ('Forestal maderable','maderable'), ('Otro','otro')) c(nombre, codigo)
where k.nombre = c.nombre;

-- d) Estado del límite en v_predio (columnas nuevas al final) -------------
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
    v.validada AS vereda_validada
   FROM productores.predio p
     JOIN productores.productor pr ON pr.id = p.productor_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     LEFT JOIN productores.vereda v ON v.id = p.vereda_id
     LEFT JOIN productores.tenencia t ON t.id = p.tenencia_id;

-- a) Función de búsqueda (respeta los permisos de cada usuario) -----------
create or replace function productores.buscar(q text)
returns jsonb
language sql stable security invoker
set search_path to 'productores', 'extensions', 'public'
as $$
  with palabras as (
    select array_agg(w) as w
      from unnest(regexp_split_to_array(productores.f_normalizar(trim(q)), '\s+')) w where w <> ''
  )
  select jsonb_build_object(
    'productores', coalesce((
      select jsonb_agg(x order by x->>'nombres') from (
        select jsonb_build_object('id', p.id, 'num_doc', p.num_doc, 'nombres', p.nombres, 'apellidos', p.apellidos) x
          from productores.productor p, palabras
         where palabras.w is not null
           and (select bool_and(productores.f_normalizar(p.num_doc || ' ' || p.nombres || ' ' || coalesce(p.apellidos, ''))
                                like '%' || w || '%') from unnest(palabras.w) w)
         limit 30) s), '[]'::jsonb),
    'predios', coalesce((
      select jsonb_agg(x order by x->>'cod_predio') from (
        select jsonb_build_object('id', v.id, 'cod_predio', v.cod_predio, 'nombre', v.nombre,
                                  'productor_id', v.productor_id, 'productor', v.productor) x
          from productores.v_predio v, palabras
         where palabras.w is not null
           and (select bool_and(productores.f_normalizar(v.cod_predio || ' ' || v.nombre || ' ' ||
                                coalesce(v.vereda, '') || ' ' || v.municipio) like '%' || w || '%')
                  from unnest(palabras.w) w)
         limit 30) s), '[]'::jsonb));
$$;

revoke execute on function productores.buscar(text) from public, anon;
grant execute on function productores.buscar(text) to authenticated;
revoke execute on function productores.f_normalizar(text) from anon;
