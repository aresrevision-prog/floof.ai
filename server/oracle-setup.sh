#!/bin/bash
# Floof's own AI machine — run ONCE on an Oracle Cloud "Always Free" Ubuntu machine (Ampere A1, 4 cores, 24 GB):
#   curl -fsSL https://raw.githubusercontent.com/aresrevision-prog/floof.ai/main/server/oracle-setup.sh | bash
# It installs Ollama + a free AI model, adds HTTPS and a secret password, and prints what to put in Vercel.
set -e
MODEL="${MODEL:-qwen3:4b}"
echo "== 1/5 Installing Ollama"; curl -fsSL https://ollama.com/install.sh | sh
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=127.0.0.1:11434"\nEnvironment="OLLAMA_KEEP_ALIVE=-1"\nEnvironment="OLLAMA_NUM_PARALLEL=1"\nEnvironment="OLLAMA_CONTEXT_LENGTH=8192"\n' | sudo tee /etc/systemd/system/ollama.service.d/floof.conf >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable ollama >/dev/null 2>&1 && sudo systemctl restart ollama
for i in $(seq 1 30); do curl -s localhost:11434 >/dev/null && break; sleep 1; done
echo "== 2/5 Downloading the AI model ($MODEL)"; ollama pull "$MODEL"
echo "== 3/5 Installing Caddy (HTTPS)"
sudo apt-get update -qq && sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg iptables-persistent >/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -qq && sudo apt-get install -y -qq caddy >/dev/null
echo "== 4/5 Secret password + firewall"
SECRET_FILE=/etc/floof-secret; [ -f $SECRET_FILE ] || openssl rand -hex 24 | sudo tee $SECRET_FILE >/dev/null; sudo chmod 600 $SECRET_FILE
SECRET=$(sudo cat $SECRET_FILE)
IP=$(curl -s https://api.ipify.org); HOST="$(echo "$IP" | tr . -).sslip.io"
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$HOST {
	@ok header Authorization "Bearer $SECRET"
	handle @ok {
		reverse_proxy 127.0.0.1:11434 {
			flush_interval -1
		}
	}
	respond "Floof brain: wrong or missing password" 401
}
CADDY
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save >/dev/null 2>&1 || true
sudo systemctl restart caddy
echo "== 5/5 Warming up the model"; curl -s localhost:11434/api/generate -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"keep_alive\":-1,\"think\":false}" >/dev/null || true
cat <<DONE

============================================================
 Done! Put these in Vercel → floof.ai → Settings → Environment Variables:

   OWN_AI_URL   = https://$HOST
   OWN_AI_KEY   = $SECRET
   OWN_AI_MODEL = $MODEL

 Then Deployments → ⋯ → Redeploy.   (Keep OWN_AI_KEY private — don't paste it in chats.)
 If https://$HOST doesn't open in a minute: in Oracle's website open your instance →
 Subnet → Default Security List → Add Ingress Rule: source 0.0.0.0/0, TCP, ports 80,443.
 See the secret again any time:  sudo cat /etc/floof-secret
============================================================
DONE
