#!/bin/sh
if [ ${#FLOOF_SECRET} -lt 16 ]; then echo "Add a Space secret FLOOF_SECRET (16+ letters/numbers) in Settings"; exec sleep infinity; fi
ollama serve &
for i in $(seq 1 60); do curl -s localhost:11434 >/dev/null && break; sleep 1; done
curl -s localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"keep_alive\":-1,\"think\":false}" >/dev/null &
exec caddy run --config /app/Caddyfile --adapter caddyfile
