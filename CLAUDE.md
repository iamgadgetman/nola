# NOLA — Claude instructions

The homelab dashboard: containers, DBs, UPS, Unraid, SNMP/NAS cards.
Repo: `github.com/iamgadgetman/nola` — **this repo is PUBLIC.**

## Hard rules

- **Never commit lab internals.** Private IPs, hostnames, tokens, and the
  service map do not belong in this repo at any time. Working notes with lab
  detail live in `../NOLA-notes/` — deliberately outside the repo so no git
  command can reach them. Put new notes there, not here.
- **Never `git add -A` / `git add .`** in this tree. Stage named paths only.
  History was sanitized on 2026-07-11; the pre-scrub original is gone.
- **The deployed copy has DIVERGED from this repo.** The live dashboard runs on
  the lab host recorded in your private notes, and its `server.js` contains
  changes that were never committed here. Never wholesale-copy the repo over
  it. Diff first, port individual changes. (Host and path: `../NOLA-notes/`.)

## Layout

| Path | What |
|---|---|
| `dashboard/` | Node/Express backend + static frontend. The main app. |
| `mobile/` | Expo/React Native app. 371 MB of `node_modules`, gitignored. |
| `deploy/<host>/` | Per-host compose files: eagle, falcon, talon, knox, union, holodeck. |
| `workflows/` | n8n workflow JSON. |
| `integrations/`, `voice/`, `discord-bot/` | Adjacent services. |
| `RUNBOOK.md` | Ops reference — start here for anything broken. |
| `SETUP.md` | Build-from-scratch guide. |

`deploy/containy/` is **dead** — containy was decommissioned. Don't reference
it as a live target.

## Commands

```bash
cd dashboard && npm start          # node server.js
cd dashboard && npm run dev        # node --watch server.js
cd mobile   && npm start           # expo start
```

## Traps that have cost real time

- **cAdvisor shows unnamed containers** on Docker 29+ → set
  `DOCKER_API_VERSION=1.40` in the cAdvisor service.
- **The NAS/SNMP card does not read LibreNMS.** LibreNMS `/health/*` returns
  empty, so the card reads Prometheus `node_exporter` instead. Subtract
  `node_zfs_arc_size` or ZFS hosts report ~94% RAM.
- **Mobile OTA updates need an EAS channel.** A branch without a channel makes
  updates silently undeliverable — verify via the `u.expo.dev` manifest curl,
  not the build log.
- `.env` is gitignored; `.env.example` is the tracked template. Keep them in
  sync when adding a variable.

## Conventions

- Branch per change (`feat/…`, `fix/…`), merge to `main`, delete the local
  branch after. Remote branches on GitHub are the durable copy.
- `archive/pre-public-2026-07-11` holds the 36-commit pre-public history in
  sanitized form. Leave it alone.
