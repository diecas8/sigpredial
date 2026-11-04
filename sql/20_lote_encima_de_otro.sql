-- =========================================================================
--  20 · Dibujar un lote encima de otro ya existente
--  Por defecto, un lote nuevo se ajusta al espacio libre (los lotes que ya
--  existen tienen prioridad). Con estas funciones el portal puede ofrecer lo
--  contrario: abrirle espacio al lote nuevo recortando los lotes de abajo.
--   lotes_bajo()        → qué lotes quedan debajo y cuánta área se monta.
--   abrir_espacio_lote() → recorta esos lotes (los lotes conservan sus datos).
--  Ambas respetan los permisos del usuario (security invoker).
-- =========================================================================
create or replace function productores.lotes_bajo(p_predio uuid, p_geom text, p_excluir uuid default null)
returns table (id uuid, cod_lote text, cultivo text, area_solape_ha numeric, area_queda_ha numeric)
language sql stable
set search_path = productores, extensions, public as $$
  with g as (
    select ST_MakeValid(ST_SetSRID(ST_GeomFromEWKT(p_geom), 4326)) as geom
  )
  select l.id, l.cod_lote, c.nombre,
         productores.area_ha(ST_CollectionExtract(ST_Intersection(l.geom, g.geom), 3)),
         productores.area_ha(ST_CollectionExtract(ST_Difference(l.geom, g.geom), 3))
    from productores.lote l
    cross join g
    left join productores.cultivo c on c.id = l.cultivo_id
   where l.predio_id = p_predio
     and l.geom is not null
     and (p_excluir is null or l.id <> p_excluir)
     and ST_Intersects(l.geom, g.geom)
     and ST_Area(ST_Intersection(l.geom, g.geom)::geography) >= 1
   order by l.num_lote
$$;

create or replace function productores.abrir_espacio_lote(p_predio uuid, p_geom text, p_lotes uuid[])
returns integer
language plpgsql volatile
set search_path = productores, extensions, public as $$
declare
  g geometry := ST_MakeValid(ST_SetSRID(ST_GeomFromEWKT(p_geom), 4326));
  r record; resto geometry; n integer := 0; k integer;
begin
  for r in select l.id, l.cod_lote, l.geom from productores.lote l
            where l.predio_id = p_predio and l.id = any(p_lotes) and l.geom is not null
  loop
    resto := ST_CollectionExtract(ST_Difference(r.geom, g), 3);
    if resto is null or ST_IsEmpty(resto) or ST_Area(resto::geography) < 1 then
      raise exception 'El lote % quedaría completamente cubierto por el nuevo. Elimínelo o edítelo antes.', r.cod_lote;
    end if;
    update productores.lote set geom = ST_Multi(resto) where id = r.id;
    get diagnostics k = row_count;
    if k = 0 then
      raise exception 'No tiene permiso para modificar el lote %.', r.cod_lote;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function productores.lotes_bajo(uuid, text, uuid) from public, anon;
revoke all on function productores.abrir_espacio_lote(uuid, text, uuid[]) from public, anon;
grant execute on function productores.lotes_bajo(uuid, text, uuid) to authenticated;
grant execute on function productores.abrir_espacio_lote(uuid, text, uuid[]) to authenticated;
