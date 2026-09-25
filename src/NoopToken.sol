// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply token for the Sepolia no-op hook smoke test.
/// @dev The deploying factory receives all 10^27 minor units. No subsequent mint or burn path exists.
contract NoopToken is ERC20 {
    constructor() ERC20("Noop Hook Token", "NOOP") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}
