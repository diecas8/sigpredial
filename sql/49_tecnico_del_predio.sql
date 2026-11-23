-- 49 · Técnico responsable del predio para la ficha predial
-- Devuelve el técnico activo asignado al municipio del predio (usuario_municipio).
-- Si hay más de uno, los une con coma; si no hay ninguno, devuelve null y la
-- ficha usa el nombre de quien la genera. Respeta el permiso de ver el predio.
create or replace function productores.tecnico_del_predio(p_predio uuid)
returns text
language sql stable security definer
set search_path = productores, public
as $$
  select string_agg(ua.nombre, ', ' order by ua.nombre)
    from productores.predio p
    join productores.usuario_municipio um on um.cod_mpio = p.cod_mpio
    join productores.usuario_app ua on ua.user_id = um.user_id
   where p.id = p_predio
     and ua.rol = 'tecnico' and ua.activo
     and productores.ve_predio(p.id);
$$;
revoke all on function productores.tecnico_del_predio(uuid) from public, anon;
grant execute on function productores.tecnico_del_predio(uuid) to authenticated;
