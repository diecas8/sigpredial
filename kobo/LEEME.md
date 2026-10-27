# Formularios de KoboToolbox

Un proyecto de Kobo **por departamento**. Cada formulario lleva su propia lista de veredas
(archivo multimedia) y envía sus datos a Sigpredial con el código del departamento.

| Departamento | Formulario (XLSForm) | id_string | Lista de veredas (Multimedia en Kobo) |
|---|---|---|---|
| Caquetá (18) | `caqueta/caracterizacion_zap2_caqueta.xlsx` | `carac_predial_zap2_caqueta` | `caqueta/veredas.csv` (1.275 veredas) |
| Meta (50) | `meta/caracterizacion_zap2_meta.xlsx` | `carac_predial_zap2_meta` | `meta/veredas_meta.csv` (pendiente: capa veredal del Meta) |

## Subir o actualizar un formulario
1. Kobo › Nuevo › *Cargar un XLSForm* (la primera vez) o ⋯ › *Reemplazar formulario* (actualizaciones).
2. *Configuración › Multimedia*: subir la lista de veredas con el nombre **exacto** del archivo.
3. *Volver a desplegar* y, en los celulares, descargar de nuevo el formulario en KoboCollect.

Los códigos de vereda de las listas son los mismos del catálogo `productores.vereda` en Supabase.
