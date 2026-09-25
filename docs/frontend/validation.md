# Frontend validation — NOOP Hook

Validated on 2026-09-25 UTC. These are worker observations, not independent certification or publication-check results.

## Delivered behavior

The Vite/React/TypeScript source is under `web/`; the final static export is under `dist/`. Browser configuration is loaded exclusively from `dist/imd-deployment.json`, including chain, addresses, pool parameters, public RPCs, the unchanged network block and the ABI paths. Both pinned implementation ABIs are fetched and hash-verified before the application initializes.

The page explains the no-op smoke test and factory initialization, exposes contract/explorer/ABI links, shows live supply, permissions, PoolManager, pool tick/liquidity/LP fee and wallet balances, and provides buy/sell quotes, explicit sell approvals, simulated swaps and ERC-20 transfer/approve/revoke/allowance/transferFrom controls. It fails closed on configuration, chain, ABI, code or metadata verification failures.

## Commands and results

Run from `web/`, with Node 22.22.2 and npm 10.9.7:

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --cache /tmp/noop-npm-cache` in a clean temporary clone | Passed using the delivered lockfile; 0 npm audit vulnerabilities; no `.imd/reads/` inputs present |
| Clean-clone `npm run build` and `npm run verify` | Passed; all 7 exported files byte-identical to the validated workspace export |
| `npm run typecheck` | Passed, no TypeScript errors |
| `npm run build` | Passed; relative Vite base; 6 inventoried assets plus manifest |
| `npm run verify` | Passed; all final bytes, pinned ABIs and handoff fields match |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/noop-browsers npm test` | 17 passed, 0 failed, 21.1 seconds |
| Axe WCAG 2 A/AA and 2.1 AA scan | 0 violations; 28 rule categories passed; color-contrast includes an incomplete/manual-review category |
| `node scripts/read-chain.mjs` | Live public RPC reads succeeded; no transactions sent |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/noop-browsers node scripts/browser-live.mjs` | Real browser/RPC load succeeded; no console errors, failed resources or horizontal overflow |

The production bundle is about 163 kB gzip for the principal JavaScript file. Vite reports its advisory 500-kB uncompressed chunk threshold (536,094 bytes); the whole export is 569,322 bytes. No external fonts, images, scripts or CDN assets are needed to serve it. Runtime wallet/RPC operations require connectivity. Browser dependencies and npm caches live in ignored directories or `/tmp`, and are excluded from delivery.

## Interaction evidence

Tests run Chromium against the production files at `/ipfs/noop/` with mocked EIP-1193 and RPC responses. The suite covers:

- Disconnected, missing-wallet and rejected-connection states; disabled transaction controls.
- Wrong wallet chain, switch failure 4902, exact handoff add-chain parameters, second switch and recovery.
- Native buy quote and integer slippage; decoded router destination, command, actions, pool key, input/output currencies, amounts, value and deadline; receipt confirmation.
- Sell approval ordering, exact token allowance to Permit2, exact expiring Permit2 allowance to the configured router, then the swap.
- Zero/over-precision/insufficient amounts, invalid slippage, input edits, quote expiration and wallet account changes.
- Empty deployed code, RPC chain mismatch, uninitialized pool, quote revert and router simulation revert; no wallet send on failure.
- ERC-20 transfer, allowance lookup, zero-value revocation and delegated transfer.
- Tampered ABI and missing network configuration, both preventing app initialization.
- Keyboard skip link, focus on invalid amount, named controls, expanded token/deployment details, and horizontal overflow at 1440, 390 and 320 CSS-pixel widths.

The initial run passed 14/15 tests; the remaining token selector label lookup was repaired with an explicit accessible name. A CSS build import mistake was also removed before the passing build. Later review fixes moved form errors next to actions, focused invalid fields, exposed the connected wallet in the mobile swap panel, and prevented unrelated hash navigation from changing swap direction. The final 17-test run contains no retries or skipped tests.

Machine-readable results: [browser-results.json](browser-results.json), [accessibility.json](accessibility.json). Visually inspected screenshots: [desktop](desktop.png), [mobile](mobile.png), [live Sepolia desktop](live-desktop.png). Mocked screenshots demonstrate funded/liquid fixture states, not the actual pool's liquidity.

## Live Sepolia observations

[RPC evidence](live-chain.json) at block **11,777,497** confirmed chain ID **11155111**, nonempty code for both deployed contracts and all six configured Uniswap contracts, supply **1000000000000000000000000000** minor units, 18 decimals, the expected PoolManager, and precisely `beforeSwap`/`afterSwap` permissions. Slot0 was initialized, with tick 177284 and LP fee 3000, but active liquidity was **0**.

[Live browser evidence](live-browser.json) at block **11,777,518** successfully loaded and verified that state through the public RPC in Chromium. It displayed “No active liquidity” and disabled the quote button. This check used no injected wallet and generated no signatures or transactions.

No live buy, sell, token approval, transfer, gas estimation with funds, wallet extension signature, or transaction receipt was tested. Transaction paths were validated with mocks only. The supplied pool currently has no active liquidity, and this assignment does not add liquidity. Safari, Firefox, physical devices, screen-reader output and multiple installed wallet providers were not tested. Worker tests do not replace the later immutable-CID, named-entrypoint or RPC publication checks; no site was published or contract redeployed.

## Vercel Web Interface Guidelines review

Source: [current Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), retrieved 2026-09-25 UTC. Retrieved SHA-256: `5a775e6411f790f518dbc9c1fa7c50a89e6873502d9a3530a6eb223a590bcfe8`.

Scope: `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`, and the configuration/chain/protocol code that controls their loading, error and transaction states. Review covered accessibility, keyboard/focus, labels/forms, content overflow, responsive behavior, reduced motion, typography, navigation, async states and local asset performance. Applicable findings were fixed:

| File:line in delivered source | Finding and fix |
| --- | --- |
| `web/src/App.tsx:1099` | Ambiguous exact selector-label lookup; added explicit `Action` accessible name. Native select remains keyboard operable. |
| `web/src/App.tsx:557` | Direction group's accessible label lacked group semantics; added `role="group"`; direction buttons expose pressed state. |
| `web/src/App.tsx:672`, `:1160`, `:222` | Errors were remote from forms; moved them inline and focus the invalid amount, slippage or address control. Async errors are announced. |
| `web/src/App.tsx:553` | Header account text is hidden at narrow widths; added a linked connected-address summary inside the swap panel. |
| `web/src/styles.css:953` | Full supply wrapped through digits on mobile; widened its statistics cell. Large raw liquidity uses locale-aware scientific notation. Rechecked at 320/390 px. |
| `web/src/App.tsx:148` | Navigation to informational anchors could reset sell direction; only `#buy`/`#sell` update direction. |
| `web/src/styles.css:107`, `:975` | Verified visible focus and reduced-motion handling; no endless animation, motion dependency or focus-obscuring fixed overlay. |

