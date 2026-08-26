/**
 * Intiero liquidation bot - reference implementation.
 *
 * Watches the free public API for positions with health factor < 1 and
 * executes liquidationCall against the pool. Testnet only: profits are in
 * test tokens, gas is testnet ETH, and the goal is to learn the mechanic.
 *
 * Usage:
 *   cp .env.example .env   # add your PRIVATE_KEY
 *   npm install
 *   node bot.mjs
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';

// ─── Config ──────────────────────────────────────────────────────────────

const API = process.env.INTIERO_API || 'https://testnet.intiero.com/api';
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const CLOSE_FACTOR = 0.5; // protocol allows repaying up to 50% of one debt asset
const MIN_DEBT_USD = Number(process.env.MIN_DEBT_USD || 10); // skip dust

const RPC = {
  11155111: process.env.RPC_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
  421614: process.env.RPC_ARBITRUM_SEPOLIA || 'https://arbitrum-sepolia-rpc.publicnode.com',
  84532: process.env.RPC_BASE_SEPOLIA || 'https://base-sepolia-rpc.publicnode.com',
};

// Load .env without a dependency
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Set PRIVATE_KEY in .env (a testnet-only wallet, never reuse a mainnet key).');
  process.exit(1);
}

const POOL_ABI = [
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

// ─── Helpers ─────────────────────────────────────────────────────────────

async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ─── Core loop ───────────────────────────────────────────────────────────

async function tryLiquidate(chain, position) {
  const rpc = RPC[chain.chainId];
  if (!rpc || !chain.pool) return;

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Per-asset breakdown of the target position
  const pos = await api(`/position/${chain.chainId}/${position.address}`);
  const debts = pos.reserves.filter((r) => r.debt > 0 && (r.debtUsd ?? 0) >= MIN_DEBT_USD);
  const collaterals = pos.reserves.filter((r) => r.collateral > 0);
  if (!debts.length || !collaterals.length) return;

  // Repay the largest debt, take the largest collateral (simplest strategy;
  // a real bot would optimize for the biggest bonus after gas).
  debts.sort((a, b) => (b.debtUsd ?? 0) - (a.debtUsd ?? 0));
  collaterals.sort((a, b) => (b.collateralUsd ?? 0) - (a.collateralUsd ?? 0));
  const debt = debts[0];
  const collateral = collaterals[0];

  const repayAmount = debt.debt * CLOSE_FACTOR;
  const repayRaw = ethers.parseUnits(repayAmount.toFixed(debt.decimals), debt.decimals);

  const token = new ethers.Contract(debt.asset, ERC20_ABI, wallet);
  const balance = await token.balanceOf(wallet.address);
  if (balance < repayRaw) {
    log(`  skip: need ${repayAmount.toFixed(4)} ${debt.symbol}, have ${ethers.formatUnits(balance, debt.decimals)}. Mint at https://testnet.intiero.com/faucet`);
    return;
  }

  const allowance = await token.allowance(wallet.address, chain.pool);
  if (allowance < repayRaw) {
    log(`  approving ${debt.symbol}…`);
    await (await token.approve(chain.pool, ethers.MaxUint256)).wait(1);
  }

  log(`  liquidating ${position.address}: repay ${repayAmount.toFixed(4)} ${debt.symbol}, receive ${collateral.symbol} + bonus`);
  const pool = new ethers.Contract(chain.pool, POOL_ABI, wallet);
  const tx = await pool.liquidationCall(collateral.asset, debt.asset, position.address, repayRaw, false);
  const receipt = await tx.wait(1);
  log(`  done in block ${receipt.blockNumber}: ${chain.explorer}/tx/${tx.hash}`);
}

async function scan() {
  const { chains } = await api('/liquidations');
  let found = 0;
  for (const chain of chains) {
    if (chain.error) continue;
    for (const position of chain.positions) {
      if (!position.liquidatable) continue;
      found += 1;
      log(`[${chain.name}] HF=${position.healthFactor?.toFixed(4)} debt=$${position.totalDebtUsd.toFixed(0)} ${position.address}`);
      try {
        await tryLiquidate(chain, position);
      } catch (e) {
        log(`  failed: ${e.shortMessage || e.message}`);
      }
    }
  }
  if (!found) log('no liquidatable positions right now');
}

log(`Intiero liquidation bot watching ${API} every ${POLL_SECONDS}s`);
await scan();
setInterval(() => scan().catch((e) => log('scan failed:', e.message)), POLL_SECONDS * 1000);
