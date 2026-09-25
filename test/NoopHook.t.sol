// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {Pool} from "v4-core/src/libraries/Pool.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {HookFlags} from "../src/HookFlags.sol";
import {NoopHook} from "../src/NoopHook.sol";
import {NoopToken} from "../src/NoopToken.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {FactoryHarness} from "./helpers/FactoryHarness.sol";
import {SettlementRouter} from "./helpers/SettlementRouter.sol";

contract NoopHookTest is Test {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    uint160 internal constant FLAGS = HookFlags.BEFORE_SWAP | HookFlags.AFTER_SWAP;
    uint160 internal constant SQRT_PRICE_1_1 = 1 << 96;
    uint128 internal constant LIQUIDITY = 10_000 ether;

    IPoolManager internal manager;
    NoopHook internal hook;
    NoopToken internal token;
    IERC20 internal token0;
    IERC20 internal token1;
    FactoryHarness internal factory;
    SettlementRouter internal router;
    PoolKey internal key;

    function setUp() public {
        manager = IPoolManager(address(new PoolManager(address(this))));
        token = new NoopToken();
        MockERC20 quote = new MockERC20("Quote", "QUOTE", 1_000_000 ether);
        (token0, token1) = address(token) < address(quote)
            ? (IERC20(address(token)), IERC20(address(quote)))
            : (IERC20(address(quote)), IERC20(address(token)));
        bytes memory initCode = abi.encodePacked(type(NoopHook).creationCode, abi.encode(manager));
        (bytes32 salt, address predicted) = _mine(keccak256(initCode), FLAGS);
        hook = new NoopHook{salt: salt}(manager);
        assertEq(address(hook), predicted);
        factory = new FactoryHarness();
        router = new SettlementRouter(manager);
        key = PoolKey(Currency.wrap(address(token0)), Currency.wrap(address(token1)), 3000, 60, IHooks(address(hook)));
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
    }

    function _mine(bytes32 initCodeHash, uint160 flags) internal view returns (bytes32 salt, address predicted) {
        for (uint256 i; i < 200_000; ++i) {
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(this), bytes32(i), initCodeHash))))
            );
            if (HookFlags.matches(predicted, flags)) return (bytes32(i), predicted);
        }
        revert("salt not found");
    }

    function _seed(PoolKey memory poolKey) internal {
        factory.initialize(manager, poolKey, SQRT_PRICE_1_1);
        router.modifyLiquidity(poolKey, int256(uint256(LIQUIDITY)));
    }

    function _params(bool zeroForOne, int256 amount) internal pure returns (SwapParams memory) {
        return SwapParams(zeroForOne, amount, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
    }

    function test_OnlySwapPermissionsAndMatchingAddress() public view {
        Hooks.Permissions memory expected;
        expected.beforeSwap = true;
        expected.afterSwap = true;
        assertEq(abi.encode(hook.getHookPermissions()), abi.encode(expected));
        assertEq(HookFlags.flagsOf(address(hook)), 0xc0);
        assertEq(address(hook.poolManager()), address(manager));
    }

    function test_ZeroManagerRejected() public {
        vm.expectRevert(NoopHook.InvalidPoolManager.selector);
        new NoopHook(IPoolManager(address(0)));
    }

    function test_MismatchedAddressPermissionsRejected() public {
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(NoopHook).creationCode, abi.encode(manager)));
        (bytes32 salt, address predicted) = _mine(initCodeHash, FLAGS | HookFlags.BEFORE_INITIALIZE);
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new NoopHook{salt: salt}(manager);
    }

    function testFuzz_CallbacksRejectUnauthorizedCallerEvenWithSpoofedSender(address caller) public {
        vm.assume(caller != address(manager));
        SwapParams memory params = _params(true, -1 ether);
        vm.expectRevert(NoopHook.NotPoolManager.selector);
        vm.prank(caller);
        hook.beforeSwap(address(manager), key, params, "");
        vm.expectRevert(NoopHook.NotPoolManager.selector);
        vm.prank(caller);
        hook.afterSwap(address(manager), key, params, BalanceDelta.wrap(0), "");
    }

    function testFuzz_ManagerCallbacksReturnZeroAdjustments(
        address sender,
        bool direction,
        int256 amount,
        int256 rawDelta,
        bytes memory data
    ) public {
        SwapParams memory params = _params(direction, amount);
        vm.prank(address(manager));
        (bytes4 beforeSelector, BeforeSwapDelta beforeDelta, uint24 feeOverride) =
            hook.beforeSwap(sender, key, params, data);
        vm.prank(address(manager));
        (bytes4 afterSelector, int128 afterDelta) =
            hook.afterSwap(sender, key, params, BalanceDelta.wrap(rawDelta), data);
        assertEq(beforeSelector, IHooks.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(beforeDelta), 0);
        assertEq(feeOverride, 0);
        assertEq(afterSelector, IHooks.afterSwap.selector);
        assertEq(afterDelta, 0);
    }

    function test_DisabledInitializeCallbackRevertsWhenCalledDirectly() public {
        vm.expectRevert();
        vm.prank(address(manager));
        IHooks(address(hook)).beforeInitialize(address(factory), key, SQRT_PRICE_1_1);
    }

    function test_FactoryShapedInitializeFromUnrelatedSenderSucceeds() public {
        vm.prank(address(0xCAFE));
        assertEq(factory.initialize(manager, key, SQRT_PRICE_1_1), 0);
        (uint160 price, int24 tick,, uint24 lpFee) = manager.getSlot0(key.toId());
        assertEq(price, SQRT_PRICE_1_1);
        assertEq(tick, 0);
        assertEq(lpFee, 3000);
    }

    function test_AnyCallerCanOpenAnotherPool() public {
        PoolKey memory anotherKey = key;
        anotherKey.fee = 500;
        anotherKey.tickSpacing = 10;
        vm.prank(address(0xABCD));
        manager.initialize(anotherKey, SQRT_PRICE_1_1);
        (uint160 price,,,) = manager.getSlot0(anotherKey.toId());
        assertEq(price, SQRT_PRICE_1_1);
    }

    function test_DuplicateInitializeRejected() public {
        factory.initialize(manager, key, SQRT_PRICE_1_1);
        vm.expectRevert(Pool.PoolAlreadyInitialized.selector);
        factory.initialize(manager, key, SQRT_PRICE_1_1);
    }

    function test_RealSwapInvokesBothCallbacksAndSettlesExactly() public {
        _seed(key);
        SwapParams memory params = _params(true, -1 ether);
        bytes memory hookData = hex"123456";
        vm.expectCall(address(hook), abi.encodeCall(IHooks.beforeSwap, (address(router), key, params, hookData)));
        // A selector prefix records that the real PoolManager also invokes the after callback.
        vm.expectCall(address(hook), abi.encodePacked(IHooks.afterSwap.selector));
        uint256 before0 = token0.balanceOf(address(this));
        uint256 before1 = token1.balanceOf(address(this));
        uint256 manager0 = token0.balanceOf(address(manager));
        uint256 manager1 = token1.balanceOf(address(manager));
        BalanceDelta delta = router.swap(key, params, hookData, true);
        assertEq(delta.amount0(), -1 ether);
        assertGt(delta.amount1(), 0);
        assertEq(before0 - token0.balanceOf(address(this)), 1 ether);
        assertEq(token1.balanceOf(address(this)) - before1, uint128(delta.amount1()));
        assertEq(token0.balanceOf(address(manager)) - manager0, 1 ether);
        assertEq(manager1 - token1.balanceOf(address(manager)), uint128(delta.amount1()));
        _assertNoHookBalancesOrDebt();
    }

    function testFuzz_SwapsMatchPoolWithoutHook(bool zeroForOne, bool exactInput, uint96 rawAmount) public {
        _seed(key);
        PoolKey memory plainKey = key;
        plainKey.hooks = IHooks(address(0));
        _seed(plainKey);
        int256 amount = int256(bound(uint256(rawAmount), 1e6, 10 ether));
        SwapParams memory params = _params(zeroForOne, exactInput ? -amount : amount);
        BalanceDelta hooked = router.swap(key, params, hex"deadbeef", true);
        BalanceDelta plain = router.swap(plainKey, params, "", true);
        assertEq(BalanceDelta.unwrap(hooked), BalanceDelta.unwrap(plain));
        if (zeroForOne) {
            assertLt(hooked.amount0(), 0);
            assertGt(hooked.amount1(), 0);
        } else {
            assertGt(hooked.amount0(), 0);
            assertLt(hooked.amount1(), 0);
        }
        (uint160 hookedPrice,,,) = manager.getSlot0(key.toId());
        (uint160 plainPrice,,,) = manager.getSlot0(plainKey.toId());
        assertEq(hookedPrice, plainPrice);
        _assertNoHookBalancesOrDebt();
    }

    function test_LiquidityCanBeRemovedAfterTradingBothWays() public {
        _seed(key);
        router.swap(key, _params(true, -1 ether), "", true);
        router.swap(key, _params(false, -1 ether), "", true);
        BalanceDelta returned = router.modifyLiquidity(key, -int256(uint256(LIQUIDITY)));
        assertGt(returned.amount0(), 0);
        assertGt(returned.amount1(), 0);
        assertEq(manager.getLiquidity(key.toId()), 0);
        assertEq(token0.balanceOf(address(this)) + token0.balanceOf(address(manager)), token0.totalSupply());
        assertEq(token1.balanceOf(address(this)) + token1.balanceOf(address(manager)), token1.totalSupply());
        _assertNoHookBalancesOrDebt();
    }

    function test_UnsettledSwapRevertsAndRollsBackPoolState() public {
        _seed(key);
        (uint160 beforePrice,,,) = manager.getSlot0(key.toId());
        uint256 before0 = token0.balanceOf(address(manager));
        uint256 before1 = token1.balanceOf(address(manager));
        vm.expectRevert(IPoolManager.CurrencyNotSettled.selector);
        router.swap(key, _params(true, -1 ether), "", false);
        (uint160 afterPrice,,,) = manager.getSlot0(key.toId());
        assertEq(afterPrice, beforePrice);
        assertEq(token0.balanceOf(address(manager)), before0);
        assertEq(token1.balanceOf(address(manager)), before1);
        _assertNoHookBalancesOrDebt();
    }

    function test_ZeroAmountSwapRejected() public {
        _seed(key);
        vm.expectRevert(IPoolManager.SwapAmountCannotBeZero.selector);
        router.swap(key, _params(true, 0), "", true);
    }

    function test_SwapBeforePoolInitializationRejected() public {
        vm.expectRevert(Pool.PoolNotInitialized.selector);
        router.swap(key, _params(true, -1 ether), "", true);
    }

    function test_RuntimeHasNoUpgradeOrDestructionOpcodes() public view {
        _assertNoEscapeHatch(address(hook).code);
        _assertNoEscapeHatch(address(token).code);
    }

    function _assertNoEscapeHatch(bytes memory code) internal pure {
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
            } else {
                assertTrue(op != 0xff && op != 0xf4 && op != 0xf2);
            }
        }
    }

    function _assertNoHookBalancesOrDebt() internal view {
        assertEq(token0.balanceOf(address(hook)), 0);
        assertEq(token1.balanceOf(address(hook)), 0);
        assertEq(token0.balanceOf(address(router)), 0);
        assertEq(token1.balanceOf(address(router)), 0);
        assertEq(manager.currencyDelta(address(hook), key.currency0), 0);
        assertEq(manager.currencyDelta(address(hook), key.currency1), 0);
        assertEq(manager.getNonzeroDeltaCount(), 0);
        assertFalse(manager.isUnlocked());
        assertEq(token.totalSupply(), 1_000_000_000 ether);
    }
}
