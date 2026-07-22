#!/usr/bin/env python3
"""
ColumnarSheet Quack Server
Starts DuckDB with Quack protocol, loads sample data, stays running.
Logs to stdout with flush so process manager can see output.
"""

import duckdb
import os
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIR, "data", "columnar_sheet.duckdb")
TOKEN = "columnar-sheet-token-2026"

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None

def log(msg):
    print(f"[Quack] {msg}", flush=True)

def main():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    log(f"Starting ColumnarSheet Quack Server...")
    log(f"Database: {DB_PATH}")

    con = duckdb.connect(DB_PATH)

    # Install/load Quack
    con.execute("INSTALL quack")
    con.execute("LOAD quack")

    # Load sample data
    sales_csv = os.path.join(DIR, "sample_data", "sales.csv")
    con.execute(f"CREATE OR REPLACE TABLE sales AS SELECT row_number() OVER () AS _id, * FROM read_csv_auto('{sales_csv}', header=true)")
    log(f"Loaded sales table with _id column: {con.execute('SELECT count(*) FROM sales').fetchone()[0]} rows")

    # Start Quack
    result = con.execute(f"""
        CALL quack_serve('quack:0.0.0.0:9494', token => '{TOKEN}', allow_other_hostname => true)
    """).fetchall()

    log(f"✅ Quack server listening on 0.0.0.0:9494")
    log(f"   Token: {TOKEN}")
    log(f"   HTTP: http://localhost:9494")
    log(f"   Ready for connections!")

    # Keep alive
    try:
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        log("Shutting down...")
        con.close()
        log("Done.")

if __name__ == "__main__":
    main()
