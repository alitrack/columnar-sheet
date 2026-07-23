#!/bin/bash
# ColumnarSheet — Start Quack Server + App Server (static files + AI proxy)
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

# Start App Server (serves static + /api/ai proxy)
echo "[2/2] Starting App Server..."
python3 -u app_server.py &
HTTP_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ColumnarSheet is running!"
echo ""
echo "   Frontend  : http://localhost:8080"
echo "   Quack     : localhost:9494"
echo "   AI Proxy  : /api/ai → MoonBridge (DeepSeek)"
echo "   Token     : columnar-sheet-token-2026"
echo ""
echo "   Open http://localhost:8080 in your browser"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
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
