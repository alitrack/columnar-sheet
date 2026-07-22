# 🦆 ColumnarSheet

> Excel-style, columnar spreadsheet. DuckDB + Quack + AI.
> Zero custom HTTP layer — Quack protocol eliminates the middleman.

## Quick Start

```bash
./start.sh
# → Frontend: http://localhost:8080
# → Quack:    localhost:9494
```

Or run individually:

```bash
# Terminal 1: Quack Server
python3 server.py

# Terminal 2: Frontend (static files)
python3 -m http.server 8080
```

## Architecture

```
Browser (index.html)
├── DuckDB-Wasm (in-browser SQL engine)
│   ├── Quack Client ──── HTTP ────→ DuckDB Server (server.py)
│   │                                ├── Quack Extension (port 9494)
│   │                                └── data/columnar_sheet.duckdb
│   └── Local mode (no server needed)
├── Handsontable Grid (spreadsheet UI)
└── AI Panel (NL → SQL → DuckDB)
```

## Features

- [x] DuckDB-Wasm in browser
- [x] Quack client-server connection
- [x] Handsontable grid with sorting/filtering
- [x] Table browser
- [x] AI natural language query (NL2SQL)
- [ ] Cell editing → Quack write-back
- [ ] Multi-user collaboration
- [ ] Chart integration
- [ ] Formula bar

## Files

```
columnar-sheet/
├── index.html          # Frontend SPA
├── server.py           # Quack server
├── start.sh            # Start both servers
├── sample_data/
│   └── sales.csv       # Sample data
└── data/
    └── columnar_sheet.duckdb  # Server database (auto-created)
```
