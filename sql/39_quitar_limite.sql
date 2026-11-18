-- =====================================================================
-- 39 · Quitar el límite del predio sin borrar el predio
-- ---------------------------------------------------------------------
-- Para rehacer la delimitación (o limpiar una práctica): borra el
-- límite y todo lo dibujado adentro (lotes actuales y de la finca
-- soñada, líneas, puntos y áreas) y devuelve el punto del predio a la
-- ubicación GPS de la visita (punto_visita). Al dibujar el límite, el
-- punto se había movido al interior del dibujo.
--
-- Se conservan: el predio con su código, el productor, la encuesta, la
-- plancha y las acciones del plan (quedan sin lote). Lo borrado queda
-- en la papelera. Mismo permiso que eliminar el predio: usuario activo
-- del departamento del predio.
-- =====================================================================
create or replace function productores.quitar_limite(p_predio uuid)
returns jsonb
language plpgsql security definer
set search_path to 'productores', 'extensions', 'public'
as $$
declare
  v record;
  n_lotes int; n_lineas int; n_puntos int; n_areas int;
begin
  select id, cod_predio, geom, punto_visita into v from productores.predio where id = p_predio for update;
  if v.id is null then
    raise exception 'El predio no existe.';
  end if;
  if current_user not in ('postgres', 'supabase_admin')
     and not (productores.usuario_activo() and productores.ve_predio(p_predio)) then
    raise exception 'No tiene permiso sobre el predio %.', v.cod_predio;
  end if;
  if v.geom is null then
    raise exception 'El predio % no tiene límite.', v.cod_predio;
  end if;

  delete from productores.lote where predio_id = p_predio;            get diagnostics n_lotes = row_count;
  delete from productores.elemento_linea where predio_id = p_predio;  get diagnostics n_lineas = row_count;
  delete from productores.elemento_punto where predio_id = p_predio;  get diagnostics n_puntos = row_count;
  delete from productores.elemento_area where predio_id = p_predio;   get diagnostics n_areas = row_count;

  update productores.predio set geom = null, punto = coalesce(punto_visita, punto) where id = p_predio;

  return jsonb_build_object('predio', v.cod_predio, 'lotes', n_lotes,
    'elementos', n_lineas + n_puntos + n_areas, 'punto_gps', v.punto_visita is not null);
end $$;
revoke all on function productores.quitar_limite(uuid) from public, anon;
grant execute on function productores.quitar_limite(uuid) to authenticated;
