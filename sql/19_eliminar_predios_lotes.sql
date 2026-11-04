-- =========================================================================
--  19 · Eliminar predios y lotes desde el portal
--  Puede eliminar cualquier usuario activo, solo dentro de su departamento
--  (el administrador en todos). El portal pide confirmación antes de borrar.
--  Al eliminar un predio se borran también sus lotes, elementos y ficha
--  (llaves con ON DELETE CASCADE); las encuestas de caracterización se
--  conservan, sin predio asociado.
-- =========================================================================
drop policy if exists predio_borrar on productores.predio;
create policy predio_borrar on productores.predio for delete to authenticated
  using (productores.usuario_activo() and productores.ve_dpto(left(cod_mpio, 2)));

drop policy if exists lote_borrar on productores.lote;
create policy lote_borrar on productores.lote for delete to authenticated
  using (productores.usuario_activo() and productores.ve_predio(predio_id));

-- PDF de la ficha predial: se borra antes que el predio
drop policy if exists fichas_borrar on storage.objects;
create policy fichas_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'fichas' and productores.usuario_activo() and productores.ve_ruta_ficha(name));
