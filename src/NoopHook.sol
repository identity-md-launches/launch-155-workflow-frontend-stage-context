// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";

/// @notice Swap callbacks that acknowledge the PoolManager without modifying a swap.
/// @dev Only the two enabled callbacks are implemented. Other selectors revert.
/// Deploy with low address bits 0x00c0 and the approved Sepolia PoolManager constructor argument.
contract NoopHook {
    error InvalidPoolManager();
    error NotPoolManager();

    IPoolManager public immutable poolManager;

    constructor(IPoolManager poolManager_) {
        if (address(poolManager_) == address(0)) revert InvalidPoolManager();
        poolManager = poolManager_;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    /// @return selector Acknowledgement of the callback.
    /// @return delta Zero adjustment to specified and unspecified amounts.
    /// @return feeOverride Zero: preserve the pool's configured LP fee.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4 selector, BeforeSwapDelta delta, uint24 feeOverride)
    {
        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    /// @return selector Acknowledgement of the callback.
    /// @return delta Zero adjustment to the unspecified amount.
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4 selector, int128 delta)
    {
        return (IHooks.afterSwap.selector, 0);
    }
}
