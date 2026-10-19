# SIP · Sistema de Información de Productores — CBS

Sistema para registrar **productores → predios → lotes** con mapa, para varios técnicos.

| Componente | Para qué | Dónde |
|---|---|---|
| **Supabase (Sigpredial)** | Base de datos central (PostgreSQL + PostGIS) | supabase.com |
| **App web** | Registro y edición desde el navegador (PC o celular con señal) | https://diecas8.github.io/sigpredial/ |
| **QGIS** | Edición de escritorio y cartografía | Conexión PostgreSQL "Sigpredial" |
| **QField** | Captura en campo sin señal | (siguiente fase) |
| **ArcGIS Pro** | Solo lectura | Usuario `arcgis_lector` |

Los **datos viven en Supabase**. Este repositorio solo contiene el programa:
actualizar archivos aquí **no borra ni cambia datos**.

```
sigpredial/
├── index.html                    ← la aplicación web
├── css/estilos.css               ← colores institucionales
├── js/config.js                  ← conexión a Supabase y opciones (mapas Google, logo)
├── js/api.js                     ← lectura/escritura en la base
├── js/app.js                     ← lógica de la aplicación
├── js/ficha.js                   ← ficha predial imprimible / PDF
├── js/datos-demo.js              ← datos del modo demostración
├── sql/
│   ├── 01_esquema_productores.sql       ← crea TODA la base (versión completa)
│   ├── 02_usuarios.sql                  ← registra administrador y técnicos
│   ├── 03_correccion_auditoria.sql      ← corrección ya incluida en 01*
│   └── 04_lotes_sin_superposicion.sql   ← regla ya incluida en 01*
└── qgis/
    └── configurar_proyecto_sip.py       ← arma el proyecto QGIS (formularios, estilos)
```

\* Los archivos 03 y 04 solo son necesarios en bases creadas con una versión
anterior del 01. Si se monta el sistema desde cero, basta con **01** y **02**.

---

## 1. Base de datos (Supabase)

1. Supabase › **SQL Editor** › New query.
2. En `sql/01_esquema_productores.sql` cambie las contraseñas de la sección 9
   (`CAMBIAR_CLAVE_EDITOR`, `CAMBIAR_CLAVE_LECTOR`), pegue todo y pulse **Run**.
3. Project Settings › **Data API** › *Exposed schemas* › agregue `productores`.

Qué hace la base automáticamente:
- **Códigos únicos**: predio `76863-0001` (municipio + consecutivo), lote `76863-0001-L01`.
- **Lotes ordenados**: al guardar, cada lote se recorta al límite de su predio y se le
  quita lo que se monte sobre otros lotes (el más reciente conserva su forma).
- **Áreas SIG** en hectáreas, densidad de siembra y edad del lote.
- **Auditoría**: quién creó y editó cada registro desde la app web.

## 2. Usuarios

1. Supabase › **Authentication › Users › Add user** (marque *Auto Confirm User*).
2. Edite y ejecute `sql/02_usuarios.sql`.

| Rol | Puede |
|---|---|
| `tecnico` | Ver todo, crear, editar **lo que él registró**, agregar veredas |
| `coordinador` | Editar registros de cualquier técnico y catálogos |
| `admin` | Todo, incluido eliminar lotes |

## 3. App web (GitHub Pages)

- `js/config.js` lleva la URL del proyecto y la clave **publishable** (es pública por diseño).
  **Nunca** ponga allí la clave *secret* ni *service_role*.
- GitHub › Settings › Pages › *Deploy from a branch* › main / root.
- Supabase › Authentication › URL Configuration › Site URL y Redirect URLs:
  `https://diecas8.github.io/sigpredial/`
- Mapas base: Esri, Sentinel-2, OpenTopoMap, OSM, CARTO y Google
  (`GOOGLE_MAPAS: false` en `config.js` para ocultar Google).

Para actualizar: suba solo los archivos que cambiaron (descomprimidos, nunca el .zip).

## 4. QGIS

Conexión PostgreSQL:

| Campo | Valor |
|---|---|
| Anfitrión | `aws-1-ca-central-1.pooler.supabase.com` |
| Puerto | `5432` |
| Base de datos | `postgres` |
| Modo SSL | requerir |
| Usuario | `sig_editor.usbqciezxkbyixqlnlhm` |

Luego: Complementos › Consola de Python › Mostrar editor › abrir
`qgis/configurar_proyecto_sip.py` › Ejecutar. Guarde como `sigpredial.qgz`.

Si se cambia algo en la base (reglas, columnas), **cierre y abra QGIS** para que
las capas lean la versión nueva.

## 5. ArcGIS Pro (solo lectura)

Nueva conexión de base de datos › PostgreSQL, mismo anfitrión y puerto,
usuario `arcgis_lector.usbqciezxkbyixqlnlhm`.

## 6. Copias de seguridad y datos personales

- Exporte periódicamente a CSV las tablas `productor`, `predio` y `lote`
  (Supabase › Table Editor › esquema `productores` › Export).
- Los datos de productores son personales (Ley 1581 de 2012): sin usuario
  registrado y activo no se ve ninguna información.
