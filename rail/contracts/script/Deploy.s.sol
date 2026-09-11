// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {PolicyEngine} from "@chainlink/policy-management/core/PolicyEngine.sol";
import {RewallTestVault} from "../RewallTestVault.sol";

interface IERC20Metadata {
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice Deploys the ACE policy engine and the vault, then registers an existing token with them.
/// @dev The policy engine opens with defaultAllow so a fresh rail permits every action until a
///      policy is added, which is what makes the compliance leg observable without configuring it.
///      No token is deployed. Circle's USDC cannot be minted here, so the deployer's balance is
///      whatever a human sent it, and the approval below is what lets pnpm run deposit spend it.
contract Deploy is Script {
    // Circle's Sepolia USDC, 6 decimals, obtainable only from Circle's own faucet
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPK);
        address ticketSigner = vm.envAddress("TICKET_SIGNER");
        IERC20Metadata token = IERC20Metadata(vm.envOr("TOKEN_ADDRESS", SEPOLIA_USDC));

        console.log("Deployer:     ", deployer);
        console.log("Ticket signer:", ticketSigner);
        console.log("Token:        ", address(token));
        console.log("Token decimals:", token.decimals());
        console.log("Deployer holds:", token.balanceOf(deployer));

        vm.startBroadcast(deployerPK);

        RewallTestVault vault = new RewallTestVault("CompliantPrivateTokenDemo", "0.0.1", ticketSigner);

        // One engine per token, since attach keys on the calling vault and reverts on a second call
        PolicyEngine engineImpl = new PolicyEngine();
        bytes memory initData = abi.encodeWithSelector(PolicyEngine.initialize.selector, true, deployer);
        ERC1967Proxy engine = new ERC1967Proxy(address(engineImpl), initData);

        token.approve(address(vault), type(uint256).max);
        vault.register(address(token), address(engine));

        vm.stopBroadcast();

        // Concatenated rather than passed as a second argument, which would print a space after the equals
        console.log("");
        console.log("Copy these into rail/.env");
        console.log("============================================");
        console.log(string.concat("VAULT_ADDRESS=", vm.toString(address(vault))));
        console.log(string.concat("TOKEN_ADDRESS=", vm.toString(address(token))));
        console.log(string.concat("POLICY_ENGINE=", vm.toString(address(engine))));
        console.log("");
        console.log("Copy this into web/.env.local");
        console.log("============================================");
        console.log(string.concat("NEXT_PUBLIC_REWALL_VAULT=", vm.toString(address(vault))));
        console.log("============================================");
    }
}
