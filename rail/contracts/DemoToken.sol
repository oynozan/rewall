// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice A test ERC-20 for the local rail, since the vault moves tokens rather than ether.
/// @dev Minting is restricted to the deployer so one developer's supply cannot be inflated by another.
contract DemoToken is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Rewall Demo Token", "RDEMO") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
