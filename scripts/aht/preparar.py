"""Prepara la capa AHT (Áreas Homogéneas de Tierras, IGAC) para Sigpredial.

Lee las capas <PREFIJO>_AHT de ZAP_zonificacion.gdb (EPSG:9377), deja solo los
12 municipios con predios PPS, simplifica a 1 m, pasa a EPSG:4326 y escribe
datos/<cod_mpio>.geojson. Luego se cargan con productores.cargar_aht (sql/46).
Uso: python preparar.py <ruta a ZAP_zonificacion.gdb> <carpeta de salida>
Requiere: pyogrio, shapely, pyproj.
"""
import json, os, sys
import pyogrio, shapely
from shapely import wkb
from shapely.ops import transform
from pyproj import Transformer

GDB, SALIDA = sys.argv[1], sys.argv[2]
MP = {'BA': '18094', 'PAU': '18256', 'FLO': '18001', 'MIL': '18460', 'MOR': '18479', 'SJF': '18610',
      'SVC': '18753', 'SOL': '18785', 'MAP': '50325', 'PL': '50577', 'PR': '50590', 'PC': '50450'}
tr = Transformer.from_crs(9377, 4326, always_xy=True).transform
FLAG = [('INUNDACION', '1', 'Inundaciones'), ('Encharcami', '1', 'Encharcamiento'),
        ('FNFreatico', '1', 'Nivel freático fluctuante'), ('EHidrica', '1', 'Erosión hídrica ligera'),
        ('EHidrica', '2', 'Erosión hídrica moderada'), ('PEfectiva', '1', 'Poca profundidad efectiva'),
        ('FGPerfil', '1', 'Fragmentos gruesos (piedra) en el perfil'), ('PSuperfici', '1', 'Piedra en la superficie'),
        ('LRocosidad', '1', 'Afloramientos rocosos'), ('AIntercamb', '1', 'Acidez (aluminio)')]
MISC = {'3': 'Bancos de arena', '5': 'Pantanos', '14': 'Islas e islotes'}


def r6(c):
    return [r6(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]


os.makedirs(SALIDA, exist_ok=True)
for pre, cod in MP.items():
    m, _, geoms, fl = pyogrio.raw.read(GDB, layer=pre + '_AHT')
    names = list(m['fields'])
    feats = []
    for k in range(len(geoms)):
        r = {n: (None if fl[i][k] is None else str(fl[i][k]).strip()) for i, n in enumerate(names)}
        if r['Divipola'] != cod:
            continue
        geo = wkb.loads(geoms[k]).simplify(1.0, preserve_topology=True)
        if geo.is_empty:
            continue
        geo = transform(tr, geo)
        lim = [t for c, v, t in FLAG if r.get(c) == v]
        if r.get('Miscelaneo') in MISC:
            lim.append(MISC[r['Miscelaneo']])
        gj = shapely.geometry.mapping(geo)
        feats.append({'type': 'Feature', 'properties': {
            'cod_mpio': cod, 'simbolo': r['SIMBOLO'],
            'clase': int(float(r['CLASE'])) if r['CLASE'] else None,
            'vpotencial': int(float(r['VPotencial'])) if r['VPotencial'] not in (None, '') else None,
            'ucs': r['UCSuelo'], 'limitantes': lim,
            'descripcion': (r['Observacio'] or '').strip() or None, 'fecha': r['Fecha']},
            'geometry': {'type': gj['type'], 'coordinates': r6(gj['coordinates'])}})
    with open(os.path.join(SALIDA, cod + '.geojson'), 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f, ensure_ascii=False, separators=(',', ':'))
    print(cod, len(feats))
