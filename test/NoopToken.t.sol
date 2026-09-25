// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {NoopToken} from "../src/NoopToken.sol";
import {FactoryHarness} from "./helpers/FactoryHarness.sol";

contract NoopTokenTest is Test {
    uint256 internal constant SUPPLY = 1_000_000_000 * 10 ** 18;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    NoopToken internal token;

    function setUp() public {
        token = new NoopToken();
    }

    function test_MetadataAndExactSupply() public view {
        assertEq(token.name(), "Noop Hook Token");
        assertEq(token.symbol(), "NOOP");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000_000_000_000_000_000_000);
        assertEq(token.balanceOf(address(this)), SUPPLY);
        assertEq(token.balanceOf(address(0)), 0);
    }

    function test_FactoryReceivesEntireSupplyInsteadOfOrigin() public {
        FactoryHarness factory = new FactoryHarness();
        vm.prank(ALICE, ALICE);
        NoopToken launched = factory.deployToken();
        assertEq(launched.balanceOf(address(factory)), SUPPLY);
        assertEq(launched.balanceOf(ALICE), 0);
        assertEq(launched.balanceOf(address(this)), 0);
        assertEq(launched.totalSupply(), SUPPLY);
    }

    function testFuzz_TransfersConserveSupply(uint256 amount) public {
        amount = bound(amount, 0, SUPPLY);
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), SUPPLY - amount);
        vm.prank(ALICE);
        assertTrue(token.transfer(BOB, amount));
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(BOB), amount);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(BOB), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function testFuzz_AllowanceIsSpentExactly(uint256 amount) public {
        amount = bound(amount, 1, SUPPLY);
        token.approve(ALICE, amount);
        vm.prank(ALICE);
        assertTrue(token.transferFrom(address(this), BOB, amount));
        assertEq(token.allowance(address(this), ALICE), 0);
        assertEq(token.balanceOf(BOB), amount);
        assertEq(token.balanceOf(address(this)), SUPPLY - amount);
        assertEq(token.totalSupply(), SUPPLY);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, ALICE, 0, 1));
        vm.prank(ALICE);
        token.transferFrom(address(this), BOB, 1);
    }

    function test_InfiniteAllowanceAndSelfTransfer() public {
        token.approve(ALICE, type(uint256).max);
        vm.prank(ALICE);
        token.transferFrom(address(this), BOB, 1 ether);
        assertEq(token.allowance(address(this), ALICE), type(uint256).max);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.transfer(address(this), beforeBalance);
        assertEq(token.balanceOf(address(this)), beforeBalance);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_InsufficientBalanceRevertsWithoutChangingSupply() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        vm.prank(ALICE);
        token.transfer(BOB, 1);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(BOB), 0);
    }

    function test_TransferAndApprovalToZeroRevert() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSpender.selector, address(0)));
        token.approve(address(0), 1 ether);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
    }

    function test_NoMintBurnOrAdminEntrypointsEvenForDeployer() public {
        string[8] memory signatures = [
            "mint(address,uint256)",
            "mint(uint256)",
            "burn(uint256)",
            "burnFrom(address,uint256)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "initialize(address)",
            "setMinter(address)"
        ];
        for (uint256 i; i < signatures.length; ++i) {
            bytes memory data = abi.encodeWithSignature(signatures[i], ALICE, 1 ether);
            (bool deployerOk,) = address(token).call(data);
            assertFalse(deployerOk, signatures[i]);
            vm.prank(ALICE);
            (bool outsiderOk,) = address(token).call(data);
            assertFalse(outsiderOk, signatures[i]);
        }
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
        assertEq(token.balanceOf(ALICE), 0);
    }
}
