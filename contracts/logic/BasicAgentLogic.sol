// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @title BasicAgentLogic
 * @dev Standalone logic contract that NFAs can point to via logicAddress.
 *      It doesn't require any changes to existing core contracts.
 *      Provides a simple, generic action handler pattern and emits events
 *      that off-chain systems can react to.
 */
contract BasicAgentLogic {
    /// Emitted when an agent requests an action to be executed.
    event ActionRequested(uint256 indexed tokenId, address indexed caller, string action, bytes payload);

    /// Emitted with the generic result of an action.
    event ActionHandled(uint256 indexed tokenId, string action, bool success, bytes result);

    /// Optional metadata for UIs / discovery.
    string public name;
    string public version;

    constructor(string memory _name, string memory _version) {
        name = _name;
        version = _version;
    }

    /**
     * @notice Generic action entrypoint. Off-chain apps decide the meaning of `action` and `payload`.
     * @param tokenId The agent token id requesting the action
     * @param action A short string key describing the action (e.g., "ping", "analyze")
     * @param payload ABI-encoded parameters for the action
     * @return success Whether action succeeded
     * @return result ABI-encoded optional result data
     */
    function handleAction(
        uint256 tokenId,
        string calldata action,
        bytes calldata payload
    ) external returns (bool success, bytes memory result) {
        emit ActionRequested(tokenId, msg.sender, action, payload);

        // For demo purposes, simply echo the payload back.
        // Real logic contracts can implement domain-specific behavior here.
        success = true;
        result = payload;

        emit ActionHandled(tokenId, action, success, result);
    }
}















