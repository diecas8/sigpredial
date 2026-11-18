"""
Prepara las determinantes ambientales de Corpoamazonia de un municipio
para cargarlas en productores.determinante (sql/38).

Uso:
    python preparar.py <carpeta_del_municipio> <carpeta_salida>

<carpeta_del_municipio> es la carpeta que envía Corpoamazonia, p. ej.
18785_SOLITA (con 01_BC_DETERMINANTES_AMBIENTALES adentro). El código
DANE se toma del nombre de la carpeta.

Qué hace con cada capa que sirve para las PPS:
  1. la pasa a MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377);
  2. corrige geometrías inválidas;
  3. agrupa por la categoría que importa (zona, uso, manejo…);
  4. simplifica a 5 m (las capas vienen a 1:25.000 y 1:100.000);
  5. la devuelve en WGS84 (EPSG:4326), como guarda la base.

Deja un GeoJSON por municipio en <carpeta_salida> (datos/<cod>.geojson).
Se sube al repositorio y la base lo descarga y carga con
sql/38b_cargar_determinantes.sql, que además parte cada polígono en
pedazos pequeños (ST_Subdivide) para que el cruce sea rápido.

Lo que no sirve para la escala predial no se carga: capas urbanas,
densidades, retiros de equipamientos y cambio climático (PIGCCT trae un
solo valor por municipio).
"""
import glob
import os
import re
import sys
import warnings

import geopandas as gpd
import shapely
import shapely.geometry

warnings.filterwarnings("ignore")

SIMPLIFICAR_M = 5

FUENTES = {
    "18001": "Res. 0054 de 2021 · Corpoamazonia",
    "18094": "Res. 1653 de 2019 y 1754 de 2019 · Corpoamazonia",
    "18256": "Res. 1283 de 2021 · Corpoamazonia",
    "18460": "Res. 1644 de 2019 · Corpoamazonia",
    "18479": "Res. 1284 de 2021 · Corpoamazonia",
    "18610": "Res. 1646 de 2019 · Corpoamazonia",
    "18753": "Res. 1649 de 2019 y 1754 de 2019 · Corpoamazonia",
    "18785": "Res. 1281 de 2021 · Corpoamazonia",
}

# Qué indica cada categoría, en palabras sencillas y tomado de las fichas
# técnicas de las resoluciones. nivel: 1 restricción fuerte, 2 manejo, 3 precaución.
LEY2 = {
    "A": ("Zona A", "Mantener los bosques y sus servicios ambientales; no ampliar la frontera agropecuaria.", 1),
    "B": ("Zona B", "Manejo sostenible del bosque. Lo agropecuario existente debe ir hacia sistemas sostenibles, "
                    "sin ampliar la frontera agrícola ni reducir el bosque natural.", 1),
    "C": ("Zona C", "Actividades productivas compatibles con la reserva, sin reducir el bosque natural.", 2),
}
BNR = {
    "BOSQUES PARA PROTECCIÓN DENTRO DE LA FRONTERA AGROPECUARIA (DIF CORREDORES)":
        ("Bosque para protección", "Bosque dentro de la frontera agropecuaria: es suelo de protección y debe mantenerse.", 1, 10),
    "CORREDORES DE RESTAURACIÓN – PRESERVACIÓN":
        ("Corredor de restauración y preservación", "Mantener el bosque que hay y restaurar donde se perdió, "
                                                    "para conectar el paisaje.", 2, 11),
    "ÁREAS SEMINATURALES PARA RESTAURACIÓN":
        ("Área seminatural para restaurar", "Vegetación seminatural o en transición: objeto de restauración ecológica.", 2, 12),
}
BTZA = {
    "Preservación": ("Preservar", "Mantener el área en su estado natural.", 1),
    "Protección por Alta Oferta de SSEE": ("Proteger (alta oferta de servicios ecosistémicos)",
                                           "Proteger por los servicios ambientales que presta.", 1),
    "Protección con uso sostenible": ("Proteger con uso sostenible", "Proteger, con usos de bajo impacto.", 2),
    "Restauración": ("Restaurar", "Recuperar la cobertura natural.", 2),
    "Uso productivo con reconversión": ("Producir con reconversión",
                                        "Se puede producir, pasando a sistemas sostenibles (silvopastoril, agroforestal…).", 3),
}
MANEJO_DCSAC = {
    "PRESERVAR": ("Preservar", "Mantener la cobertura natural.", 1),
    "RESTAURAR": ("Restaurar", "Recuperar la cobertura natural en áreas seminaturales.", 2),
    "REHABILITAR": ("Rehabilitar", "Recuperar funciones del suelo y el agua en áreas semitransformadas.", 2),
    "RECUPERAR": ("Recuperar", "Áreas transformadas: producción con prácticas de conservación de suelos y aguas.", 3),
}
AFP = {
    "Protección": ("Protección", "Área forestal protectora: mantener la cobertura boscosa.", 1),
    "Restauración": ("Restauración", "Área forestal protectora: restaurar la cobertura boscosa.", 2),
}


