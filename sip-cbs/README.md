# SIP · Sistema de Información de Productores — CBS

Aplicación web para registrar y editar **productores → predios → lotes**, con mapa,
pensada para que los técnicos trabajen desde el navegador (computador o celular).
Los datos viven en **Supabase (PostgreSQL + PostGIS)**: la misma base que usarán
QGIS/QField en campo y ArcGIS Pro en modo lectura.

```
sip-cbs/
├── index.html              ← la aplicación
├── css/estilos.css         ← colores institucionales (variables al inicio)
├── js/config.js            ← AQUÍ van los datos de Supabase
├── js/api.js               ← lectura/escritura en Supabase (o demo)
├── js/app.js               ← lógica de la aplicación
├── js/datos-demo.js        ← datos de ejemplo del modo demostración
└── sql/
    ├── 01_esquema_productores.sql   ← crea toda la base
    └── 02_usuarios.sql              ← registra administrador y técnicos
```

> **Antes de subir cambios grandes al repositorio, haga commit de lo que ya tiene.**

---

## 1. Crear la base en Supabase

1. Abra su proyecto en Supabase › **SQL Editor** › *New query*.
2. Abra `sql/01_esquema_productores.sql`, **cambie las dos contraseñas** de la
   sección 9 (`CAMBIAR_CLAVE_EDITOR`, `CAMBIAR_CLAVE_LECTOR`), pegue todo y pulse **Run**.
   Se crea el esquema `productores` con tablas, códigos automáticos, reglas,
   permisos (RLS) y los 42 municipios del Valle.
3. **Exponer el esquema a la API:** Project Settings › **Data API** ›
   *Exposed schemas* › agregue `productores` › Save.
   *(Sin este paso la app responde “schema must be one of…”.)*

## 2. Crear los usuarios

1. Supabase › **Authentication › Users › Add user**: cree su usuario y el de cada
   técnico (correo + contraseña). Recomendado: desactivar el registro público en
   Authentication › Sign In / Providers › *Allow new users to sign up* = off.
2. Edite `sql/02_usuarios.sql` con los correos y nombres, y ejecútelo en el SQL Editor.

| Rol | Puede |
|---|---|
| `tecnico` | Ver todo, crear productores/predios/lotes, editar **lo que él registró**, agregar veredas |
| `coordinador` | Lo anterior + editar registros de cualquier técnico y catálogos |
| `admin` | Todo, incluido eliminar lotes y gestionar usuarios |

Un usuario que exista en Authentication pero **no** esté en `usuario_app` no puede entrar.

## 3. Configurar y publicar en GitHub Pages

1. Supabase › Project Settings › **API**: copie *Project URL* y la clave **anon public**.
2. Péguelas en `js/config.js` (`SUPABASE_URL` y `SUPABASE_ANON_KEY`).
   La clave anon es pública por diseño; la seguridad la dan el RLS y los usuarios.
   **Nunca** ponga allí la clave `service_role`.
3. (Opcional) Copie el logo oficial a `img/logo-cbs.png` y ponga `LOGO: "img/logo-cbs.png"`.
4. Suba la carpeta al repositorio (por ejemplo, una carpeta `sip/` en SIGCBS).
5. GitHub › Settings › **Pages** › *Deploy from a branch* (main / root).
   La app quedará en `https://<usuario>.github.io/<repo>/sip/`.
6. Supabase › Authentication › **URL Configuration** › agregue esa dirección en
   *Site URL* / *Redirect URLs*.

Si `config.js` queda vacío, la app abre en **modo demostración** con datos de ejemplo.

## 4. Cómo funciona

- **Códigos automáticos y únicos** (los asigna la base, nunca el técnico):
  predio `76863-0001` (municipio + consecutivo), lote `76863-0001-L01`.
  No cambian aunque se corrija la vereda o el área.
- **Lote siempre dentro de su predio:** la base rechaza un lote que se salga más del 5 %
  de su área, o que no tenga predio.
- **Áreas SIG** en hectáreas, calculadas por la base desde la geometría; la densidad
  (plantas/ha) y la edad del lote se calculan solas.
- **Cascada municipio → vereda**; si la vereda no existe, se agrega desde la lista
  (“＋ Agregar vereda…”).
- **Auditoría:** cada registro guarda quién lo creó y quién lo editó por última vez.

## 5. QGIS, QField y ArcGIS Pro

- **QGIS / QField (edición):** conexión PostgreSQL al *pooler de sesión* de Supabase
  con el usuario `sig_editor`. Capas: `productores.predio`, `productores.lote`.
  Para captura **offline** en QField, en las propiedades de la capa ponga como valor
  predeterminado del campo `id` la expresión `uuid('WithoutBraces')`.
- **ArcGIS Pro (solo lectura):** Nueva conexión de base de datos › PostgreSQL,
  usuario `arcgis_lector`.

## 6. Datos personales

La tabla de productores contiene datos personales (Ley 1581 de 2012). El acceso anónimo
está bloqueado: solo usuarios registrados y activos ven la información.
