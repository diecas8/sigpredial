-- =====================================================================
-- 41 · determinantes_predio más rápido
-- ---------------------------------------------------------------------
-- Con los 8 municipios cargados (≈50.000 pedazos), la regla de permisos
-- de productores.determinante (ve_dpto por fila) hacía tardar ~1 s cada
-- predio. La función ya revisa al inicio que el usuario vea el predio
-- (ve_predio) y solo devuelve lo que cae en ese predio, así que corre
-- como definidora y se salta la revisión fila por fila.
-- =====================================================================
alter function productores.determinantes_predio(uuid) security definer;
