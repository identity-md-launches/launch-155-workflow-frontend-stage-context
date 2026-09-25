// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/// @dev Test-only ERC20 settlement harness; not a production router.
contract SettlementRouter is IUnlockCallback {
    error NotManager();
    IPoolManager internal immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function modifyLiquidity(PoolKey memory key, int256 liquidityDelta) external returns (BalanceDelta) {
        return abi.decode(
            manager.unlock(abi.encode(false, key, abi.encode(liquidityDelta), msg.sender, bytes(""), true)),
            (BalanceDelta)
        );
    }

    function swap(PoolKey memory key, SwapParams memory params, bytes memory hookData, bool settle)
        external
        returns (BalanceDelta)
    {
        return abi.decode(
            manager.unlock(abi.encode(true, key, abi.encode(params), msg.sender, hookData, settle)), (BalanceDelta)
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotManager();
        (bool isSwap, PoolKey memory key, bytes memory params, address payer, bytes memory hookData, bool settle) =
            abi.decode(data, (bool, PoolKey, bytes, address, bytes, bool));
        BalanceDelta delta;
        if (isSwap) {
            delta = manager.swap(key, abi.decode(params, (SwapParams)), hookData);
        } else {
            (delta,) = manager.modifyLiquidity(
                key, ModifyLiquidityParams(-600, 600, abi.decode(params, (int256)), bytes32(0)), hookData
            );
        }
        if (settle) {
            _settle(key.currency0, delta.amount0(), payer);
            _settle(key.currency1, delta.amount1(), payer);
        }
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 amount, address payer) private {
        if (amount < 0) {
            manager.sync(currency);
            require(
                IERC20(Currency.unwrap(currency)).transferFrom(payer, address(manager), uint256(-int256(amount))),
                "transfer failed"
            );
            manager.settle();
        } else if (amount > 0) {
            manager.take(currency, payer, uint128(amount));
        }
    }
}
