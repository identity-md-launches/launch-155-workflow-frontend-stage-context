// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {NoopToken} from "../../src/NoopToken.sol";

/// @dev Test-only stand-in for a factory which deploys the token and opens a pool.
contract FactoryHarness {
    function deployToken() external returns (NoopToken) {
        return new NoopToken();
    }

    function initialize(IPoolManager manager, PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24) {
        return manager.initialize(key, sqrtPriceX96);
    }
}
