-- =========================================================================
--  28 · «Cerca / lindero» pasa a llamarse «Cerca muerta (alambre de púa)»,
--  para distinguirla de la cerca viva. En el mapa: cerca viva = línea con
--  arbolitos; cerca muerta = línea con estacones.
-- =========================================================================
update productores.tipo_elemento set nombre = 'Cerca muerta (alambre de púa)' where nombre = 'Cerca / lindero';
