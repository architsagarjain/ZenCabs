#!/usr/bin/env python3
"""
Build the real-Jammu demo map from Overture Maps (OpenStreetMap roads + Google /
Microsoft / OSM building footprints).

    scripts/fetch_jammu_map.sh <raw-dir>          # downloads Overture GeoJSON (free, no key)
    python3 scripts/build_jammu_map.py <raw-dir>  # writes the two files below

Outputs
  public/maps/jammu-map.json        road graph (with geometry), water, parks, rail, landmarks
  public/maps/jammu-buildings.bin   building footprints as oriented boxes (Int16 records)

Data © OpenStreetMap contributors (ODbL) · Overture Maps Foundation · Google Open Buildings
(CC BY 4.0) · Microsoft ML Building Footprints (ODbL).
"""
import hashlib
import json
import math
import os
import struct
import sys
from collections import defaultdict

RAW = sys.argv[1] if len(sys.argv) > 1 else 'raw'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, 'public', 'maps', 'jammu-map.json')
OUT_BIN = os.path.join(ROOT, 'public', 'maps', 'jammu-buildings.bin')

# Must match src/core/geo.ts (GEO_ORIGIN + projection).
LAT0, LNG0 = 32.7185, 74.8580
R = 6378137.0
DEG = math.pi / 180
COS0 = math.cos(LAT0 * DEG)

REGION_BBOX = (74.70, 32.55, 75.05, 32.92)  # Jammu + Nagrota, Akhnoor, R.S. Pura, Vijaypur
CORE_BBOX = (74.80, 32.66, 74.95, 32.78)  # buildings + all residential streets


def xy(lng, lat):
    return ((lng - LNG0) * DEG * R * COS0, (lat - LAT0) * DEG * R)


def ll(x, y):
    return (LNG0 + x / (R * COS0) / DEG, LAT0 + y / R / DEG)


def load(name):
    path = os.path.join(RAW, name)
    with open(path) as f:
        return json.load(f)['features']


def prop(f, key):
    v = f['properties'].get(key)
    if isinstance(v, str) and v[:1] in '[{':
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def english_name(f):
    n = prop(f, 'names') or {}
    primary = n.get('primary') or ''
    if primary and primary.isascii():
        return primary
    common = n.get('common') or {}
    if isinstance(common, dict):
        for k in ('en', 'en-IN'):
            if common.get(k):
                return common[k]
    return ''


def in_bbox(lng, lat, b):
    return b[0] <= lng <= b[2] and b[1] <= lat <= b[3]