Reviewed controls use buttons/links/labels, input names and autocomplete settings; zoom remains enabled, numeric values are tabular, long hashes/addresses wrap, layout honors safe areas, and errors and pending/rejected/confirmed states have visible copy. Transaction prerequisites intentionally override the guideline preference to keep submit buttons enabled. Form amounts are ephemeral and do not autosend or autosave; there is no destructive on-page action without a separate wallet confirmation. System fonts and CSS artwork avoid remote assets. Browser/axe results supplement this review; they do not establish complete WCAG conformance. Remaining automated contrast uncertainty needs manual assistive-technology review; no measured contrast violation was reported.

## Artifact integrity and scope

Deployed source commit: `04308f31e6c8e005196c787b13261e6a23c7122e`.

| Contract | Canonical ABI Keccak-256 |
| --- | --- |
| NoopToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| NoopHook | `d320dbd632c7d41b49b3a49cc0a8fab95742761dfafaecc0412f1a74f4a17004` |

Final manifest SHA-256: `e06893a81db43b9adbc9e46e40f4f303a04402d7e37b32073ee93d4765b66522`.

The manifest covers every other exported file, excludes itself, and retains the complete handoff contract set, identifiers, source commit, attestation hash and network object. Six assets are declared; the largest is 536,094 bytes. The entire export is well below both the per-file limit and the HTTP response budget. Source plus export and evidence occupy about 1.35 MB before Git compression. No root configuration, deployed contract source, protected paths, submodule, dependency archive or generated dependency/cache directory is included. Explicit ignore-file budget: only `web/.gitignore`, 178 bytes out of 1 KiB allowed by this implementation plan.

Build/install/preview/reproduction instructions and configuration limits are in [web/README.md](../../web/README.md).

## Git delivery environment

The shared checkout mounts `.git/` read-only. An attempted `git add` failed creating `.git/index.lock` with `Read-only file system`, before staging or committing anything. The allowed-path files remain ready for the worker's source collector. For a reviewable committed artifact, an isolated temporary clone preserves the base history and receives only these allowed-path changes; its full submission bundle is `/tmp/noop-frontend.bundle`. This does not change the protected checkout metadata or publish to a remote. The final response reports the bundle commit and measured bytes.
