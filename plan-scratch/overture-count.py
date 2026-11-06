"""A5 cross-check, count parity only (NOT a gate): Overture buildings in the canal-ring box.

Run under taskpolicy -b. Overture release 2026-10-21.0 (the plan's pin; confirmed present in the bucket
by the listing below before the count is trusted). Writes nothing but stdout.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import duckdb
import _city

REL = "2026-10-21.0"
a = _city.AREAS["canal-ring"]
w, s, e, n = _city.bounds(a)
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
base = f"s3://overturemaps-us-west-2/release/{REL}/theme=buildings/type=building/*"
cnt = con.execute(f"""
  SELECT count(*), count(*) FILTER (WHERE height IS NOT NULL), count(*) FILTER (WHERE num_floors IS NOT NULL)
  FROM read_parquet('{base}', hive_partitioning=1)
  WHERE bbox.xmin >= {w} AND bbox.xmax <= {e} AND bbox.ymin >= {s} AND bbox.ymax <= {n}
""").fetchone()
print(f"Overture {REL} buildings with bbox fully inside the box: {cnt[0]}  (with height {cnt[1]}, with num_floors {cnt[2]})")
