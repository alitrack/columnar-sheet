#!/usr/bin/env python3
"""
ColumnarSheet Quack Server + DuckDB AI Extension
Starts DuckDB with Quack protocol + ai extension for NL2SQL.
"""
import duckdb
import os
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIR, "data", "columnar_sheet.duckdb")
TOKEN = "columnar-sheet-token-2026"
AI_PROVIDER_URL = os.environ.get("AI_PROVIDER_URL", "http://10.10.10.131:38440/v1")
AI_MODEL = os.environ.get("AI_MODEL", "deepseek-v4-flash")

sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None

def log(msg):
    print(f"[Quack] {msg}", flush=True)

def main():
    # Clear proxy env vars — DuckDB ai needs direct access to AI provider
    for k in list(os.environ.keys()):
        if k.endswith('_PROXY') or k.endswith('_proxy') or k == 'NO_PROXY' or k == 'no_proxy':
            del os.environ[k]

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    log(f"Starting ColumnarSheet Quack Server...")
    log(f"Database: {DB_PATH}")
    log(f"AI Provider: {AI_PROVIDER_URL}")

    con = duckdb.connect(DB_PATH)

    # Install/load Quack
    con.execute("INSTALL quack")
    con.execute("LOAD quack")

    # Install/load AI extension
    try:
        con.execute("INSTALL ai FROM community")
        con.execute("LOAD ai")
        log("AI extension loaded")

        # Configure AI provider → MoonBridge/OpenAI-compatible
        con.execute("SET duckdb_ai_provider = 'openai'")
        con.execute(f"SET duckdb_ai_base_url = '{AI_PROVIDER_URL}'")
        con.execute(f"SET duckdb_ai_model = '{AI_MODEL}'")
        con.execute("CREATE SECRET IF NOT EXISTS moon_ai (TYPE duckdb_ai, AI_PROVIDER 'openai', API_KEY 'moonbridge')")
        log(f"AI configured: {AI_MODEL} @ {AI_PROVIDER_URL}")
    except Exception as e:
        log(f"AI extension not available: {e}")

    # Load sample data
    sales_csv = os.path.join(DIR, "sample_data", "sales.csv")
    con.execute(f"CREATE OR REPLACE TABLE sales AS SELECT row_number() OVER () AS _id, * FROM read_csv_auto('{sales_csv}', header=true)")
    log(f"Loaded sales: {con.execute('SELECT count(*) FROM sales').fetchone()[0]} rows")

    # Create dimension tables for multi-table queries
    con.execute("""
        CREATE TABLE IF NOT EXISTS products AS 
        SELECT row_number() OVER () AS _id, * FROM (
            VALUES 
            ('Widget A', 'Electronics', 29.99), ('Widget B', 'Electronics', 49.99),
            ('Gadget X', 'Gadgets', 15.50), ('Gadget Y', 'Gadgets', 22.00),
            ('Tool Pro', 'Hardware', 89.00), ('Tool Lite', 'Hardware', 45.00),
            ('Sensor V2', 'Sensors', 12.75), ('Sensor V3', 'Sensors', 18.50),
            ('Cable USB-C', 'Accessories', 8.99), ('Cable HDMI', 'Accessories', 12.99),
            ('Display 24in', 'Displays', 199.00), ('Display 27in', 'Displays', 299.00),
            ('Keyboard Mech', 'Input', 79.00), ('Mouse Pro', 'Input', 49.00),
            ('Dock Station', 'Accessories', 129.00)
        ) AS t(product, category, price)
    """)
    log(f"Products: {con.execute('SELECT count(*) FROM products').fetchone()[0]} rows")

    con.execute("""
        CREATE TABLE IF NOT EXISTS regions AS 
        SELECT row_number() OVER () AS _id, * FROM (
            VALUES 
            ('North', 'US', 0.08), ('South', 'US', 0.07),
            ('East', 'US', 0.06), ('West', 'US', 0.09),
            ('Central', 'EU', 0.20), ('North EU', 'EU', 0.21),
            ('South EU', 'EU', 0.22), ('APAC East', 'APAC', 0.10),
            ('APAC West', 'APAC', 0.11), ('LATAM', 'LATAM', 0.15)
        ) AS t(region, zone, tax_rate)
    """)
    log(f"Regions: {con.execute('SELECT count(*) FROM regions').fetchone()[0]} rows")

    # Start Quack
    con.execute(f"""
        CALL quack_serve('quack:0.0.0.0:9494', token => '{TOKEN}', allow_other_hostname => true)
    """).fetchall()

    log(f"✅ Quack server listening on 0.0.0.0:9494")
    log(f"   Token: {TOKEN}")
    log(f"   HTTP: http://localhost:9494")
    log(f"   AI: {AI_MODEL}")
    log(f"   Ready!")

    try:
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        log("Shutting down...")
        con.close()
        log("Done.")

if __name__ == "__main__":
    main()
