#!/usr/bin/env python3
"""
ColumnarSheet App Server
Serves static files + AI proxy to MoonBridge + Quack Server management.
"""
import http.server
import json
import os
import sys
import urllib.request
import urllib.error

DIR = os.path.dirname(os.path.abspath(__file__))
MOONBRIDGE_URL = os.environ.get("MOONBRIDGE_URL", "http://10.10.10.131:38440/v1/chat/completions")
PORT = int(os.environ.get("PORT", "8080"))


class AppHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files + /api/ai proxy to MoonBridge."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_POST(self):
        if self.path == "/api/ai":
            self._handle_ai_proxy()
        else:
            self.send_error(405, "Method Not Allowed")

    def _handle_ai_proxy(self):
        """Proxy AI requests to MoonBridge → DeepSeek."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            req_data = json.loads(body)

            # Validate
            for field in ("messages", "model"):
                if field not in req_data:
                    self._json_error(400, f"Missing field: {field}")
                    return

            # Forward to MoonBridge
            moon_req = urllib.request.Request(
                MOONBRIDGE_URL,
                data=json.dumps(req_data).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer moonbridge",  # moon-bridge doesn't validate
                },
                method="POST",
            )

            with urllib.request.urlopen(moon_req, timeout=60) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(resp_body)

        except urllib.error.HTTPError as e:
            self._json_error(e.code, f"MoonBridge error: {e.reason}")
        except Exception as e:
            self._json_error(500, str(e))

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _json_error(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg}).encode("utf-8"))

    def log_message(self, fmt, *args):
        # Quieter logging
        if "/api/ai" in str(args):
            sys.stderr.write(f"[App] AI proxy: {args}\n")
        else:
            pass  # suppress static file logs

    def end_headers(self):
        # No-cache for development
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    print(f"🚀 ColumnarSheet App Server", flush=True)
    print(f"   Static files: {DIR}", flush=True)
    print(f"   Port: {PORT}", flush=True)
    print(f"   AI backend: MoonBridge → {MOONBRIDGE_URL}", flush=True)
    print(f"   Ready!", flush=True)

    server = http.server.HTTPServer(("0.0.0.0", PORT), AppHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
