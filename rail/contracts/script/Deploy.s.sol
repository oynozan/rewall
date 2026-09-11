// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PolicyEngine} from "@chainlink/policy-management/core/PolicyEngine.sol";
import {DemoToken} from "../DemoToken.sol";
import {RewallTestVault} from "../RewallTestVault.sol";

/// @notice Deploys everything the local rail needs, a token, an ACE policy engine and the vault.
/// @dev The policy engine opens with defaultAllow so a fresh rail permits every action until a
///      policy is added, which is what makes the compliance leg observable without configuring it.
contract Deploy is Script {
    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPK);
        address ticketSigner = vm.envAddress("TICKET_SIGNER");
        uint256 mintAmount = vm.envOr("MINT_AMOUNT", uint256(100 ether));

        console.log("Deployer:     ", deployer);
        console.log("Ticket signer:", ticketSigner);

        vm.startBroadcast(deployerPK);

        DemoToken token = new DemoToken(deployer);
        RewallTestVault vault = new RewallTestVault("CompliantPrivateTokenDemo", "0.0.1", ticketSigner);

        PolicyEngine engineImpl = new PolicyEngine();
        bytes memory initData = abi.encodeWithSelector(PolicyEngine.initialize.selector, true, deployer);
        ERC1967Proxy engine = new ERC1967Proxy(address(engineImpl), initData);

        token.mint(deployer, mintAmount);
        token.approve(address(vault), type(uint256).max);
        vault.register(address(token), address(engine));

        vm.stopBroadcast();

        console.log("");
        console.log("Copy these into rail/.env");
        console.log("============================================");
        console.log("VAULT_ADDRESS=", address(vault));
        console.log("TOKEN_ADDRESS=", address(token));
        console.log("POLICY_ENGINE=", address(engine));
        console.log("============================================");
    }
}
