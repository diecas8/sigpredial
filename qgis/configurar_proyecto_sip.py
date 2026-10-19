# -*- coding: utf-8 -*-
"""
SIP · Sigpredial — Configuración del proyecto QGIS
Corporación Biocomercio Sostenible

Qué hace:
  - Carga desde la conexión "Sigpredial" las capas predio, lote, productor
    y los catálogos (municipio, vereda, cultivo, tenencia).
  - Arma los formularios: nombres en español, listas desplegables,
    cascada Municipio → Vereda, campos automáticos de solo lectura.
  - Crea las relaciones Productor → Predios → Lotes (formularios anidados).
  - El lote toma automáticamente el predio dentro del cual se dibuja.
  - Estilos: predios en naranja, lotes por cultivo, etiquetas.
  - Mapas base satelitales y SRC MAGNA-SIRGAS Origen Nacional (EPSG:9377).
  - Deja las capas marcadas para QField (edición offline).

Cómo usarlo:
  1. Abra QGIS con un proyecto nuevo (vacío).
  2. Complementos › Consola de Python › botón "Mostrar editor".
  3. Abra este archivo (icono de carpeta) y pulse "Ejecutar script" (▶).
  4. Guarde el proyecto: Proyecto › Guardar como… › sigpredial.qgz

Funciona en QGIS 3.34+ y QGIS 4.x. Puede ejecutarse varias veces.
"""

from urllib.parse import quote

from qgis.core import (
    QgsProject, QgsVectorLayer, QgsRasterLayer, QgsDataSourceUri,
    QgsProviderRegistry, QgsEditorWidgetSetup, QgsDefaultValue,
    QgsRelation, QgsFieldConstraints, QgsCoordinateReferenceSystem,
    QgsCoordinateTransform, QgsFillSymbol, QgsCategorizedSymbolRenderer,
    QgsRendererCategory, QgsSingleSymbolRenderer, QgsPalLayerSettings,
    QgsVectorLayerSimpleLabeling, QgsTextFormat, QgsTextBufferSettings,
    QgsAttributeEditorContainer, QgsAttributeEditorField,
    QgsAttributeEditorRelation, QgsEditFormConfig, Qgis,
)
from qgis.PyQt.QtGui import QColor, QFont

try:
    from qgis.utils import iface
except Exception:  # pragma: no cover
    iface = None

# ---------------------------------------------------------------------------
NOMBRE_CONEXION = 'Sigpredial'
ESQUEMA = 'productores'
GRUPO = 'SIP · Sigpredial'
VERDE = '#2e6b2e'
NARANJA = '#e8a020'

proyecto = QgsProject.instance()


def enum(*rutas):
    """Devuelve el primer enum que exista (compatibilidad QGIS 3 / QGIS 4)."""
    for ruta in rutas:
        obj = None
        try:
            partes = ruta.split('.')
            obj = globals()[partes[0]]
            for p in partes[1:]:
                obj = getattr(obj, p)
            return obj
        except (KeyError, AttributeError):
            continue
    raise AttributeError('No se encontró ninguno de: ' + ', '.join(rutas))


NOT_NULL = enum('QgsFieldConstraints.Constraint.ConstraintNotNull', 'QgsFieldConstraints.ConstraintNotNull')
FUERTE = enum('QgsFieldConstraints.ConstraintStrength.ConstraintStrengthHard', 'QgsFieldConstraints.ConstraintStrengthHard')
FORM_TABS = enum('Qgis.AttributeFormLayout.DragAndDrop', 'QgsEditFormConfig.TabLayout', 'QgsEditFormConfig.EditorLayout.TabLayout')


# ---------------------------------------------------------------------------
# 1. Conexión guardada
# ---------------------------------------------------------------------------
meta = QgsProviderRegistry.instance().providerMetadata('postgres')
conexion = meta.findConnection(NOMBRE_CONEXION)
if conexion is None:
    raise Exception(f'No existe la conexión PostgreSQL "{NOMBRE_CONEXION}". '
                    'Créela primero en el Navegador (PostgreSQL › Nueva conexión).')
URI_BASE = conexion.uri()


def capa_pg(tabla, nombre, geom=None, clave='id'):
    uri = QgsDataSourceUri(URI_BASE)
    uri.setDataSource(ESQUEMA, tabla, geom or '', '', clave)
    if geom:
        uri.setSrid('4326')
    capa = QgsVectorLayer(uri.uri(False), nombre, 'postgres')
    if not capa.isValid():
        raise Exception(f'No se pudo cargar la tabla {ESQUEMA}.{tabla}. '
                        'Revise la conexión y la contraseña maestra.')
    return capa


