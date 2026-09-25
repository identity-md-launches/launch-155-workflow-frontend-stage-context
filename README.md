# NOOP — Sepolia no-op hook

Contract implementation for the `univ4_hook` swarm smoke test. `NoopHook` acknowledges swaps without
changing their amounts or fees. `NoopToken` is a plain ERC-20 named **Noop Hook Token**, symbol
**NOOP**, with 18 decimals. Its zero-argument constructor mints exactly **1,000,000,000 tokens**
(**1000000000000000000000000000**, or **10^27**, minor units) to `msg.sender` alone.

## Build and test offline

Prerequisites supplied by the execution environment: Foundry and native Solidity **0.8.26** installed
in Foundry's normal compiler cache. Python 3 is only needed to regenerate or compare ABI exports.
`foundry.toml` pins the compiler by version, enables offline mode and targets Cancun. It does not use
a compiler executable path. FFI and Foundry filesystem permissions are disabled.

```sh
forge build
forge test
forge fmt --check
python3 scripts/export_abis.py --check
```

All Solidity dependencies are ordinary files in `lib/`; there are no submodules or dependency
installation steps. `dependencies.json` records source repositories, immutable commits, downloaded
archive SHA-256 hashes and the selected files. Third-party sources retain their upstream licenses.
The project uses the OpenZeppelin 5.2.0 ERC-20 dependency closure, forge-std 1.9.7, pinned v4-core,
and v4-core's pinned Solmate `Owned` dependency. No compiler binary is part of this project.

The delivered suite covers exact supply and factory allocation, ordinary and delegated transfers,
allowances and failures, unavailable mint/burn/admin paths, constructor address permissions,
unauthorized callbacks, factory-shaped initialization by an unrelated caller, duplicate initialization,
actual swaps and liquidity withdrawal through a real local PoolManager, unsettled-swap rollback,
and zero hook balances/deltas. Differential fuzzing compares exact-input and exact-output swaps in
both directions against an otherwise identical pool without a hook. Each fuzz test runs 256 cases.
The suite also checks deployed token and hook bytecode for proxy/destruction opcodes.

## Contracts and ABI

| Artifact | Purpose | Constructor |
| --- | --- | --- |
| `src/NoopToken.sol:NoopToken` | Immutable ERC-20 behavior; all initial supply goes to deployer | No arguments |
| `src/NoopHook.sol:NoopHook` | No-op swap callbacks | One `IPoolManager` address |
| `src/HookFlags.sol:HookFlags` | Internal address-bit helpers for verification | Library; no deployment needed |

Machine-readable ABIs are in [docs/abi/NoopToken.json](docs/abi/NoopToken.json) and
[docs/abi/NoopHook.json](docs/abi/NoopHook.json). See [ABI notes](docs/abi/README.md).
After changing a contract, run `forge build` then `python3 scripts/export_abis.py`.

`NoopHook.getHookPermissions()` enables **beforeSwap and afterSwap only**. Both callbacks require
the immutable PoolManager as the actual caller; their `sender` argument confers no authority.
`beforeSwap` returns its selector, a zero `BeforeSwapDelta`, and a zero fee override. `afterSwap`
returns its selector and zero. Every other permission is false, including `beforeInitialize` and
all four return-delta permissions. Unimplemented selectors revert.

Neither contract has an owner, pause mechanism, upgrade path, allowlist, fee skim, public mint,
or burn function. The hook makes no external calls, holds no accounting state and never transfers
assets. There is no router/pad binding, pool allowlist or user gating. The constructor rejects the
zero PoolManager and address bits that disagree with the declared permissions. The manager argument
is configurable for local testing; the approved launch must use the exact Sepolia address below.

## Deployment handoff

| Parameter | Approved value or responsibility |
| --- | --- |
| Network | Sepolia only, chain ID `11155111` |
| Manifest kind | `univ4_hook` |
| Token contract | `NoopToken`, no constructor arguments |
| Token metadata | `Noop Hook Token` / `NOOP` / 18 decimals |
| Hook contract | `NoopHook` |
| Hook constructor arguments | Exactly `["0xE03A1074c86CFeDd5C142C4F04F1a1536e203543"]` |
| Hook permissions | `beforeSwap`, `afterSwap` |
| Hook address mask | `(uint160(address) & 0x3fff) == 0x00c0` (192) |
| Site label | `noop-hook` |

The Sepolia address is also listed in [Uniswap's deployment reference](https://developers.uniswap.org/docs/protocols/v4/deployments).
The token must be created by the launch factory itself, so the factory receives the full 10^27
minor units at construction. Deploying through an unrelated helper would allocate the supply to
that helper. Do not put totalSupply or allocation bps in `launch.json`.

The hook constructor argument is only the literal PoolManager address; there are no owner, token,
pad, authority or placeholder arguments. The factory opens the pool with `PoolManager.initialize`.
Initialization needs no hook authorization and may be called by any otherwise valid caller.

The deployment service must mine a CREATE2 salt for the **actual CREATE2 deployer** and the final
`NoopHook` creation code concatenated with `abi.encode(PoolManager)`. Compute the predicted address
as the low 20 bytes of `keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))`, and accept only
the address mask above. Compiler settings, constructor arguments and the deployer affect this
calculation; local test salts are not deployment salts. The constructor independently validates all
14 bits. This follows [Uniswap's hook address rules](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks).

The quote currency, pool fee, tick spacing, starting price, liquidity amount/range, funding source,
CREATE2 deployer and salt are launch-service decisions not specified by the approved requirements.
Local tests use an ERC-20 quote asset, fee 3000, spacing 60, a 1:1 starting price and ticks -600 to 600;
these are test fixtures, not production launch parameters. A zero hook fee preserves ordinary
PoolManager LP/protocol fees. This hook does not manage dynamic fees; use the launch's chosen static
LP fee. The test settlement router is ERC-20-only scaffolding, not a production deployment artifact.

## Responsibilities and limits

This source assignment supplies contracts, tests and ABI exports. The separate manifest assignment
writes `launch.json`; an independent reviewer inspects the accepted source and manifest and reports
concrete source, constructor, policy or authorization conflicts. Policy decisions and signed artifact
linkage belong to services. Local testing here does not claim independent review or admission.

After review, services publish source, attest, admit, deploy and verify on Sepolia, then start the
frontend. Before deployment they must verify the chain, manager code, final creation code and mined
address, factory allocation, pool parameters and funding. A rehearsal against the actual Sepolia
manager is still a service responsibility: local tests deploy a real v4 PoolManager at its own
address and are not a fork rehearsal or a claim about a funded launch.

The subsequent `noop-hook` site should explain the swarm smoke-test purpose, show live NOOP and
NoopHook addresses with Sepolia explorer links, and state that the factory opens the pool. GitHub
publication and IPFS hosting are approved workflow outcomes handled after this contract stage.
There are no live deployment addresses or transactions produced by this assignment.

Operational assumptions: the configured manager is the genuine v4 deployment and pool assets settle
normally. Arbitrary callers can initialize pools using this hook; it offers no launch reservation or
anti-front-running protection. The contracts have no rescue or recovery powers; tokens accidentally
sent to the hook cannot be recovered through it. Normal liquidity ownership, approvals and router
slippage controls remain the responsibility of liquidity providers and traders. Independent
adversarial review remains required before release.
