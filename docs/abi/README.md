# ABI exports

These JSON arrays are extracted from the Solidity 0.8.26 Foundry artifacts with
`python3 scripts/export_abis.py`. Verify they match a fresh build with `--check`.

| Contract | External interface |
| --- | --- |
| `NoopToken` | Zero-argument constructor; `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `approve`, `transfer`, `transferFrom`; standard `Transfer`/`Approval` events and ERC-6093 errors |
| `NoopHook` | `constructor(address poolManager_)`; `poolManager`; `getHookPermissions`; `beforeSwap`; `afterSwap` |

The ABI encodes `IPoolManager` and `IHooks` as addresses, `Currency` as an address, and `BalanceDelta`
and `BeforeSwapDelta` as `int256`. `PoolKey` is a tuple of currency0, currency1, fee (`uint24`),
tickSpacing (`int24`) and hooks. `SwapParams` is a tuple of zeroForOne (`bool`), amountSpecified
(`int256`) and sqrtPriceLimitX96 (`uint160`). Negative amounts specify exact input; positive amounts
specify exact output in PoolManager swaps.

`getHookPermissions` returns the 14 named boolean fields in Uniswap's `Hooks.Permissions` order;
only beforeSwap and afterSwap are true. The callback return values are respectively
`(beforeSwap selector, 0, 0)` and `(afterSwap selector, 0)`. Read-only callbacks retain the canonical
v4 selectors. `NotPoolManager` rejects unauthorized callbacks. Constructor failures use
`InvalidPoolManager` for address zero and `HookAddressNotValid(address)` for permission-bit mismatch.
The hook emits no events; trade and pool events are emitted by PoolManager.

`HookFlags` contains only internal library helpers and is not a deployed contract with an external
ABI. Test factories, quote tokens and routers are excluded from the deployment ABI set.