def capa_xyz(url, nombre, zmax=19):
    # La URL va codificada completa (incluido '&') para no romper los parámetros de QGIS
    fuente = f'type=xyz&url={quote(url, safe=":/")}&zmin=0&zmax={zmax}'
    return QgsRasterLayer(fuente, nombre, 'wms')


# ---------------------------------------------------------------------------
# 2. Limpiar una ejecución anterior y cargar capas
# ---------------------------------------------------------------------------
raiz = proyecto.layerTreeRoot()
anterior = raiz.findGroup(GRUPO)
if anterior:
    for capa in [n.layer() for n in anterior.findLayers()]:
        if capa:
            proyecto.removeMapLayer(capa.id())
    raiz.removeChildNode(anterior)
for rel in list(proyecto.relationManager().relations().keys()):
    if rel.startswith('sip_'):
        proyecto.relationManager().removeRelation(rel)

# SRC del proyecto antes de cargar capas (MAGNA-SIRGAS Origen Nacional)
proyecto.setCrs(QgsCoordinateReferenceSystem('EPSG:9377'))

grupo = raiz.insertGroup(0, GRUPO)
g_cat = grupo.addGroup('Catálogos')
g_base = raiz.findGroup('Mapas base') or raiz.addGroup('Mapas base')

lote = capa_pg('lote', 'Lotes', 'geom')
predio = capa_pg('predio', 'Predios', 'geom')
productor = capa_pg('productor', 'Productores')
municipio = capa_pg('municipio', 'Municipios', clave='cod_mpio')
vereda = capa_pg('vereda', 'Veredas')
cultivo = capa_pg('cultivo', 'Cultivos')
tenencia = capa_pg('tenencia', 'Tenencia')

for capa in (lote, predio, productor):
    proyecto.addMapLayer(capa, False)
    grupo.addLayer(capa)
for capa in (municipio, vereda, cultivo, tenencia):
    proyecto.addMapLayer(capa, False)
    g_cat.addLayer(capa)
g_cat.setExpanded(False)

