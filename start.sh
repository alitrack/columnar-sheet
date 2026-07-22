#!/bin/bash
# ColumnarSheet — Start both Quack Server and Frontend
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🦆 ColumnarSheet"
echo "================"

# Start Quack Server in background
echo ""
echo "[1/2] Starting Quack Server..."
cd "$DIR"
python3 -u server.py &
QUACK_PID=$!
sleep 2

# Verify Quack is running
if ! kill -0 $QUACK_PID 2>/dev/null; then
    echo "❌ Quack Server failed to start!"
    exit 1
fi

# Start frontend HTTP server
echo "[2/2] Starting Frontend server..."
python3 -m http.server 8080 --directory "$DIR" &
HTTP_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ColumnarSheet is running!"
echo ""
echo "   Frontend : http://localhost:8080"
echo "   Quack    : localhost:9494"
echo "   Token    : columnar-sheet-token-2026"
echo ""
echo "   Open http://localhost:8080 in your browser"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all servers."

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $QUACK_PID 2>/dev/null
    kill $HTTP_PID 2>/dev/null
    wait
    echo "Done."
}

trap cleanup INT TERM
wait
