// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPolicyEngine} from "@chainlink/policy-management/interfaces/IPolicyEngine.sol";

/*
 * Stands in for the Chainlink private transfer vault so the off chain rail can be run locally.
 * Custody, the ACE policy calls, the Deposit event and the withdraw ticket format all match the
 * deployed demo, which is what lets the same clients drive either one. The ticket signer is fixed
 * at deployment, so this exists only because the deployed vault's signer is owned by Chainlink.
 */

// Selectors the policy engine keys its rules on, matching the deployed vault
interface IVaultActions {
    function deposit(address depositor, address token, uint256 amount) external;
    function withdraw(address withdrawer, address token, uint256 amount) external;
    function privateTransfer(address from, address to, address token, uint256 amount) external;
}

contract RewallTestVault is EIP712 {
    using SafeERC20 for IERC20;

    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount, bytes32 indexed withdrawTicketHash);
    event TokenRegistered(address indexed token, address indexed policyEngine, address indexed registrar);
    event TokenUpdated(address indexed token, address indexed policyEngine, address indexed registrar);

    error NoPolicyEngineRegistered(address token);
    error TokenAlreadyRegistered(address token, address registrar);

    mapping(address token => address policyEngine) public sPolicyEngines;
    mapping(address token => address registrar) public sRegistrars;
    mapping(bytes32 digest => bool used) private sUsedWithdrawTickets;

    address public immutable I_WITHDRAW_TICKET_SIGNER;

    bytes32 private constant WITHDRAW_TICKET_TYPEHASH =
        keccak256("WithdrawTicket(address withdrawer,address token,uint256 amount,uint128 nonce,uint64 deadline)");

    constructor(string memory name, string memory version, address withdrawTicketSigner) EIP712(name, version) {
        I_WITHDRAW_TICKET_SIGNER = withdrawTicketSigner;
    }

    /* Registration */

    // Open first come first served, the same as the demo, since only the registrar can later update
    function register(address token, address policyEngine) external {
        require(policyEngine != address(0), "Policy engine required");
        address currentRegistrar = sRegistrars[token];

        if (currentRegistrar == address(0)) {
            sRegistrars[token] = msg.sender;
            sPolicyEngines[token] = policyEngine;
            emit TokenRegistered(token, policyEngine, msg.sender);
            IPolicyEngine(policyEngine).attach();
            return;
        }

        if (currentRegistrar != msg.sender) revert TokenAlreadyRegistered(token, currentRegistrar);

        address previous = sPolicyEngines[token];
        sPolicyEngines[token] = policyEngine;
        emit TokenUpdated(token, policyEngine, msg.sender);
        IPolicyEngine(previous).detach();
        IPolicyEngine(policyEngine).attach();
    }

    /* Custody */

    function deposit(address token, uint256 amount) external {
        address policyEngine = _engineFor(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(msg.sender, token, amount);
        IPolicyEngine(policyEngine).run(_depositArgs(msg.sender, token, amount));
    }

    // Ticket packs a uint128 nonce, a uint64 deadline and a 65 byte signature into 89 bytes
    function withdrawWithTicket(address token, uint256 amount, bytes calldata ticket) external {
        address policyEngine = _engineFor(token);
        require(ticket.length == 89, "Invalid ticket length");

        uint128 nonce = uint128(bytes16(ticket[0:16]));
        uint64 deadline = uint64(bytes8(ticket[16:24]));

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WITHDRAW_TICKET_TYPEHASH, msg.sender, token, amount, nonce, deadline))
        );

        require(ECDSA.recover(digest, ticket[24:89]) == I_WITHDRAW_TICKET_SIGNER, "Invalid withdraw ticket signature");
        require(block.timestamp <= deadline, "Withdraw ticket expired");
        require(!sUsedWithdrawTickets[digest], "Withdraw ticket already used");

        sUsedWithdrawTickets[digest] = true;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, token, amount, digest);
        IPolicyEngine(policyEngine).run(_withdrawArgs(msg.sender, token, amount));
    }

    /* Policy checks the off chain rail simulates before acting */

    function checkDepositAllowed(address depositor, address token, uint256 amount) external view {
        IPolicyEngine(_engineFor(token)).check(_depositArgs(depositor, token, amount));
    }

    function checkWithdrawAllowed(address withdrawer, address token, uint256 amount) external view {
        IPolicyEngine(_engineFor(token)).check(_withdrawArgs(withdrawer, token, amount));
    }

    function checkPrivateTransferAllowed(address from, address to, address token, uint256 amount) external view {
        IPolicyEngine(_engineFor(token)).check(_transferArgs(from, to, token, amount));
    }

    /* Payload builders */

    function _engineFor(address token) private view returns (address) {
        address policyEngine = sPolicyEngines[token];
        if (policyEngine == address(0)) revert NoPolicyEngineRegistered(token);
        return policyEngine;
    }

    function _depositArgs(address depositor, address token, uint256 amount)
        private
        pure
        returns (IPolicyEngine.Payload memory)
    {
        return IPolicyEngine.Payload({
            selector: IVaultActions.deposit.selector,
            sender: depositor,
            data: abi.encode(depositor, token, amount),
            context: ""
        });
    }

    function _withdrawArgs(address withdrawer, address token, uint256 amount)
        private
        pure
        returns (IPolicyEngine.Payload memory)
    {
        return IPolicyEngine.Payload({
            selector: IVaultActions.withdraw.selector,
            sender: withdrawer,
            data: abi.encode(withdrawer, token, amount),
            context: ""
        });
    }

    function _transferArgs(address from, address to, address token, uint256 amount)
        private
        pure
        returns (IPolicyEngine.Payload memory)
    {
        return IPolicyEngine.Payload({
            selector: IVaultActions.privateTransfer.selector,
            sender: from,
            data: abi.encode(from, to, token, amount),
            context: ""
        });
    }
}
