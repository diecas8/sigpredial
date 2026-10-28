# Formularios de KoboToolbox

Un proyecto de Kobo **por departamento**. Cada formulario lleva su propia lista de veredas
(archivo multimedia) y envía sus datos a Sigpredial con el código del departamento.

| Departamento | Formulario (XLSForm) | id_string | Lista de veredas (Multimedia en Kobo) |
|---|---|---|---|
| Caquetá (18) | `caqueta/caracterizacion_zap2_caqueta.xlsx` | `carac_predial_zap2_caqueta` | `caqueta/veredas.csv` (1.275 veredas) |
| Meta (50) | `meta/caracterizacion_zap2_meta.xlsx` | `carac_predial_zap2_meta` | `meta/veredas_meta.csv` (169 veredas de los 4 municipios) |

## Subir o actualizar un formulario
1. Kobo › Nuevo › *Cargar un XLSForm* (la primera vez) o ⋯ › *Reemplazar formulario* (actualizaciones).
2. *Configuración › Multimedia*: subir la lista de veredas con el nombre **exacto** del archivo.
3. *Volver a desplegar* y, en los celulares, descargar de nuevo el formulario en KoboCollect.

Los códigos de vereda de las listas son los mismos del catálogo `productores.vereda` en Supabase.

## Conexión con Sigpredial (servicio REST)
Cada proyecto de Kobo envía sus encuestas a Sigpredial apenas el técnico las sincroniza.
1. Kobo › proyecto › *Configuración* › *Servicios REST* › **Registrar un servicio**.
2. Nombre: `Sigpredial` · URL: la del receptor `kobo-recibir` con `?clave=…`
   (la clave está en Supabase, `privado.config` → `kobo_clave`; pídasela al administrador).
3. Tipo de envío: **JSON** · Activo: sí · sin autenticación adicional.
4. Repita en cada proyecto (Caquetá y Meta): es la misma URL.

Qué hace Sigpredial con cada encuesta (`sql/14_conexion_kobo.sql`):
- guarda la encuesta completa en `productores.caracterizacion`;
- crea o actualiza el **productor** por número de documento (en el departamento del municipio);
- usa la **vereda** por su código; si es «Otra», la crea como vereda de campo *por validar*;
- crea o actualiza el **predio** por el código Humboldt, con el punto GPS de la visita
  (queda «Pendiente de delimitar» en el portal).
- Si algo falla, la encuesta queda con estado *error* y el motivo; el administrador la ve en el
  portal («⚠ Encuestas Kobo con error») y la reprocesa después de corregir la causa.

Para que el predio quede a nombre del técnico (y pueda editarlo en el portal), registre su usuario
de Kobo: `update productores.usuario_app set kobo_usuario = 'usuario_kobo' where correo = '…';`
