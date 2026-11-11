-- =========================================================================
--  32 · Crear productores nuevos desde el portal
--
--  Al guardar un productor nuevo, el portal lo inserta y lo lee de vuelta
--  (insert … returning id). La regla de lectura productor_ver usaba solo
--  ve_productor(id), que busca el registro en la tabla: en ese momento el
--  registro recién insertado aún no aparece, y la base rechazaba la operación
--  («new row violates row-level security policy»), para todos los usuarios.
--  Ahora quien lo crea lo ve de inmediato, si el departamento le corresponde.
-- =========================================================================
drop policy productor_ver on productores.productor;
create policy productor_ver on productores.productor for select to authenticated
  using (productores.ve_productor(id)
         or (creado_por = (select auth.uid()) and productores.ve_dpto(cod_dpto::text)));
