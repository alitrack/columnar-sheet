#!/usr/bin/env python3
"""
ColumnarSheet App Server
Static files + AI backends (MoonBridge proxy + DuckDB AI) + SQL caching.
"""
import http.server
import json
import os
import sys
import time
import urllib.request
import urllib.error

DIR = os.path.dirname(os.path.abspath(__file__))
MOONBRIDGE_URL = os.environ.get("MOONBRIDGE_URL", "http://10.10.10.131:38440/v1/chat/completions")
AI_MODEL = os.environ.get("AI_MODEL", "deepseek-v4-flash")
PORT = int(os.environ.get("PORT", "8080"))

# Clear proxy for DuckDB ai
for k in list(os.environ.keys()):
    if 'proxy' in k.lower():
        del os.environ[k]

# ── Init DuckDB for AI + caching ──
import duckdb
_ai_db = None

def _get_ai_db():
    global _ai_db
    if _ai_db is None:
        db_path = os.path.join(DIR, "data", "app_cache.duckdb")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        _ai_db = duckdb.connect(db_path)
        try:
            _ai_db.execute("INSTALL ai FROM community")
            _ai_db.execute("LOAD ai")
            _ai_db.execute("SET duckdb_ai_provider = 'openai'")
            _ai_db.execute(f"SET duckdb_ai_base_url = '{MOONBRIDGE_URL.rsplit('/v1', 1)[0]}/v1'")
            _ai_db.execute(f"SET duckdb_ai_model = '{AI_MODEL}'")
            _ai_db.execute("CREATE SECRET IF NOT EXISTS moon_ai (TYPE duckdb_ai, AI_PROVIDER 'openai', API_KEY 'moonbridge')")
            print(f"[App] DuckDB AI ready: {AI_MODEL}", flush=True)
        except Exception as e:
            print(f"[App] AI extension not available: {e}", flush=True)
        # Create cache table
        _ai_db.execute("""
            CREATE TABLE IF NOT EXISTS sql_cache (
                question TEXT PRIMARY KEY,
                sql TEXT,
                hits INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT now()
            )
        """)
    return _ai_db


class AppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_POST(self):
        if self.path == "/api/ai":
            self._handle_ai_proxy()
        elif self.path == "/api/ai-sql":
            self._handle_ai_sql()
        else:
            self.send_error(405, "Method Not Allowed")

    def _handle_ai_proxy(self):
        """Proxy AI requests to MoonBridge."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            req_data = json.loads(body)

            for field in ("messages", "model"):
                if field not in req_data:
                    self._json_error(400, f"Missing field: {field}")
                    return

            moon_req = urllib.request.Request(
                MOONBRIDGE_URL,
                data=json.dumps(req_data).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer moonbridge",
                },
                method="POST",
            )
            with urllib.request.urlopen(moon_req, timeout=60) as resp:
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self._json_error(e.code, f"MoonBridge error: {e.reason}")
        except Exception as e:
            self._json_error(500, str(e))

    def _handle_ai_sql(self):
        """Generate SQL via DuckDB AI with caching."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            req_data = json.loads(body)
            question = req_data.get("question", "").strip()
            schema_hint = req_data.get("schema", "")

            if not question:
                self._json_error(400, "Missing question")
                return

            db = _get_ai_db()

            # Check cache (substring match for similar questions)
            cached = None
            try:
                # Exact match first
                r = db.execute(
                    "SELECT sql, hits FROM sql_cache WHERE question = ?", [question]
                ).fetchone()
                if r:
                    cached = r[0]
                    db.execute(
                        "UPDATE sql_cache SET hits = hits + 1 WHERE question = ?",
                        [question],
                    )
            except Exception:
                pass

            # Also check normalized (lowercase, trimmed) cache
            if not cached:
                norm_q = ' '.join(question.lower().split())
                try:
                    r = db.execute(
                        "SELECT sql, hits FROM sql_cache WHERE question = ?",
                        [norm_q],
                    ).fetchone()
                    if r:
                        cached = r[0]
                        db.execute(
                            "UPDATE sql_cache SET hits = hits + 1 WHERE question = ?",
                            [norm_q],
                        )
                except Exception:
                    pass

            if cached:
                self._send_json({"sql": cached, "cached": True, "hits": r[1]})
                return

            # Generate SQL via DuckDB ai_sql
            prompt = question
            if schema_hint:
                prompt = f"Tables: {schema_hint}\n\nQuestion: {question}"

            try:
                r = db.execute("SELECT ai_sql(?)", [prompt]).fetchone()
                sql = r[0] if r else ""
            except Exception as e:
                # Fallback: return error so frontend can use MoonBridge
                self._json_error(502, f"AI SQL generation failed: {e}")
                return

            if not sql:
                self._json_error(502, "AI returned empty SQL")
                return

            # Cache the result
            try:
                db.execute(
                    "INSERT OR REPLACE INTO sql_cache (question, sql) VALUES (?, ?)",
                    [question, sql],
                )
            except Exception:
                pass

            self._send_json({"sql": sql, "cached": False})

        except Exception as e:
            self._json_error(500, str(e))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _json_error(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg}).encode("utf-8"))

    def log_message(self, fmt, *args):
        if "/api/ai" in str(args) or "/api/ai-sql" in str(args):
            sys.stderr.write(f"[App] {args}\n")

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    _get_ai_db()  # pre-init
    print(f"🚀 ColumnarSheet App Server", flush=True)
    print(f"   Port: {PORT}", flush=True)
    print(f"   AI Proxy: /api/ai → {MOONBRIDGE_URL}", flush=True)
    print(f"   AI SQL:   /api/ai-sql → DuckDB AI + cache", flush=True)
    print(f"   Ready!", flush=True)

    server = http.server.HTTPServer(("0.0.0.0", PORT), AppHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
