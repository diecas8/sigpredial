-- =========================================================================
--  24 · «Mi trabajo reciente»
--  Los predios que el usuario tocó (límite, datos, lotes, elementos, plan,
--  ficha), del más reciente al más antiguo, con lo último que hizo.
--  Se calcula con las columnas de auditoría; respeta los permisos (RLS) de
--  quien consulta.
-- =========================================================================
create or replace function productores.mi_trabajo_reciente(p_limite integer default 30)
returns jsonb language sql stable security invoker
set search_path = productores, public as $$
  with yo as (select auth.uid() as uid),
  ev as (
    -- Predio: creado, delimitado o editado
    select p.id as predio_id, p.creado_en as fecha, 'Registró el predio' as accion
      from productores.predio p, yo where p.creado_por = yo.uid
    union all
    select p.id, p.editado_en,
           case when p.delimitado_en is not null and abs(extract(epoch from p.editado_en - p.delimitado_en)) < 60
                then 'Delimitó el límite' else 'Editó los datos del predio' end
      from productores.predio p, yo where p.editado_por = yo.uid and p.editado_en is not null
    union all
    -- Lotes actuales y de la finca soñada
    select l.predio_id, l.creado_en,
           'Agregó ' || case when l.escenario = 'propuesto' then 'lote propuesto ' else 'lote ' end || right(l.cod_lote, 3)
      from productores.lote l, yo where l.creado_por = yo.uid
    union all
    select l.predio_id, l.editado_en,
           'Editó ' || case when l.escenario = 'propuesto' then 'lote propuesto ' else 'lote ' end || right(l.cod_lote, 3)
      from productores.lote l, yo where l.editado_por = yo.uid and l.editado_en is not null
    union all
    -- Elementos (agua, vías, vivienda…)
    select e.predio_id, greatest(e.creado_en, coalesce(e.editado_en, e.creado_en)), 'Elemento: ' || t.nombre
      from productores.elemento_linea e join productores.tipo_elemento t on t.id = e.tipo_id, yo
     where e.predio_id is not null and (e.creado_por = yo.uid or e.editado_por = yo.uid)
    union all
    select e.predio_id, greatest(e.creado_en, coalesce(e.editado_en, e.creado_en)), 'Elemento: ' || t.nombre
      from productores.elemento_punto e join productores.tipo_elemento t on t.id = e.tipo_id, yo
     where e.predio_id is not null and (e.creado_por = yo.uid or e.editado_por = yo.uid)
    union all
    -- Plan de acción y ficha
    select a.predio_id, greatest(a.creado_en, coalesce(a.editado_en, a.creado_en)), 'Plan: ' || c.nombre
      from productores.plan_accion a join productores.catalogo_accion c on c.id = a.accion_id, yo
     where a.creado_por = yo.uid or a.editado_por = yo.uid
    union all
    select f.predio_id, f.generado_en, 'Guardó la ficha predial'
      from productores.ficha_predial f, yo where f.generado_por = yo.uid
  ),
  ult as (
    select distinct on (predio_id) predio_id, fecha, accion,
           count(*) over (partition by predio_id) as cambios
      from ev where fecha is not null
     order by predio_id, fecha desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'predio_id', v.id, 'productor_id', v.productor_id, 'cod_predio', v.cod_predio, 'nombre', v.nombre,
           'productor', v.productor, 'vereda', v.vereda, 'municipio', v.municipio,
           'accion', u.accion, 'fecha', u.fecha, 'cambios', u.cambios, 'delimitado', v.geojson is not null)
         order by u.fecha desc), '[]'::jsonb)
    from (select * from ult order by fecha desc limit greatest(1, least(coalesce(p_limite, 30), 100))) u
    join productores.v_predio v on v.id = u.predio_id
$$;
revoke all on function productores.mi_trabajo_reciente(integer) from public, anon;
grant execute on function productores.mi_trabajo_reciente(integer) to authenticated;
