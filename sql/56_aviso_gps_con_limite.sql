-- 56. Correcciones de GPS en predios que ya tienen límite dibujado
--
-- Cuando el predio tiene límite, el punto del predio lo calcula la base dentro del límite
-- (tg_predio: punto := ST_PointOnSurface(geom)). Aprobar un cambio de GPS no tenía efecto:
-- quedaba «aprobada» pero el punto volvía al límite sin avisar.
-- Ahora:
--   · r_correcciones trae limite_m: distancia del límite al punto propuesto (solo si hay límite).
--   · revisar_correccion no deja aprobar un cambio de punto si el predio tiene límite,
--     y explica qué hacer (rechazar o corregir primero el límite).

create or replace view productores.r_correcciones with (security_invoker = true) as
 SELECT c.id, c.estado, c.campo,
    CASE c.campo
        WHEN 'vereda' THEN 'Vereda' WHEN 'punto' THEN 'Punto del predio'
        WHEN 'num_doc' THEN 'Número de documento' WHEN 'nombre_productor' THEN 'Nombre del productor'
        WHEN 'sexo' THEN 'Sexo' WHEN 'nombre_predio' THEN 'Nombre del predio'
        WHEN 'area' THEN 'Área declarada (ha)' ELSE NULL END AS dato_corregido,
    c.valor_actual, c.valor_nuevo,
    (c.dato ->> 'distancia_m')::numeric AS distancia_m,
    COALESCE(c.dato ->> 'motivo_detalle', c.dato ->> 'motivo') AS motivo,
    c.dato ->> 'observacion' AS observacion,
    p.cod_predio, p.cod_humboldt, p.nombre AS predio, m.nombre AS municipio, d.nombre AS departamento,
    k.fecha_visita, k.tecnico, c.creado_en, c.nota, c.revisado_en,
    ( SELECT u.nombre FROM productores.usuario_app u WHERE u.user_id = c.revisado_por) AS revisado_por,
    c.predio_id, p.productor_id, m.cod_dpto,
    extensions.st_y(p.punto) AS lat_actual, extensions.st_x(p.punto) AS lon_actual,
    (c.dato ->> 'lat')::double precision AS lat_nueva, (c.dato ->> 'lon')::double precision AS lon_nueva,
    (c.dato ->> 'precision_m')::numeric AS precision_m,
    c.caracterizacion_id,
    CASE WHEN c.campo = 'punto' AND p.geom IS NOT NULL AND c.dato ? 'lat' THEN
      round(extensions.st_distance(p.geom::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint((c.dato ->> 'lon')::float8, (c.dato ->> 'lat')::float8), 4326)::extensions.geography)::numeric)
    END AS limite_m
   FROM productores.correccion_predio c
     JOIN productores.predio p ON p.id = c.predio_id
     JOIN productores.municipio m ON m.cod_mpio = p.cod_mpio
     JOIN productores.departamento d ON d.cod_dpto = m.cod_dpto
     JOIN productores.caracterizacion k ON k.id = c.caracterizacion_id;

CREATE OR REPLACE FUNCTION productores.revisar_correccion(p_id uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare c productores.correccion_predio%rowtype; pr productores.predio%rowtype; pd productores.productor%rowtype;
        v_otro uuid; v_dpto text; v_antes jsonb := '{}'::jsonb; v_m numeric;
begin
  select * into c from productores.correccion_predio where id = p_id for update;
  if c.id is null then raise exception 'La propuesta no existe'; end if;
  select * into pr from productores.predio where id = c.predio_id;
  if not (productores.es_coordinador() and productores.ve_predio(pr.id)) then
    raise exception 'Solo el coordinador del departamento puede revisar correcciones';
  end if;
  if c.estado <> 'pendiente' then raise exception 'La propuesta ya fue revisada (%)', c.estado; end if;
  -- Un punto nuevo no se puede aplicar si el predio ya tiene límite: el punto lo define el límite.
  if p_aprobar and c.campo = 'punto' and pr.geom is not null then
    v_m := round(extensions.st_distance(pr.geom::extensions.geography,
             extensions.st_setsrid(extensions.st_makepoint((c.dato->>'lon')::float8, (c.dato->>'lat')::float8), 4326)::extensions.geography)::numeric);
    raise exception 'El predio % ya tiene límite dibujado%. Con límite, el punto del predio lo define el límite, así que este cambio no tendría efecto. Si el límite está bien, rechace la corrección; si el límite está mal ubicado, hay que corregir primero el límite.',
      pr.cod_predio,
      case when v_m = 0 then ' y el punto propuesto cae dentro'
           when v_m >= 1000 then ' a ' || replace(to_char(v_m / 1000, 'FM999990.0'), '.', ',') || ' km del punto propuesto'
           else ' a ' || v_m || ' m del punto propuesto' end;
  end if;
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
end $function$;
