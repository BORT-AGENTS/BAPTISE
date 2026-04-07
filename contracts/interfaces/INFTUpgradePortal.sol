// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title INFTUpgradePortal - Interface for NFT Upgrade Portal
 * @dev Allows users to upgrade existing ERC-721 NFTs into BAP-578 compliant agents
 */
interface INFTUpgradePortal {
    // ============ ENUMS ============

    enum UpgradeStatus {
        None,       // No upgrade exists
        Active,     // NFT locked, agent active
        Unwrapped   // Agent terminated, original returned
    }

    // ============ STRUCTS ============

    struct UpgradeRecord {
        address originalCollection;     // Source ERC-721 contract
        uint256 originalTokenId;        // Source token ID
        address agentContract;          // Deployed BAP-578 agent proxy address
        uint256 agentTokenId;           // Token ID within agent contract (always 1)
        address upgrader;               // User who performed upgrade
        uint256 upgradeTimestamp;       // When upgrade occurred
        uint256 unwrapTimestamp;        // When unwrap occurred (0 if active)
        UpgradeStatus status;           // Current status
        string originalTokenURI;        // Cached tokenURI from original
    }

    struct UpgradeParams {
        address collection;             // ERC-721 collection address
        uint256 tokenId;                // Token ID to upgrade
        string agentName;               // Name for the BAP-578 agent
        string agentSymbol;             // Symbol for the BAP-578 agent
        address logicAddress;           // Logic contract (address(0) = use default)
        string metadataURI;             // IPFS URI for agent metadata
    }

    // ============ EVENTS ============

    event NFTUpgraded(
        uint256 indexed upgradeId,
        address indexed originalCollection,
        uint256 indexed originalTokenId,
        address agentContract,
        uint256 agentTokenId,
        address upgrader
    );

    event NFTUnwrapped(
        uint256 indexed upgradeId,
        address indexed originalCollection,
        uint256 indexed originalTokenId,
        address agentContract,
        address upgrader
    );

    event UpgradeFeeUpdated(uint256 oldFee, uint256 newFee);
    event CollectionWhitelistUpdated(address indexed collection, bool whitelisted);
    event WhitelistModeUpdated(bool enabled);
    event DefaultLogicUpdated(address indexed oldLogic, address indexed newLogic);
    event AgentFactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event BatchUpgradeCompleted(address indexed upgrader, uint256 count);

    // ============ CORE FUNCTIONS ============

    function upgrade(UpgradeParams calldata params) external payable returns (uint256 upgradeId);
    function batchUpgrade(UpgradeParams[] calldata paramsList) external payable returns (uint256[] memory upgradeIds);
    function unwrap(uint256 upgradeId) external;

    // ============ VIEW FUNCTIONS ============

    function getUpgradeRecord(uint256 upgradeId) external view returns (UpgradeRecord memory);
    function getUpgradeByOriginal(address collection, uint256 tokenId) external view returns (uint256 upgradeId);
    function getUpgradeByAgent(address agentContract) external view returns (uint256 upgradeId);
    function getUserUpgrades(address user) external view returns (uint256[] memory);
    function isCollectionWhitelisted(address collection) external view returns (bool);
    function getUpgradeFee() external view returns (uint256);
    function getTotalUpgrades() external view returns (uint256);
}
