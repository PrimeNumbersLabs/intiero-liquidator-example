# Operations Runbook

How to run this bot continuously and what to do when something looks wrong.
The [README](README.md) covers what the bot is; this covers keeping it alive.

## 1. Prerequisites

- Node.js 20+ (`fetch` and top-level `await` are used without polyfills).
- A **testnet-only** wallet holding:
  - gas on all three chains (Sepolia, Arbitrum Sepolia, Base Sepolia);
  - a working balance of the debt assets you intend to repay — mint at
    [testnet.intiero.com/faucet](https://testnet.intiero.com/faucet).
- `.env` populated from `.env.example`.

## 2. Running as a service

### PM2

```bash
npm install -g pm2
pm2 start bot.mjs --name intiero-liquidator --time
pm2 save && pm2 startup   # restart on reboot
pm2 logs intiero-liquidator
```

### systemd

```ini
# /etc/systemd/system/intiero-liquidator.service
[Unit]
Description=Intiero testnet liquidation bot
After=network-online.target

[Service]
WorkingDirectory=/opt/intiero-liquidator-example
ExecStart=/usr/bin/node bot.mjs
Restart=always
RestartSec=10
User=liquidator

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now intiero-liquidator
journalctl -u intiero-liquidator -f
```

## 3. What healthy output looks like

Once per poll (default 60 s) you should see either:

```
2026-08-28T12:00:00.000Z no liquidatable positions right now
```

or, when a position is underwater, a scan line followed by an attempt:

```
[Base Sepolia] HF=0.9421 debt=$122 0xabc…
  liquidating 0xabc…: repay 61.0000 USDC, receive WETH + bonus
  done in block 1234567: https://sepolia.basescan.org/tx/0x…
```

Silence longer than ~2 poll intervals means the process is stuck or dead —
check the process manager first.

## 4. Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| `scan failed: … HTTP 5xx` | API briefly down or restarting | Nothing; the loop retries next poll. Check [testnet.intiero.com/status](https://testnet.intiero.com/status) if it persists >10 min. |
| `scan failed: … HTTP 429` | Polling too aggressively (limit ≈300 req / 5 min / IP) | Raise `POLL_SECONDS`; 60 s is far under the limit, so 429s usually mean multiple bots behind one IP. |
| `skip: need X USDC, have Y` | Wallet lacks the debt asset | Mint at the faucet, or raise `MIN_DEBT_USD` to ignore positions you cannot service. |
| `failed: execution reverted` on `liquidationCall` | Position recovered, or another liquidator won the race | Normal. No action; reverts only cost testnet gas. |
| `failed: insufficient funds for gas` | Out of gas token on that chain | Top up from any public faucet for that chain. |
| Repeated RPC timeouts on one chain | Public RPC degraded | Point the matching `RPC_*` variable at another provider. |
| `degraded` / stale data in API responses | Subgraph reindexing | Wait it out; health factors from `/liquidations` may lag a few minutes. |

## 5. Monitoring

Two cheap checks catch almost everything:

1. **Liveness** — alert if the log has no new line for 5 minutes
   (`pm2 logs` timestamps or `journalctl --since`).
2. **Upstream** — alert on `status != "operational"` from
   `GET https://testnet.intiero.com/api/status` so you can distinguish
   "my bot is broken" from "the testnet is degraded".

## 6. Key rotation / compromise

The key is testnet-only, so the blast radius is zero value — but treat drills
as real:

1. Stop the service.
2. Generate a fresh wallet, update `PRIVATE_KEY` in `.env`.
3. Re-fund gas and debt assets from the faucets.
4. Restart and confirm one healthy scan line.

## 7. Upgrading

```bash
git pull
npm install
pm2 restart intiero-liquidator   # or: systemctl restart intiero-liquidator
```

The bot is stateless — there is nothing to migrate or back up. All position
data comes fresh from the API each scan.
