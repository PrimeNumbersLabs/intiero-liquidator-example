# Intiero Liquidation Bot (example)

A minimal reference bot for the [Intiero public testnet](https://testnet.intiero.com).
It watches the free public API for positions whose health factor has dropped
below 1 and executes `liquidationCall` against the pool, earning the
liquidation bonus in test tokens.

Use it to learn how liquidations work before they ever matter with real value,
or as a starting point for your own strategy.

## How it works

1. Polls `GET /api/liquidations`, which lists every open debt position across
   the three testnet chains with live health factors.
2. For each liquidatable position, fetches `GET /api/position/:chainId/:address`
   for the per-asset breakdown.
3. Repays up to 50% of the largest debt asset (the protocol close factor) and
   receives the equivalent value of the largest collateral asset plus a
   liquidation bonus (typically 5-10%).

## Quick start

```bash
git clone https://github.com/PrimeNumbersLabs/intiero-liquidator-example
cd intiero-liquidator-example
npm install

cp .env.example .env
# put a TESTNET-ONLY private key in .env

node bot.mjs
```

You need the debt asset in your wallet to repay it. Mint any test token for
free at the [Faucet](https://testnet.intiero.com/faucet), and testnet gas from
any Sepolia / Arbitrum Sepolia / Base Sepolia faucet.

## Public API

Free, no key required, CORS-open. Base URL: `https://testnet.intiero.com/api`

| Endpoint | Description |
| --- | --- |
| `GET /liquidations` | Open positions ranked by health factor |
| `GET /position/:chainId/:address` | Per-asset collateral and debt for one wallet |
| `GET /markets` | Reserves, rates, sizes, prices, TVL for all chains |
| `GET /history/:chainId/:asset?days=30` | Rate and size history |
| `GET /status` | Chain and indexer health |

Full reference: [testnet.intiero.com/status](https://testnet.intiero.com/status)

## Safety notes

- **Never put a mainnet private key in `.env`.** Create a fresh wallet for this.
- The bot uses a naive strategy (biggest debt, biggest collateral). Real
  liquidators optimize for bonus after gas and simulate before sending.
- Health factors move constantly with interest accrual; a position that is
  liquidatable at scan time can be healthy again by the time your transaction
  lands. The contract will simply revert, costing only testnet gas.

## License

MIT