if not g_base.findLayers():
    for capa in (
        capa_xyz('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', 'Google Híbrido', 20),
        capa_xyz('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                 'Satélite Esri', 19),
        capa_xyz('https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'OpenStreetMap', 19),
    ):
        if capa.isValid():
            proyecto.addMapLayer(capa, False)
            g_base.addLayer(capa)
    for nodo in g_base.findLayers()[1:]:
        nodo.setItemVisibilityChecked(False)
# Mover el grupo de mapas base al final de la lista
clon = g_base.clone()
raiz.addChildNode(clon)
raiz.removeChildNode(g_base)


# ---------------------------------------------------------------------------
# 3. Utilidades de formulario
# ---------------------------------------------------------------------------
def idx(capa, campo):
    i = capa.fields().indexOf(campo)
    if i < 0:
        raise Exception(f'La capa {capa.name()} no tiene el campo {campo}')
    return i


def alias(capa, nombres):
    for campo, texto in nombres.items():
        capa.setFieldAlias(idx(capa, campo), texto)


def widget(capa, campo, tipo, config=None):
    capa.setEditorWidgetSetup(idx(capa, campo), QgsEditorWidgetSetup(tipo, config or {}))


def solo_lectura(capa, campos):
    cfg = capa.editFormConfig()
    for c in campos:
        cfg.setReadOnly(idx(capa, c), True)
    capa.setEditFormConfig(cfg)


def ocultar(capa, campos):
    for c in campos:
        if capa.fields().indexOf(c) >= 0:
            widget(capa, c, 'Hidden')


def obligatorio(capa, campos):
    for c in campos:
        capa.setFieldConstraint(idx(capa, c), NOT_NULL, FUERTE)


def lista(capa, campo, valores):
    widget(capa, campo, 'ValueMap', {'map': [{v: v} for v in valores]})


def lista_capa(capa, campo, origen, clave, valor, filtro='', nulo=True):
    widget(capa, campo, 'ValueRelation', {
        'Layer': origen.id(), 'LayerName': origen.name(), 'LayerProviderName': 'postgres',
        'LayerSource': origen.source(), 'Key': clave, 'Value': valor,
        'OrderByValue': True, 'AllowNull': nulo, 'AllowMulti': False,
        'UseCompleter': True, 'FilterExpression': filtro,
    })


def fecha(capa, campo):
    widget(capa, campo, 'DateTime', {'field_format': 'yyyy-MM-dd', 'display_format': 'dd/MM/yyyy',
                                     'calendar_popup': True, 'allow_null': True})


def texto_largo(capa, campo):
    widget(capa, campo, 'TextEdit', {'IsMultiline': True, 'UseHtml': False})


def valor_defecto(capa, campo, expresion, al_editar=False):
    capa.setDefaultValueDefinition(idx(capa, campo), QgsDefaultValue(expresion, al_editar))


AUDITORIA = ['creado_por', 'creado_en', 'editado_por', 'editado_en']


# ---------------------------------------------------------------------------
# 4. Relaciones Productor → Predios → Lotes
# ---------------------------------------------------------------------------
def relacion(rid, nombre, hija, campo_hija, padre, campo_padre):
    r = QgsRelation()
    r.setId(rid)
    r.setName(nombre)
    r.setReferencingLayer(hija.id())
    r.setReferencedLayer(padre.id())
    r.addFieldPair(campo_hija, campo_padre)
    try:
        r.setStrength(enum('Qgis.RelationshipStrength.Composition', 'QgsRelation.Composition'))
    except AttributeError:
        pass
    if not r.isValid():
        raise Exception(f'Relación no válida: {nombre} ({r.validationError()})')
    proyecto.relationManager().addRelation(r)
    return r


rel_prod_predio = relacion('sip_productor_predio', 'Predios del productor', predio, 'productor_id', productor, 'id')
rel_predio_lote = relacion('sip_predio_lote', 'Lotes del predio', lote, 'predio_id', predio, 'id')

productor.setDisplayExpression("\"nombres\" || ' ' || coalesce(\"apellidos\", '') || ' (' || \"num_doc\" || ')'")
predio.setDisplayExpression("\"cod_predio\" || ' · ' || \"nombre\"")
lote.setDisplayExpression("coalesce(\"cod_lote\", 'Lote nuevo') || ' · ' || coalesce(represent_value(\"cultivo_id\"), '')")


def referencia(capa, campo, rel, permitir_nulo=False):
    widget(capa, campo, 'RelationReference', {
        'Relation': rel.id(), 'AllowNULL': permitir_nulo, 'ShowForm': False,
        'ShowOpenFormButton': True, 'MapIdentification': True, 'ReadOnly': False,
        'AllowAddFeatures': False, 'OrderByValue': True,
    })


# ---------------------------------------------------------------------------
# 5. PRODUCTOR
# ---------------------------------------------------------------------------
alias(productor, {
    'tipo_doc': 'Tipo de documento', 'num_doc': 'Número de documento', 'nombres': 'Nombres',
    'apellidos': 'Apellidos', 'sexo': 'Sexo', 'fecha_nac': 'Fecha de nacimiento', 'telefono': 'Teléfono',
    'correo': 'Correo', 'asociacion': 'Asociación', 'observaciones': 'Observaciones',
})
valor_defecto(productor, 'id', "uuid('WithoutBraces')")
ocultar(productor, ['id'] + AUDITORIA)
lista(productor, 'tipo_doc', ['CC', 'TI', 'CE', 'PPT', 'NIT', 'Otro'])
lista(productor, 'sexo', ['Mujer', 'Hombre', 'Otro'])
fecha(productor, 'fecha_nac')
texto_largo(productor, 'observaciones')
obligatorio(productor, ['num_doc', 'nombres'])


# ---------------------------------------------------------------------------
# 6. PREDIO
# ---------------------------------------------------------------------------
alias(predio, {
    'cod_predio': 'Código del predio', 'productor_id': 'Productor', 'nombre': 'Nombre del predio',
    'num_predial': 'Número predial', 'matricula': 'Matrícula inmobiliaria', 'tenencia_id': 'Tenencia',
    'area_declarada_ha': 'Área declarada (ha)', 'cod_mpio': 'Municipio', 'vereda_id': 'Vereda',
    'altitud_msnm': 'Altitud (msnm)', 'como_llegar': 'Cómo llegar', 'area_sig_ha': 'Área SIG (ha)',
})
valor_defecto(predio, 'id', "uuid('WithoutBraces')")
ocultar(predio, ['id', 'punto'] + AUDITORIA)
solo_lectura(predio, ['cod_predio', 'area_sig_ha'])
referencia(predio, 'productor_id', rel_prod_predio)
campo_mpio = 'etiqueta' if municipio.fields().indexOf('etiqueta') >= 0 else 'nombre'
lista_capa(predio, 'cod_mpio', municipio, 'cod_mpio', campo_mpio, nulo=False)
# Cascada: solo las veredas del municipio elegido
lista_capa(predio, 'vereda_id', vereda, 'id', 'nombre', filtro="\"cod_mpio\" = current_value('cod_mpio')")
lista_capa(predio, 'tenencia_id', tenencia, 'id', 'nombre')
texto_largo(predio, 'como_llegar')
obligatorio(predio, ['productor_id', 'nombre', 'cod_mpio'])
# Área SIG calculada al dibujar (la base la recalcula al guardar)
valor_defecto(predio, 'area_sig_ha', "round($area / 10000, 4)", True)


# ---------------------------------------------------------------------------
# 7. LOTE
# ---------------------------------------------------------------------------
alias(lote, {
    'cod_lote': 'Código del lote', 'num_lote': 'N.º de lote', 'predio_id': 'Predio', 'cultivo_id': 'Cultivo',
    'variedad': 'Variedad', 'fecha_siembra': 'Fecha de siembra', 'area_declarada_ha': 'Área declarada (ha)',
    'area_sig_ha': 'Área SIG (ha)', 'num_plantas': 'Número de plantas',
    'dist_surcos_m': 'Distancia entre surcos (m)', 'dist_plantas_m': 'Distancia entre plantas (m)',
    'densidad_ha': 'Densidad (plantas/ha)', 'sistema': 'Sistema', 'sombrio': 'Tipo de sombrío',
    'estado': 'Estado', 'observaciones': 'Observaciones',
})
valor_defecto(lote, 'id', "uuid('WithoutBraces')")
ocultar(lote, ['id'] + AUDITORIA)
solo_lectura(lote, ['cod_lote', 'num_lote', 'area_sig_ha', 'densidad_ha'])
referencia(lote, 'predio_id', rel_predio_lote)
# El lote toma el predio que contiene su centro
valor_defecto(lote, 'predio_id',
              "array_first(aggregate(layer:='" + predio.id() + "', aggregate:='array_agg', expression:=\"id\", "
              "filter:=intersects($geometry, point_on_surface(geometry(@parent)))))")
lista_capa(lote, 'cultivo_id', cultivo, 'id', 'nombre', nulo=False)
lista(lote, 'sistema', ['Libre exposición', 'Semisombra', 'Sombra', 'Agroforestal', 'Silvopastoril', 'Asociado'])
lista(lote, 'estado', ['Levante', 'Producción', 'Renovación', 'Zoca', 'Abandonado'])
fecha(lote, 'fecha_siembra')
texto_largo(lote, 'observaciones')
obligatorio(lote, ['predio_id', 'cultivo_id'])
valor_defecto(lote, 'area_sig_ha', "round($area / 10000, 4)", True)


# ---------------------------------------------------------------------------
# 8. Formularios con pestañas (igual a la app web)
# ---------------------------------------------------------------------------
def formulario(capa, pestanas):
    cfg = capa.editFormConfig()
    cfg.clearTabs()
    cfg.setLayout(FORM_TABS)
    raiz_form = cfg.invisibleRootContainer()
    for titulo, elementos in pestanas:
        cont = QgsAttributeEditorContainer(titulo, raiz_form)
        cont.setIsGroupBox(False)
        for el in elementos:
            if isinstance(el, QgsRelation):
                cont.addChildElement(QgsAttributeEditorRelation(el, cont))
            else:
                cont.addChildElement(QgsAttributeEditorField(el, idx(capa, el), cont))
        cfg.addTab(cont)
    capa.setEditFormConfig(cfg)


formulario(productor, [
    ('Productor', ['tipo_doc', 'num_doc', 'nombres', 'apellidos', 'sexo', 'fecha_nac',
                   'telefono', 'correo', 'asociacion', 'observaciones']),
    ('Predios', [rel_prod_predio]),
])
formulario(predio, [
    ('Predio', ['cod_predio', 'productor_id', 'nombre', 'num_predial', 'matricula', 'tenencia_id',
                'area_declarada_ha', 'area_sig_ha']),
    ('Ubicación', ['cod_mpio', 'vereda_id', 'altitud_msnm', 'como_llegar']),
    ('Lotes', [rel_predio_lote]),
])
formulario(lote, [
    ('Lote', ['cod_lote', 'predio_id', 'cultivo_id', 'variedad', 'fecha_siembra', 'estado']),
    ('Siembra', ['area_declarada_ha', 'area_sig_ha', 'num_plantas', 'dist_surcos_m',
                 'dist_plantas_m', 'densidad_ha', 'sistema', 'sombrio']),
    ('Notas', ['observaciones']),
])


# ---------------------------------------------------------------------------
# 9. Estilos y etiquetas
# ---------------------------------------------------------------------------
def etiquetas(capa, expresion, color, tam=9):
    s = QgsPalLayerSettings()
    s.fieldName = expresion
    s.isExpression = True
    fmt = QgsTextFormat()
    fmt.setFont(QFont('Arial'))
    fmt.setSize(tam)
    fmt.setColor(QColor(color))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(1)
    buf.setColor(QColor('white'))
    fmt.setBuffer(buf)
    s.setFormat(fmt)
    try:
        s.placement = enum('Qgis.LabelPlacement.OverPoint', 'QgsPalLayerSettings.OverPoint')
    except AttributeError:
        pass
    capa.setLabeling(QgsVectorLayerSimpleLabeling(s))
    capa.setLabelsEnabled(True)


predio.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({
    'color': '232,160,32,25', 'outline_color': NARANJA, 'outline_width': '0.8', 'outline_style': 'solid'})))
