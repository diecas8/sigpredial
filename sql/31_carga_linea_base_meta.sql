
-- Los contadores de código de los municipios del Meta arrancan en 0001 (se habían
-- movido en pruebas). Solo se reinician si el municipio aún no tiene predios.
delete from productores.contador_predio c
 where c.cod_mpio in ('50590', '50577', '50325')
   and not exists (select 1 from productores.predio p where p.cod_mpio = c.cod_mpio);

-- Carga (se hizo un municipio por llamada, con los registros revisados del Excel):
--   select productores.cargar_linea_base('[{"cod":"MPR 01", ...}]'::jsonb);
-- Resultado 10-nov-2026: Puerto Rico 28, Puerto Lleras 30, Mapiripán 31 predios;
-- veredas nuevas de campo: La Sultana (Puerto Rico) y Manacure (Mapiripán).
-- Los datos personales no se guardan en el repositorio.
