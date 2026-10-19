-- =====================================================================
--  SIP-CBS · Lotes sin superposición (ajuste automático)
--
--  Al guardar un lote (web, QGIS o QField) la base:
--    1. Lo recorta al límite de su predio.
--    2. Le quita lo que se monte sobre otros lotes del mismo predio.
--    3. Elimina astillas menores a 1 m².
--  Si no le queda área libre, rechaza el guardado con un mensaje.
--
--  Al final corrige los lotes que ya están superpuestos: el lote más
--  reciente conserva su forma y los anteriores se ajustan.
--  Se puede ejecutar varias veces. No borra lotes.
-- =====================================================================
set search_path = productores, extensions, public;

-- Quita fragmentos menores a un área mínima (m²) que dejan los recortes
create or replace function productores.quitar_astillas(g geometry, min_m2 numeric default 1)
returns geometry
language sql immutable
set search_path = productores, extensions, public
as $$
  select ST_Multi(ST_Collect(d.geom))
    from ST_Dump(g) d
   where ST_Area(d.geom::geography) >= min_m2
$$;

create or replace function productores.tg_lote()
returns trigger
language plpgsql
security definer
set search_path = productores, extensions, public
as $$
declare
  v_predio      productores.predio%rowtype;
  v_otros       geometry;
  v_area_orig   numeric;
begin
  new.geom := productores.limpiar_poligono(new.geom);
  if new.geom is not null and ST_IsEmpty(new.geom) then
    new.geom := null;
  end if;

  if tg_op = 'UPDATE' then
    -- El lote no cambia de predio ni de código
    new.predio_id := old.predio_id;
    new.num_lote  := old.num_lote;
    new.cod_lote  := old.cod_lote;
  end if;

  -- Si no trae predio, se asigna el predio que contiene su centro
  if new.predio_id is null and new.geom is not null then
    select p.id into new.predio_id
      from productores.predio p
     where p.geom is not null
       and ST_Intersects(p.geom, ST_PointOnSurface(new.geom))
     limit 1;
  end if;
  if new.predio_id is null then
    raise exception 'El lote debe pertenecer a un predio. Dibújelo dentro de un predio o selecciónelo.';
  end if;

  select * into v_predio from productores.predio where id = new.predio_id for update;

  -- Ajuste automático de la forma del lote
  if new.geom is not null then
    v_area_orig := ST_Area(new.geom::geography);

    -- 1) Recortar al límite del predio
    if v_predio.geom is not null then
      new.geom := productores.limpiar_poligono(ST_Intersection(new.geom, v_predio.geom));
    end if;

    -- 2) Quitar lo que se monta sobre los demás lotes del mismo predio
    select ST_Union(l.geom) into v_otros
      from productores.lote l
     where l.predio_id = new.predio_id
       and l.id <> new.id
       and l.geom is not null;
    if v_otros is not null and new.geom is not null then
      new.geom := productores.limpiar_poligono(ST_Difference(new.geom, v_otros));
    end if;

    -- 3) Eliminar astillas (< 1 m²)
    if new.geom is not null and not ST_IsEmpty(new.geom) then
      new.geom := productores.quitar_astillas(new.geom, 1);
    end if;

    if new.geom is null or ST_IsEmpty(new.geom) then
      raise exception 'El lote no tiene área libre dentro del predio %: queda por fuera o encima de otros lotes.',
        v_predio.cod_predio;
    end if;
  end if;

  if new.geom is not null then
    new.area_sig_ha := round((ST_Area(new.geom::geography) / 10000)::numeric, 4);
  else
    new.area_sig_ha := null;
  end if;

  if tg_op = 'INSERT' then
    if new.num_lote is null then
      select coalesce(max(num_lote), 0) + 1 into new.num_lote
        from productores.lote where predio_id = new.predio_id;
    end if;
    new.cod_lote := v_predio.cod_predio || '-L' || lpad(new.num_lote::text, 2, '0');
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- Corregir los lotes existentes (del más antiguo al más reciente)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id, cod_lote from productores.lote
            where geom is not null
            order by predio_id, num_lote loop
    begin
      update productores.lote set geom = geom where id = r.id;
    exception when others then
      raise notice 'No se pudo ajustar %: %', r.cod_lote, sqlerrm;
    end;
  end loop;
end $$;

-- Resultado
select cod_lote, area_sig_ha from productores.lote order by cod_lote;