etiquetas(predio, '"cod_predio"', '#7a4f00', 10)

COLORES = {'Café': '#2e6b2e', 'Plátano': '#c9b037', 'Banano': '#c9b037', 'Cacao': '#8b5a2b',
           'Aguacate': '#5f8f2f', 'Cítricos': '#e6a400', 'Caña panelera': '#9cb84a',
           'Bosque / forestal': '#1f4d1f', 'Pastos y forrajes': '#b5c98a'}
categorias = []
for f in cultivo.getFeatures():
    color = COLORES.get(f['nombre'], '#4a8c3f')
    simbolo = QgsFillSymbol.createSimple({'color': color, 'outline_color': '#ffffff',
                                          'outline_width': '0.4'})
    simbolo.setOpacity(0.75)
    categorias.append(QgsRendererCategory(f['id'], simbolo, f['nombre']))
categorias.sort(key=lambda c: c.label())
lote.setRenderer(QgsCategorizedSymbolRenderer('cultivo_id', categorias))
etiquetas(lote, "'L' || lpad(to_string(\"num_lote\"), 2, '0')", VERDE, 8)


# ---------------------------------------------------------------------------
# 10. Preparación para QField (QFieldSync)
# ---------------------------------------------------------------------------
for capa in (predio, lote, productor):
    capa.setCustomProperty('QFieldSync/action', 'offline')
    capa.setCustomProperty('QFieldSync/cloud_action', 'offline')
