#!/usr/bin/env bash
# Downloads the raw Overture Maps layers for Jammu + neighbouring towns (free, no API key).
#   pip install overturemaps && scripts/fetch_jammu_map.sh raw && python3 scripts/build_jammu_map.py raw
set -euo pipefail
OUT=${1:-raw}
mkdir -p "$OUT"
REGION=74.70,32.55,75.05,32.92   # Jammu, Nagrota, Akhnoor, R.S. Pura, Bari Brahmana, Vijaypur
CORE=74.80,32.66,74.95,32.78     # city core: buildings + land use
overturemaps download --bbox=$REGION -f geojson -t segment        -o "$OUT/seg.geojson"
overturemaps download --bbox=$REGION -f geojson -t water          -o "$OUT/water.geojson"
overturemaps download --bbox=$REGION -f geojson -t infrastructure -o "$OUT/infra.geojson"
overturemaps download --bbox=$CORE   -f geojson -t building       -o "$OUT/bld.geojson"
overturemaps download --bbox=$CORE   -f geojson -t land_use       -o "$OUT/landuse.geojson"