def reglas(nombre, g):
    """Devuelve (grupo, orden, campo, función categoría→(categoría, indicación, nivel[, orden])) o None."""
    n = nombre.upper()
    if "RESERVA_FORESTAL_LEY2" in n:
        return "Reserva Forestal Ley 2ª", 1, "Tipo_Zona", lambda v: LEY2.get(str(v).strip())
    if n.endswith("_AFP"):
        return "Área forestal protectora", 4, "Uso_Recom", lambda v: AFP.get(str(v).strip())
    if n.endswith("_DCSAC") or n.endswith("_DCASC"):
        return "Distrito de Conservación de Suelos y Aguas (DCSAC)", 3, "MANEJ_PREL", lambda v: MANEJO_DCSAC.get(str(v).strip())
    if n.endswith("_BNR_V123"):
        return "Bosque natural remanente", 5, "CATEGORIA", lambda v: BNR.get(str(v).strip())
    if n.endswith("_BNR_V4"):
        return "Bosque natural remanente", 5, None, lambda v: (
            "Bosque en riesgo de deforestación", "Riesgo de deforestación al 2030: tomar medidas para evitar la pérdida del bosque.", 2, 13)
    if n.endswith("_I_BTZA_DA"):
        return "Zonificación ambiental (bases técnicas MADS)", 7, "Cat_faseVI", lambda v: BTZA.get(str(v).strip())
    if n.endswith("_HUMEDALES_RUR"):
        campo = "Tipo" if "Tipo" in g.columns else None
        return "Humedal", 6, campo, lambda v: (
            str(v) if v and str(v) != "None" else "Humedal",
            "Conservar el humedal y respetar una franja de retiro de 30 m.", 1)
    if n.endswith("_AIE"):
        return "Área de importancia estratégica (acueducto)", 6, None, lambda v: (
            "Microcuenca abastecedora", "Abastece un acueducto: usos de preservación, restauración y uso sostenible.", 2)
    if re.search(r"_(PNN|PNR)_", n) or n.endswith("PARAMO_MIRAFLORES") or "PARAMO_MIRAFLORES" in n:
        tipo = "Parque Nacional Natural" if "_PNN_" in n else "Parque Natural Regional" if "_PNR_" in n else "Páramo"
        return "Área protegida", 0, None, lambda v, t=tipo, nm=nombre: (
            t + " " + nm.split("_", 2)[-1].replace("_", " "), "Área protegida: se rige por su plan de manejo.", 1)
    if "_PMN_" in n:
        return "Área protegida", 0, None, lambda v, nm=nombre: (
            "Parque municipal " + nm.split("_PMN_")[-1].replace("_", " "), "Área protegida municipal: se rige por su plan de manejo.", 1)
    if "_RNSC_" in n:
        return "Área protegida", 0, None, lambda v, nm=nombre: (
            "Reserva de la sociedad civil " + nm.split("_RNSC_")[-1].replace("_", " "),
            "Reserva natural de la sociedad civil: se rige por su plan de manejo.", 1)
    if re.search(r"_INUND_+RUR$", n):
        return "Amenaza", 8, None, lambda v: (
            "Inundación", "Zona con amenaza por inundación: tenerla en cuenta al ubicar vivienda e infraestructura.", 3)
    if n.endswith("_POMCA_18_RUR") and ("INUND" in n or "MOVMASA" in n or "AVENTORREN" in n):
        # Capas del POMCA: el nivel viene codificado (1 Alta, 2 Media, 3 Baja, dominio del modelo
        # de datos POMCA de Minambiente). Se dejan alta y media; la baja cubre casi toda la cuenca.
        tipo = "Inundación" if "INUND" in n else "Movimientos en masa" if "MOVMASA" in n else "Avenida torrencial"
        campo = next((c for c in g.columns if re.match(r"AME_(INU|MM|AT)_RA", c, re.I)), None)
        niveles = {"1": "alta", "2": "media"}
        return "Amenaza", 8, campo, lambda v, t=tipo: (
            (f"{t} · amenaza {niveles[str(v).strip()]}",
             "Amenaza alta: evitar vivienda e infraestructura nueva." if str(v).strip() == "1"
             else "Amenaza media: tenerla en cuenta al ubicar vivienda e infraestructura.", 3)
            if str(v).strip() in niveles else None)
    return None