for capa in (municipio, vereda, cultivo, tenencia):
    capa.setCustomProperty('QFieldSync/action', 'offline')
    capa.setCustomProperty('QFieldSync/cloud_action', 'offline')


# ---------------------------------------------------------------------------
# 11. SRC del proyecto y vista
# ---------------------------------------------------------------------------
crs = QgsCoordinateReferenceSystem('EPSG:9377')
proyecto.setCrs(crs)
if iface is not None:
    iface.mapCanvas().setDestinationCrs(crs)
proyecto.setTitle('SIP · Sigpredial — CBS')

for capa in (predio, lote, productor, municipio, vereda, cultivo, tenencia):
    capa.triggerRepaint()

if iface is not None:
    predio.updateExtents()
    ext = predio.extent()
    if not ext.isEmpty():
        tr = QgsCoordinateTransform(predio.crs(), crs, proyecto)
        caja = tr.transformBoundingBox(ext)
        caja.scale(1.3)
        iface.mapCanvas().setExtent(caja)
        iface.mapCanvas().refresh()
    iface.setActiveLayer(predio)
    iface.messageBar().pushSuccess('SIP · Sigpredial',
                                   'Proyecto configurado. Guárdelo con Proyecto › Guardar como… (sigpredial.qgz)')

print('✔ Proyecto SIP configurado:',
      f'{predio.featureCount()} predios, {lote.featureCount()} lotes, {productor.featureCount()} productores.')
