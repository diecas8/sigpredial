"""
Prepara la zonificación ambiental PDET (bases técnicas MADS, capa BTZA)
de los municipios del proyecto para cargarla en productores.determinante.

Insumo: BTZA_Meta_Caqueta.shp (Zonificacion_PDET_2021.shp recortado a
Meta y Caquetá en ArcGIS Pro), simplificado a 10 m en BTZA_simpl10m.gpkg,
y los límites municipales del portal (capas/<dpto>/municipios.geojson).

Pasos por municipio:
  1. recorta la capa con el límite del municipio (EPSG:9377);
  2. une los polígonos por categoría y simplifica a 20 m
     (la capa es 1:100.000: 1 mm del mapa son 100 m);
  3. quita pedazos de menos de 0,1 ha (astillas del recorte);
  4. la guarda en WGS84 en datos/btza/<cod>[_parte].geojson, partida
     por categorías para que ningún archivo pase de ~6 MB.

Se carga con productores.cargar_determinantes_grupo (sql/54).

Uso: python preparar_btza.py <BTZA_simpl10m.gpkg> <carpeta_salida>
"""
import json, os, sys
import geopandas as gpd
import shapely
from shapely.geometry import mapping

CODS = ['18001', '18094', '18256', '18460', '18479', '18610', '18753', '18785',
        '50325', '50450', '50577', '50590']
GRUPO = 'Zonificación ambiental PDET (MADS, 2021)'
FUENTE = 'Plan de Zonificación Ambiental PDET · MADS (BTZA, escala 1:100.000)'
CAPA = 'Zonificacion_PDET_2021'
# categoría oficial → (qué indica, nivel 1 restricción fuerte · 2 manejo · 3 precaución)
CAT = {
    'Preservación': ('Fuera de la frontera agrícola: mantener el área en su estado natural.', 1),
    'Restauración': ('Fuera de la frontera agrícola: recuperar el bosque y los ecosistemas.', 1),
    'Protección por Alta Oferta de SSEE': ('Fuera de la frontera agrícola: bosques poco intervenidos, prioridad de protección.', 1),
    'Protección con uso sostenible': ('Proteger el bosque; solo manejo forestal sostenible, sin ganadería ni agricultura extensiva.', 2),
    'Uso sostenible para el aprovechamiento de la biodiversidad': ('Frontera agrícola condicionada: producir mejorando la biodiversidad e integrando el bosque a la economía familiar.', 2),
    'Uso sostenible para el desarrollo': ('Frontera agrícola condicionada: pasar de la ganadería extensiva a sistemas agrosilvopastoriles y agricultura familiar.', 3),
    'Uso productivo con reconversión': ('Se puede producir, pasando a sistemas sostenibles (silvopastoril, agroforestal…).', 3),
    'Uso productivo': ('Zona para producir con prácticas de manejo sostenible.', 3),
    'Uso productivo con protección': ('Producir manteniendo y enriqueciendo los relictos de bosque.', 3),
}
MAX = 6_000_000


def main(gpkg, salida):
    raiz = os.path.join(os.path.dirname(__file__), '..', '..', 'capas')
    fs = []
    for d in ('caqueta', 'meta'):
        fs += json.load(open(os.path.join(raiz, d, 'municipios.geojson'), encoding='utf-8'))['features']
    mp = gpd.GeoDataFrame.from_features(fs, crs=4326)
    mp = mp[mp.cod_mpio.isin(CODS)].to_crs(9377)
    b = gpd.read_file(gpkg)
    b = b[b.geometry.notna()]
    b['geometry'] = b.geometry.make_valid()
    os.makedirs(salida, exist_ok=True)
    for _, m in mp.iterrows():
        s = b[b.intersects(m.geometry)].copy()
        s['geometry'] = s.geometry.intersection(m.geometry)
        s = s.explode(index_parts=False)
        s = s[s.geom_type == 'Polygon']
        s = s.dissolve('categoria').reset_index()
        s['geometry'] = s.geometry.simplify(20).make_valid()
        s = s.explode(index_parts=False)
        s = s[(s.geom_type == 'Polygon') & (s.area >= 1000)]
        s = s.dissolve('categoria').reset_index().to_crs(4326)
        s['geometry'] = shapely.make_valid(shapely.set_precision(s.geometry.values, 1e-6, mode='pointwise'))  # 6 decimales ≈ 0,1 m
        feats = []
        for _, r in s.iterrows():
            ind, niv = CAT[r.categoria]
            feats.append({'type': 'Feature', 'properties': {
                'cod_mpio': m.cod_mpio, 'grupo': GRUPO, 'categoria': r.categoria, 'indicacion': ind,
                'nivel': niv, 'orden': 7, 'capa_origen': CAPA, 'fuente': FUENTE},
                'geometry': mapping(r.geometry)})
        # partir en archivos de máx. ~6 MB (por categorías completas)
        partes, act, tam = [], [], 0
        for f in feats:
            t = len(json.dumps(f))
            if act and tam + t > MAX:
                partes.append(act); act, tam = [], 0
            act.append(f); tam += t
        partes.append(act)
        for i, p in enumerate(partes):
            nom = m.cod_mpio + (f'_{i + 1}' if len(partes) > 1 else '') + '.geojson'
            with open(os.path.join(salida, nom), 'w', encoding='utf-8') as fh:
                json.dump({'type': 'FeatureCollection', 'features': p}, fh, ensure_ascii=False, separators=(',', ':'))
            print(nom, len(p), 'categorías', round(os.path.getsize(os.path.join(salida, nom)) / 1e6, 1), 'MB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
