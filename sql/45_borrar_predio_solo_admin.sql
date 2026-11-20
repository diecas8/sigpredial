-- 45 · Eliminar predio: solo el administrador (pedido de Diego, 20-11-2026).
-- Técnicos y coordinadores siguen pudiendo «Quitar límite» (borra lo dibujado y conserva el predio).
drop policy if exists predio_borrar on productores.predio;
create policy predio_borrar on productores.predio for delete to authenticated
  using (productores.es_admin());
