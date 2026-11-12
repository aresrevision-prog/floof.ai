# Floof backup brain on a free Hugging Face Space (CPU basic: 2 cores, 16 GB)
FROM ollama/ollama:latest
ENV MODEL=qwen3:1.7b OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS=/models OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=8192 HOME=/home/user
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.10.2/caddy_2.10.2_linux_amd64.tar.gz" | tar -xz -C /usr/local/bin caddy \
 && mkdir -p /models /home/user && chmod 777 /home/user
RUN ollama serve & for i in $(seq 1 30); do curl -s localhost:11434 >/dev/null && break; sleep 1; done; ollama pull $MODEL && chmod -R a+rwX /models
COPY Caddyfile start.sh /app/
RUN chmod +x /app/start.sh
EXPOSE 7860
ENTRYPOINT []
CMD ["/app/start.sh"]
