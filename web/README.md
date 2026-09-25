# NOOP Hook Frontend

Static React/TypeScript interface for the attested Sepolia NoopToken and NoopHook deployment. The factory opens the pool. The hook acknowledges `beforeSwap` and `afterSwap`, with zero deltas and no hook fee; the pool retains its 0.3% LP fee. Token supply is exactly 1,000,000,000 NOOP at 18 decimals. There are no admin, mint, burn, upgrade or allowlist controls.

## Install and run

Use Node.js 22.12+ and npm. All frontend tooling lives here; no root build configuration is needed.

```sh
cd web
npm ci --ignore-scripts --cache /tmp/noop-npm-cache
npm run dev
```

`dev` generates local runtime configuration and ABIs in ignored `web/public/`. Production:

```sh
npm run typecheck
npm run build
npm run verify
npm run preview
```

`build` writes repository-root `dist/`, then exports the pinned ABIs and generates `dist/imd-deployment.json` from the final bytes. Keep that entire directory in the submission. Vite uses `base: './'`; only same-page anchors are used. Serve plain files at `/` or a gateway subdirectory. Do not open `index.html` with `file://`, since browsers restrict fetching local JSON. There is no backend, external font service or remote static asset dependency.

## Configuration and integrity

`web/config/deployment.json` and `web/config/network.json` are preserved copies of the supplied handoffs. They are build inputs, never imported into the browser bundle. The single runtime source of deployment addresses, chain, public RPC URLs, ABI paths, pool parameters and Uniswap addresses is `dist/imd-deployment.json`. The additional `manifest` and `walletAddChain` fields preserve the pool definition and exact add-chain parameters. Its `network` object is unchanged from the supplied network block.

The export script reads each ABI with `git show <sourceCommit>:docs/abi/<Contract>.json`, requires the local ABI to match those exact bytes, checks the recursively key-sorted canonical JSON Keccak-256 against the handoff, and exports the raw JSON arrays. A checkout with the deployed commit available is required to rebuild. The manifest inventory includes every exported file except itself, with lowercase SHA-256 hashes. `npm run verify` independently re-enumerates those bytes, enforces the 128-asset/8-MiB-per-file limits, and compares all manifest fields to the source handoffs.

The app fetches this manifest and the named ABI files, verifies ABI hashes, and disables actions if configuration fails. Public reads check chain ID, nonempty code for both contracts and all configured Uniswap contracts, token metadata and supply, hook PoolManager and all 14 permissions. Reads use a single block for state consistency. They refresh every 30 seconds and after a confirmed transaction. The UI's deployment verification describes these checks; it is not an independent cryptographic signature verification of the attestation or an audit of deployed runtime bytecode.

To change deployment, use a new validated handoff and its matching pinned implementation ABIs, then rebuild and verify. Do not edit addresses in components or the generated export. Missing or inconsistent network configuration fails closed. This bounded deployment uses native ETH as paired currency; the interface deliberately disables swaps for non-native pairs rather than guessing their metadata.

## Wallet and transaction flow

- Supports an injected EIP-1193 browser wallet (`window.ethereum`), with account, chain and disconnect event handling. There is no WalletConnect project ID or private credential. Mobile wallets need an injected in-app browser. Multiple-provider discovery and QR/deep-link wallet connections are not implemented.
- Wrong networks show one switch button. Error 4902 or an unknown-chain response triggers `wallet_addEthereumChain` using the supplied parameters, followed by another switch request.
- Public RPCs are tried in handoff order. A connected wallet on the correct chain is the final read fallback. Signing always happens in the visitor's wallet.
- Quotes call the configured v4 quoter through `simulateContract`. They expire in 60 seconds and reset after edits, wallet changes and transactions. Slippage is 0.01–5%, applied with integer arithmetic; minimum received is shown without rounding away minor units.
- Native buys require no approval. Sells first approve the exact amount of NOOP to the configured Permit2, then authorize the configured router for the exact amount for 30 minutes. Each is a separate, simulated wallet transaction. Request a fresh quote after each confirmation.
- Swaps encode the specified `0x10` router command and `0x060c0f` actions, using the handoff pool key. They use a 5-minute deadline, proper native value, SETTLE_ALL and TAKE_ALL parameters, and simulate `execute` before signing. Chain/account are rechecked immediately before the signature request.
- ERC-20 transfer, approve/revoke, allowance read and transferFrom have controls with explicit amounts/addresses. Only the PoolManager may call hook callbacks; there is no direct callback transaction control. Gas costs are separate; wallet confirmation provides the final gas estimate. Pool initialization/liquidity management belongs to the factory and is not added to this assignment.

## Validation

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/noop-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/noop-browsers npm test
node scripts/read-chain.mjs
```

Playwright serves the committed export beneath `/ipfs/noop/`, mocks public RPC and injected-wallet responses for transaction tests, and writes evidence in `docs/frontend/`. No transaction is broadcast by these tests. The read-chain script uses only public read methods and saves timestamped RPC evidence. See [validation](../docs/frontend/validation.md) for results, review findings, screenshots and remaining limitations.

## Submission budget

Only `web/`, `dist/`, and `docs/` are changed. The explicit ignore-file budget is **one file, `web/.gitignore`, at most 1 KiB**. It excludes nested dependency/cache directories, generated development config and browser working reports. `node_modules`, browser binaries, npm caches and dependency archives must not be submitted. The final export, lockfile, source, tests and documented evidence remain deliverables. No publication, IPFS pinning, naming, redeployment or real-wallet transaction is part of worker completion.