def preparar(carpeta, salida):
    cod = re.search(r"(\d{5})_", os.path.basename(os.path.normpath(carpeta))).group(1)
    fuente = FUENTES[cod]
    filas = []
    for shp in sorted(glob.glob(os.path.join(carpeta, "**", "*.shp"), recursive=True)):
        nombre = os.path.basename(shp)[:-4]
        if "PIGCCT" in nombre.upper() or "_URB" in nombre.upper():
            continue
        g = gpd.read_file(shp)
        r = reglas(nombre, g)
        if r is None or g.crs is None:
            if r is not None:
                print("  ⚠ sin sistema de referencia, se omite:", nombre)
            continue
        grupo, orden_grupo, campo, fcat = r
        g = g.to_crs(9377)
        g["geometry"] = shapely.force_2d(g.make_valid().values)
        g = g[g.geom_type.isin(["Polygon", "MultiPolygon", "GeometryCollection"])]
        g["_v"] = g[campo].astype(str) if campo and campo in g.columns else ""
        for valor, parte in g.groupby("_v"):
            info = fcat(valor)
            if info is None:
                print(f"  ⚠ {nombre}: categoría sin regla «{valor}», se omite")
                continue
            categoria, indicacion, nivel = info[:3]
            orden = info[3] if len(info) > 3 else orden_grupo * 10 + nivel
            geom = shapely.union_all(parte.geometry.values)
            geom = shapely.make_valid(shapely.simplify(geom, SIMPLIFICAR_M, preserve_topology=True))
            pol = [p for p in shapely.get_parts(geom) if p.geom_type in ("Polygon", "MultiPolygon")]
            if not pol:
                continue
            geom = gpd.GeoSeries([shapely.multipolygons(shapely.get_parts(shapely.union_all(pol)))], crs=9377).to_crs(4326)[0]
            filas.append(dict(grupo=grupo, categoria=categoria, indicacion=indicacion, nivel=nivel,
                              orden=orden, capa=nombre, ha=round(gpd.GeoSeries([geom], crs=4326).to_crs(9377).area[0] / 1e4, 1),
                              wkt=shapely.to_wkt(geom, rounding_precision=6)))
            print(f"  {nombre:38s} {categoria[:45]:45s} {filas[-1]['ha']:>10,.1f} ha")
    os.makedirs(salida, exist_ok=True)
    escribir_geojson(cod, fuente, filas, salida)
    return filas


def escribir_geojson(cod, fuente, filas, salida):
    """Un GeoJSON por municipio: es lo que carga sql/38b desde el repositorio."""
    import json
    feats = [{"type": "Feature",
              "properties": {"cod_mpio": cod, "grupo": f["grupo"], "categoria": f["categoria"],
                             "indicacion": f["indicacion"], "nivel": f["nivel"], "orden": f["orden"],
                             "capa_origen": f["capa"], "fuente": fuente},
              "geometry": shapely.geometry.mapping(shapely.from_wkt(f["wkt"]))} for f in filas]
    ruta = os.path.join(salida, f"{cod}.geojson")
    with open(ruta, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  → {ruta} ({os.path.getsize(ruta) / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    preparar(sys.argv[1], sys.argv[2])
