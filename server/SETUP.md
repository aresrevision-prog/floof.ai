# Floof's own AI machines (free)

Floof Cloud tries: **Oracle machine → Hugging Face backup → Gemini**. Pictures always go to Gemini (the machines are text-only).
Each machine has a secret password; only Floof Cloud (Vercel) knows it. Never paste secrets in chats.

## 1. Oracle Cloud (main, free forever)
1. Sign up at **oracle.com/cloud/free** (asks for a card to check you're real — Always Free isn't charged). Pick a home region near you (e.g. UK South).
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04**  · Shape: **Ampere → VM.Standard.A1.Flex, 4 OCPU, 24 GB**
   - SSH keys: **Generate** → **Save private key**. Create. (If it says "out of capacity", try another availability domain or again later.)
3. Open ports: instance page → **Subnet → Default Security List → Add Ingress Rules** → Source `0.0.0.0/0`, TCP, Destination port `80,443`.
4. Connect: click the **Cloud Shell** icon (top right) → ⚙ → Upload your private key, then:
   ```
   chmod 600 ssh-key-*.key && ssh -i ssh-key-*.key ubuntu@YOUR_PUBLIC_IP
   ```
5. Paste this and wait ~5 min:
   ```
   curl -fsSL https://raw.githubusercontent.com/aresrevision-prog/floof.ai/main/server/oracle-setup.sh | bash
   ```
6. It prints `OWN_AI_URL`, `OWN_AI_KEY`, `OWN_AI_MODEL` → add them in **Vercel → floof.ai → Settings → Environment Variables** → Redeploy.

## 2. Hugging Face (backup, free)
1. **huggingface.co → New Space** → name `floof-brain`, SDK **Docker → Blank**, hardware **CPU basic (free)**, Public.
2. **Settings → Variables and secrets → New secret**: `FLOOF_SECRET` = a long random password (letters+numbers, 16+; e.g. from a password generator).
3. **Files → Add file → Upload** the 4 files from `server/huggingface/` (Dockerfile, Caddyfile, start.sh, README.md). It builds in ~5–10 min.
4. In Vercel add: `OWN_AI_URL2` = `https://YOURNAME-floof-brain.hf.space`, `OWN_AI_KEY2` = the same FLOOF_SECRET → Redeploy.

## Check it
Open `https://floofai.vercel.app/api/chat?check=1` → `"own"` lists your machines; `cooling` shows why one failed.

Notes: free machines have no graphics chip, so replies take a bit longer (Oracle ~5–10 words/s). If a machine is slow or down,
Floof skips it for 2 minutes and uses the next one. Hugging Face sleeps after ~2 days unused (first reply after that is slow).
Oracle may reclaim an Always Free machine that sits almost idle for a week — using Floof regularly keeps it busy.
