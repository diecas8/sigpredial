# SIP · Sistema de Información de Productores — CBS

Sistema para registrar **productores → predios → lotes y elementos prediales** con mapa,
para varios técnicos.

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
├── css/estilos.css               ← colores del logo CBS (verde hoja, verde lima, amarillo)
├── img/                          ← logo CBS (logo-cbs.png, horizontal y completo)
├── js/config.js                  ← conexión a Supabase y opciones (mapas Google, logo)
├── js/api.js                     ← lectura/escritura en la base
├── js/app.js                     ← lógica de la aplicación
├── js/ficha.js                   ← ficha predial imprimible / PDF
├── js/datos-demo.js              ← datos del modo demostración
├── sql/
│   ├── 01_esquema_productores.sql       ← crea TODA la base (versión completa)
│   ├── 02_usuarios.sql                  ← registra administrador y técnicos
│   ├── 03_correccion_auditoria.sql      ← corrección ya incluida en 01*
│   ├── 04_lotes_sin_superposicion.sql   ← regla ya incluida en 01*
│   ├── 05_acceso_access.sql             ← usuario y vistas de solo lectura para Access
│   ├── 06_divipola_colombia.sql         ← todos los departamentos y municipios (DANE)
│   ├── 07_cultivos_adicionales.sql      ← coberturas: humedal, bosque de galería… (incluido en 09)
│   ├── 08_cobertura_en_access.sql       ← tipo de cobertura en Access (incluido en 09)
│   └── 09_paquete_octubre.sql           ← elementos prediales, trazado/sitios, vistas nuevas
├── qgis/
│   └── configurar_proyecto_sip.py       ← arma el proyecto QGIS (formularios, estilos)
└── access/
    └── mdlSigpredial.bas                ← vincula Access a Sigpredial (solo lectura)
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
- **Todo el país**: con `06_divipola_colombia.sql` quedan los 33 departamentos y
  1.123 municipios/áreas no municipalizadas (DIVIPOLA). En la app se elige
  Departamento → Municipio → Vereda (`DEPARTAMENTO_INICIAL` en `config.js`).
- **Códigos únicos**: predio `76863-0001` (municipio + consecutivo), lote `76863-0001-L01`.
- **Lotes ordenados**: al guardar, cada lote se recorta al límite de su predio y se le
  quita lo que se monte sobre otros lotes (el más reciente conserva su forma).
- **Áreas SIG** en hectáreas, densidad de siembra y edad del lote.
- **Sitios de siembra**: sitios = área SIG ÷ (dist. surcos × dist. plantas); en *tresbolillo*
  se divide además por 0,866. % de ocupación = plantas registradas ÷ sitios.
- **Elementos prediales** (`09`): líneas (ríos, quebradas, canales, vías, caminos, cercas) y
  puntos (nacimientos, captaciones, reservorios, vivienda, beneficiadero…). Se asignan al
  predio donde se dibujan, las líneas se recortan a su límite y se calcula su longitud;
  un punto fuera del predio se rechaza.
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

Herramientas de la app:
- **Panel izquierdo plegable** (botón ☰), **divisor arrastrable** entre ficha y mapa
  (doble clic vuelve al ancho original; el ancho se recuerda) y botón **Mapa completo** (Esc sale).
- **Medir** distancia (m/km, por tramo) y área (m²/ha y perímetro) sin guardar nada.
- **Cargar archivos** (botón de carpeta del mapa): Shapefile en .zip (.shp, .shx, .dbf, .prj),
  KML/KMZ, GeoJSON y GPX. Se reproyectan desde MAGNA-SIRGAS (9377, 3114-3118) según el .prj;
  si no hay .prj se pregunta el sistema. Se ven como capa de referencia (no se guardan) y al
  hacer clic sobre una forma se puede usar como límite del predio, como lote nuevo o como elemento.
- **Aviso de diferencia de áreas**: si el área SIG y la declarada difieren más de 30 % aparece
  ⚠ en el árbol, la ficha y la ficha predial. Es informativo: el área declarada no se cambia.
- **Ficha predial** con logo, elementos, sitios estimados y ocupación.

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
Carga también las capas **Elementos · líneas** y **Elementos · puntos** (el tipo se elige
de una lista filtrada por líneas o puntos y el predio se asigna solo).

Si se cambia algo en la base (reglas, columnas), **cierre y abra QGIS** para que
las capas lean la versión nueva.

## 5. ArcGIS Pro (solo lectura)

Nueva conexión de base de datos › PostgreSQL, mismo anfitrión y puerto,
usuario `arcgis_lector.usbqciezxkbyixqlnlhm`.

## 6. Access (área administrativa, solo lectura)

1. Ejecute `sql/05_acceso_access.sql` en Supabase (cambie antes `CAMBIAR_CLAVE_OFICINA`).
2. Instale el controlador **psqlODBC** (PostgreSQL ODBC) con la misma arquitectura de Office
   (64 o 32 bits: Access › Archivo › Cuenta › Acerca de Access).
3. En una base de Access en blanco: Alt+F11 › Importar `access/mdlSigpredial.bas` ›
   ejecute `VincularSigpredial` (F5) y escriba la clave de `lector_oficina`.

Quedan vinculadas las tablas **Productores, Predios, Lotes, Elementos, Resumen_cultivos y
Resumen_coberturas** (datos en vivo, sin geometrías), nueve consultas de ejemplo (la 8 es
*Predios con diferencia de área*) y el formulario **Menu_Descargas** para el administrador:
filtros por departamento, municipio y rango de fechas de registro, y botones para descargar
a Excel productores, predios, lotes, elementos, resumen por cultivo, resumen por cobertura,
predios con diferencia de área o todo en un solo libro. Los archivos quedan en la carpeta
*Descargas Sigpredial* junto a la base de Access, con la fecha en el nombre, y la carpeta se
abre sola. Desde Access **no se puede modificar** la información.

Si ya tenía la base de Access de una versión anterior: Alt+F11 › clic derecho sobre el módulo
`mdlSigpredial` › Quitar, importe el nuevo `.bas` y ejecute `VincularSigpredial` otra vez.

## 7. Copias de seguridad y datos personales

- Exporte periódicamente a CSV las tablas `productor`, `predio` y `lote`
  (Supabase › Table Editor › esquema `productores` › Export).
- Los datos de productores son personales (Ley 1581 de 2012): sin usuario
  registrado y activo no se ve ninguna información.
