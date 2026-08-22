# Cloudflare DDNS — example.com

Automatic public IP updates for firewall hostnames via `favonia/cloudflare-ddns`.

---

## Records managed

| Hostname | Site | Host | Public IP (at deploy) |
|---|---|---|---|
| `stop.example.com` | Hawk House | containy (10.0.3.11) | 192.0.2.11 |
| `halt.example.com` | The Fort | union (10.0.4.8) | 192.0.2.12 |

---

## Files

```
deploy/
  containy/
    docker-compose.ddns.yml   # stop.example.com
    .env.ddns                 # CF_API_TOKEN
  union/
    docker-compose.ddns.yml   # halt.example.com
    .env.ddns                 # CF_API_TOKEN
```

---

## Credentials

- **Cloudflare API Token** — scoped to Edit zone DNS for `example.com` only
- Saved in aivault as: `Cloudflare DDNS — example.com API Token`

---

## Deployment

Files are pushed to `~/deploy/ddns/` on each host and started with:

```bash
docker compose --env-file .env up -d
```

### Redeploy

```bash
# containy — stop.example.com
scp deploy/containy/docker-compose.ddns.yml gadget@10.0.3.11:~/deploy/ddns/docker-compose.yml
scp deploy/containy/.env.ddns gadget@10.0.3.11:~/deploy/ddns/.env
ssh gadget@10.0.3.11 "cd ~/deploy/ddns && docker compose --env-file .env up -d"

# union — halt.example.com
scp deploy/union/docker-compose.ddns.yml gadget@10.0.4.8:~/deploy/ddns/docker-compose.yml
scp deploy/union/.env.ddns gadget@10.0.4.8:~/deploy/ddns/.env
ssh gadget@10.0.4.8 "cd ~/deploy/ddns && docker compose --env-file .env up -d"
```

---

## Container config

- **Image:** `favonia/cloudflare-ddns:latest`
- **Network:** `host` — container uses host's WAN interface
- **IP detection:** `cloudflare.trace` — Cloudflare reports what public IP it sees
- **IPv6:** disabled
- **Update interval:** every 5 minutes
- **Proxy:** disabled (DNS-only / grey cloud)

> **Note:** Both records were proxied (orange cloud) in Cloudflare at time of deployment.
> Flip them to DNS-only at: dash.cloudflare.com → example.com → DNS Records.

---

## Additional — union

`qemu-guest-agent` installed and active on union (Proxmox VM). Installed via:

```bash
sudo apt-get install -y qemu-guest-agent
sudo systemctl enable --now qemu-guest-agent
```