def simplify(pts, tol):
    """Douglas-Peucker on [(x, y)]."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def flat_ll(pts):
    out = []
    for x, y in pts:
        lng, lat = ll(x, y)
        out += [round(lng, 6), round(lat, 6)]
    return out


# ───────────────────────────── roads
CLASS_MAP = {
    'motorway': 'TRUNK', 'trunk': 'TRUNK', 'primary': 'PRIMARY', 'secondary': 'SECONDARY',
    'tertiary': 'TERTIARY', 'residential': 'RESIDENTIAL', 'unclassified': 'RESIDENTIAL',
    'living_street': 'RESIDENTIAL', 'unknown': 'RESIDENTIAL', 'service': 'SERVICE',
}
MINOR = {'RESIDENTIAL', 'SERVICE'}


def cut(pts, cum, a, b):
    """Sub-polyline between distances a..b along pts."""
    out = []
    for i in range(len(pts) - 1):
        s0, s1 = cum[i], cum[i + 1]
        if s1 < a or s0 > b:
            continue
        seg = s1 - s0 or 1e-9
        t0 = max(0.0, (a - s0) / seg)
        t1 = min(1.0, (b - s0) / seg)
        p0 = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t0, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t0)
        p1 = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t1, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t1)
        if not out:
            out.append(p0)
        out.append(p1)
    return out


def build_roads():
    edges = []  # dict(a, b, cls, name, bridge, pts)
    node_pos = {}
    for f in load('seg.geojson'):
        p = f['properties']
        if p.get('subtype') != 'road' or f['geometry']['type'] != 'LineString':
            continue
        cls = CLASS_MAP.get(p.get('class'))
        if not cls:
            continue
        coords = f['geometry']['coordinates']
        mid = coords[len(coords) // 2]
        if cls in MINOR and not in_bbox(mid[0], mid[1], CORE_BBOX):
            continue  # outside the city keep only through-roads
        pts = [xy(c[0], c[1]) for c in coords]
        cum = [0.0]
        for i in range(1, len(pts)):
            cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
        total = cum[-1]
        if total < 1:
            continue
        conns = sorted(prop(f, 'connectors') or [], key=lambda c: c['at'])
        if len(conns) < 2:
            conns = [{'connector_id': f'{f["properties"].get("id")}-a', 'at': 0.0}, {'connector_id': f'{f["properties"].get("id")}-b', 'at': 1.0}]
        bridges = []
        for flag in prop(f, 'road_flags') or []:
            if 'is_bridge' in (flag.get('values') or []):
                bridges.append(flag.get('between') or [0.0, 1.0])
        name = english_name(f)
        for c0, c1 in zip(conns, conns[1:]):
            a, b = c0['at'] * total, c1['at'] * total
            if b - a < 0.5:
                continue
            piece = cut(pts, cum, a, b)
            if len(piece) < 2:
                continue
            node_pos.setdefault(c0['connector_id'], piece[0])
            node_pos.setdefault(c1['connector_id'], piece[-1])
            is_bridge = any(br[0] < c1['at'] and br[1] > c0['at'] for br in bridges)
            edges.append({'a': c0['connector_id'], 'b': c1['connector_id'], 'cls': cls, 'name': name, 'bridge': is_bridge, 'pts': piece})

    # Contract degree-2 nodes joining edges of the same road.
    inc = defaultdict(list)
    for i, e in enumerate(edges):
        inc[e['a']].append(i)
        inc[e['b']].append(i)
    alive = [True] * len(edges)
    for n in list(inc.keys()):
        ids = [i for i in inc[n] if alive[i]]
        if len(ids) != 2 or ids[0] == ids[1]:
            continue
        e1, e2 = edges[ids[0]], edges[ids[1]]
        if (e1['cls'], e1['name'], e1['bridge']) != (e2['cls'], e2['name'], e2['bridge']):
            continue
        p1 = e1['pts'] if e1['b'] == n else e1['pts'][::-1]
        s1 = e1['a'] if e1['b'] == n else e1['b']
        p2 = e2['pts'] if e2['a'] == n else e2['pts'][::-1]
        s2 = e2['b'] if e2['a'] == n else e2['a']
        if s1 == s2:
            continue  # would create a loop
        merged = {'a': s1, 'b': s2, 'cls': e1['cls'], 'name': e1['name'], 'bridge': e1['bridge'], 'pts': p1 + p2[1:]}
        alive[ids[1]] = False
        edges[ids[0]] = merged
        inc[s2] = [ids[0] if i == ids[1] else i for i in inc[s2]]
        inc[n] = []
    edges = [e for e, a in zip(edges, alive) if a]

    # Largest connected component is routable; everything else is drawn only.
    adj = defaultdict(set)
    for e in edges:
        adj[e['a']].add(e['b'])
        adj[e['b']].add(e['a'])
    comp = {}
    best, best_size = None, 0
    for start in adj:
        if start in comp:
            continue
        stack, members = [start], 0
        comp[start] = start
        while stack:
            u = stack.pop()
            members += 1
            for v in adj[u]:
                if v not in comp:
                    comp[v] = start
                    stack.append(v)
        if members > best_size:
            best, best_size = start, members
    for e in edges:
        e['routable'] = comp[e['a']] == best
        e['pts'] = simplify(e['pts'], 1.5)
    return edges


# ───────────────────────────── buildings
def hull(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_rect(points):
    """Minimum-area oriented rectangle → (cx, cy, w, d, angle)."""
    h = hull(points)
    if len(h) < 3:
        return None
    best = None
    for i in range(len(h)):
        x0, y0 = h[i]
        x1, y1 = h[(i + 1) % len(h)]
        ang = math.atan2(y1 - y0, x1 - x0)
        c, s = math.cos(-ang), math.sin(-ang)
        xs = [px * c - py * s for px, py in h]
        ys = [px * s + py * c for px, py in h]
        w, d = max(xs) - min(xs), max(ys) - min(ys)
        if best is None or w * d < best[0]:
            mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
            cx = mx * math.cos(ang) - my * math.sin(ang)
            cy = mx * math.sin(ang) + my * math.cos(ang)
            best = (w * d, cx, cy, w, d, ang)
    return best[1:]


CORE_HUBS = [xy(74.8650, 32.7290), xy(74.8600, 32.7020), xy(74.8720, 32.7050), xy(74.8530, 32.7360)]


def building_height(f, area, cx, cy):
    p = f['properties']
    if p.get('height'):
        return float(p['height'])
    if p.get('num_floors'):
        return float(p['num_floors']) * 3.2 + 0.6
    r = int(hashlib.md5(str(p.get('id')).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    if area < 60:
        floors = 1 + (r > 0.55)
    elif area < 200:
        floors = 1 + int(r * 3)  # 1–3
    elif area < 700:
        floors = 2 + int(r * 3)  # 2–4
    elif area < 2500:
        floors = 2 + int(r * 4)  # 2–5
    else:
        floors = 1 + int(r * 3)  # sheds, halls, warehouses
    if min(math.hypot(cx - hx, cy - hy) for hx, hy in CORE_HUBS) < 900 and area > 120:
        floors += 1  # denser commercial core
    return floors * 3.2 + 0.6


def build_buildings():
    recs = []
    for f in load('bld.geojson'):
        g = f['geometry']
        ring = g['coordinates'][0] if g['type'] == 'Polygon' else g['coordinates'][0][0]
        pts = [xy(c[0], c[1]) for c in ring]
        rect = min_rect(pts)
        if not rect:
            continue
        cx, cy, w, d, ang = rect
        area = w * d
        if area < 12 or w > 3000 or d > 3000:
            continue
        h = building_height(f, area, cx, cy)
        recs.append((round(cx * 2), round(cy * 2), round(w * 10), round(d * 10), round(ang * 10000), round(h * 10)))
    recs = [r for r in recs if all(-32768 <= v <= 32767 for v in r)]
    with open(OUT_BIN, 'wb') as out:
        for r in recs:
            out.write(struct.pack('<6h', *r))
    return len(recs)


# ───────────────────────────── water, land use, rail, landmarks
WATER_LINE_WIDTH = {'river': 22, 'canal': 9, 'stream': 5, 'drain': 3, 'ditch': 2}
GREEN = {'park', 'pitch', 'stadium', 'golf_course', 'recreation_ground', 'garden', 'playground', 'grass', 'forest', 'wood'}


def ring_flat(ring, tol=2.0):
    return flat_ll(simplify([xy(c[0], c[1]) for c in ring], tol))


def build_areas_lines():
    areas, lines = [], []
    for f in load('water.geojson'):
        p, g = f['properties'], f['geometry']
        if p.get('class') == 'swimming_pool':
            continue
        if g['type'] == 'Polygon':
            areas.append({'kind': 'WATER', 'ring': ring_flat(g['coordinates'][0])})
        elif g['type'] == 'MultiPolygon':
            for poly in g['coordinates']:
                areas.append({'kind': 'WATER', 'ring': ring_flat(poly[0])})
        elif g['type'] == 'LineString':
            w = WATER_LINE_WIDTH.get(p.get('class')) or WATER_LINE_WIDTH.get(p.get('subtype'))
            if w:
                lines.append({'kind': 'WATER', 'width': w, 'name': english_name(f), 'pts': ring_flat(g['coordinates'], 2.0)})
    for f in load('landuse.geojson'):
        p, g = f['properties'], f['geometry']
        cls, sub = p.get('class'), p.get('subtype')
        kind = 'PARK' if cls in GREEN or sub == 'park' else 'MILITARY' if sub == 'military' else 'INSTITUTION' if sub in ('education', 'medical') else 'INDUSTRIAL' if cls == 'industrial' else None
        if not kind:
            continue
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
        for poly in polys:
            areas.append({'kind': kind, 'ring': ring_flat(poly[0])})
    for f in load('seg.geojson'):
        if f['properties'].get('subtype') == 'rail' and f['geometry']['type'] == 'LineString':
            lines.append({'kind': 'RAIL', 'width': 4, 'name': english_name(f), 'pts': ring_flat(f['geometry']['coordinates'], 2.0)})
    for f in load('infra.geojson'):
        p = f['properties']
        if p.get('class') == 'taxiway' and f['geometry']['type'] == 'LineString':
            lines.append({'kind': 'TAXIWAY', 'width': 18, 'name': '', 'pts': ring_flat(f['geometry']['coordinates'], 2.0)})
    return areas, lines


# Curated from Overture places/divisions (2026-09 release).
LANDMARKS = [
    ('airport', 'Jammu Airport', 'AIRPORT', 32.68919, 74.83749, 700, 1.5),
    ('railway', 'Jammu Tawi Railway Station', 'RAIL', 32.70541, 74.88044, 450, 1.6),
    ('busstand', 'General Bus Stand', 'BUS', 32.72735, 74.85936, 380, 1.3),
    ('raghunath', 'Raghunath Temple', 'TEMPLE', 32.72962, 74.86300, 350, 0.9),
    ('gmc', 'GMC Hospital', 'HOSPITAL', 32.73612, 74.85397, 350, 0.8),
    ('residency', 'Residency Road', 'MALL', 32.72885, 74.86591, 350, 0.9),
    ('bahufort', 'Bahu Fort', 'FORT', 32.72674, 74.88036, 400, 0.4),
    ('bahuplaza', 'Bahu Plaza', 'MALL', 32.70494, 74.87196, 380, 1.0),
    ('university', 'Jammu University', 'UNIVERSITY', 32.71919, 74.86927, 450, 0.6),
    ('gandhinagar', 'Gandhi Nagar', 'MALL', 32.70199, 74.85962, 600, 1.2),
    ('trikuta', 'Trikuta Nagar', 'MALL', 32.69115, 74.87705, 550, 0.8),
    ('channi', 'Channi Himmat', 'MALL', 32.68847, 74.89138, 600, 0.6),
    ('satwari', 'Satwari Chowk', 'MALL', 32.68400, 74.84800, 500, 0.7),
    ('janipur', 'Janipur', 'UNIVERSITY', 32.75544, 74.84970, 600, 0.6),
    ('talabtillo', 'Talab Tillo', 'MALL', 32.73800, 74.83400, 550, 0.5),
    ('narwal', 'Narwal', 'MALL', 32.71680, 74.89100, 600, 0.5),
    ('kunjwani', 'Kunjwani', 'MALL', 32.66820, 74.87350, 500, 0.4),
    ('nagrota', 'Nagrota', 'TOWN', 32.79085, 74.90476, 1200, 0.35),
    ('akhnoor', 'Akhnoor', 'TOWN', 32.90195, 74.73474, 1500, 0.25),
    ('rspura', 'R.S. Pura', 'TOWN', 32.60698, 74.73386, 1500, 0.25),
    ('bari', 'Bari Brahmana', 'TOWN', 32.63831, 74.91524, 1200, 0.25),
    ('vijaypur', 'Vijaypur', 'TOWN', 32.56650, 75.01722, 1200, 0.2),
]


def main():
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    edges = build_roads()
    ids = {}
    nodes = []

    def nid(key, pt):
        if key not in ids:
            ids[key] = len(ids)
            nodes.extend(flat_ll([pt]))
        return ids[key]

    names = ['']
    name_idx = {'': 0}
    out_edges = []
    for e in edges:
        a = nid(e['a'], e['pts'][0])
        b = nid(e['b'], e['pts'][-1])
        if e['name'] not in name_idx:
            name_idx[e['name']] = len(names)
            names.append(e['name'])
        flags = (1 if e['bridge'] else 0) | (2 if e['routable'] else 0)
        out_edges.append([a, b, e['cls'], name_idx[e['name']], flags, flat_ll(e['pts'][1:-1])])
    areas, lines = build_areas_lines()
    n_bld = build_buildings()
    doc = {
        'name': 'Jammu & surroundings (OpenStreetMap via Overture Maps)',
        'attribution': '© OpenStreetMap contributors · Overture Maps Foundation · Google Open Buildings · Microsoft Building Footprints',
        'origin': [LNG0, LAT0],
        'bbox': list(REGION_BBOX),
        'nodes': nodes,
        'names': names,
        'edges': out_edges,
        'areas': areas,
        'lines': lines,
        'landmarks': [{'id': i, 'name': n, 'kind': k, 'lat': la, 'lng': lo, 'radius': r, 'demand': w} for i, n, k, la, lo, r, w in LANDMARKS],
        'buildings': {'url': '/maps/jammu-buildings.bin', 'count': n_bld, 'format': 'int16[6]: x*2, z*2, w*10, d*10, angle*1e4, h*10 (local metres, x east, y north)'},
    }
    with open(OUT_JSON, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    routable = sum(1 for e in edges if e['routable'])
    print(f'nodes {len(nodes) // 2}  edges {len(edges)} (routable {routable})  areas {len(areas)}  lines {len(lines)}  buildings {n_bld}')
    print(f'{OUT_JSON}: {os.path.getsize(OUT_JSON) / 1e6:.1f} MB   {OUT_BIN}: {os.path.getsize(OUT_BIN) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
