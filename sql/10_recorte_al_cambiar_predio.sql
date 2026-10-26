-- =====================================================================
-- 10 · Recorte de lotes y elementos al cambiar el límite del predio
-- ---------------------------------------------------------------------
-- Antes: si se achicaba el límite de un predio, sus lotes y elementos
-- lineales quedaban por fuera (solo se recortaban al guardarlos de nuevo).
-- Ahora, al guardar un límite nuevo:
--   1. Si algún lote, línea o punto queda COMPLETAMENTE por fuera, el
--      cambio se rechaza con un mensaje que dice cuáles son (para que el
--      técnico ajuste el límite o elimine/mueva esos elementos primero).
--   2. Los lotes y líneas que quedan PARCIALMENTE por fuera se recortan
--      al nuevo límite (con las mismas reglas de siempre: tg_lote y
--      tg_elemento_linea recalculan área, longitud y superposiciones).
-- =====================================================================

create or replace function productores.tg_predio_recortar()
returns trigger
language plpgsql
security definer
set search_path to 'productores', 'extensions', 'public'
as $function$
declare
  v_fuera text;
begin
  if new.geom is null or new.geom is not distinct from old.geom then
    return null;
  end if;

  -- 1) Lo que quedaría completamente por fuera del nuevo límite
  select string_agg(x, ', ' order by x) into v_fuera from (
    select 'lote ' || l.cod_lote as x
      from productores.lote l
     where l.predio_id = new.id and l.geom is not null
       and coalesce(ST_Area(ST_Intersection(l.geom, new.geom)::geography), 0) < 1
    union all
    select 'línea ' || coalesce(t.nombre, 'elemento') || coalesce(' «' || e.nombre || '»', '')
      from productores.elemento_linea e left join productores.tipo_elemento t on t.id = e.tipo_id
     where e.predio_id = new.id and e.geom is not null and not ST_Intersects(e.geom, new.geom)
    union all
    select 'punto ' || coalesce(t.nombre, 'elemento') || coalesce(' «' || e.nombre || '»', '')
      from productores.elemento_punto e left join productores.tipo_elemento t on t.id = e.tipo_id
     where e.predio_id = new.id and e.geom is not null
       and not ST_DWithin(new.geom::geography, e.geom::geography, 5)
  ) s;

  if v_fuera is not null then
    raise exception 'El nuevo límite deja por fuera del predio %: %. Ajuste el límite, o mueva o elimine esos elementos primero.',
      new.cod_predio, v_fuera;
  end if;

  -- 2) Recortar lo que queda parcialmente por fuera (los disparadores de cada tabla hacen el recorte)
  update productores.lote l set geom = l.geom
   where l.predio_id = new.id and l.geom is not null and not ST_CoveredBy(l.geom, new.geom);

  update productores.elemento_linea e set geom = e.geom
   where e.predio_id = new.id and e.geom is not null and not ST_CoveredBy(e.geom, new.geom);

  return null;
end
$function$;

revoke execute on function productores.tg_predio_recortar() from public, anon, authenticated;

drop trigger if exists t30_predio_recortar on productores.predio;
create trigger t30_predio_recortar
  after update of geom on productores.predio
  for each row execute function productores.tg_predio_recortar();
