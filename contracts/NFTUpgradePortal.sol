// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import "./interfaces/INFTUpgradePortal.sol";
import "./interfaces/ICircuitBreaker.sol";
import "./AgentFactory.sol";
import "./BAP578.sol";

/**
 * @title NFTUpgradePortal
 * @dev Allows users to upgrade existing ERC-721 NFTs into BAP-578 compliant agents.
 *      The original NFT is locked in the portal and a new BAP-578 agent is minted.
 *      Users can unwrap to reclaim their original NFT (agent gets terminated).
 */
contract NFTUpgradePortal is
    INFTUpgradePortal,
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IERC721ReceiverUpgradeable
{
    using CountersUpgradeable for CountersUpgradeable.Counter;

    // ============ CONSTANTS ============

    uint256 public constant MAX_BATCH_SIZE = 10;
    uint256 public constant FACTORY_FEE = 0.01 ether;

    // ============ STATE VARIABLES ============

    ICircuitBreaker public circuitBreaker;
    AgentFactory public agentFactory;

    uint256 public upgradeFee;
    address public defaultLogicAddress;
    bool public whitelistMode;

    CountersUpgradeable.Counter private _upgradeIdCounter;
    mapping(uint256 => UpgradeRecord) private _upgradeRecords;

    // Bidirectional lookups
    mapping(bytes32 => uint256) private _originalToUpgradeId;  // keccak256(collection, tokenId) => upgradeId
    mapping(address => uint256) private _agentToUpgradeId;     // agentContract => upgradeId

    // User tracking
    mapping(address => uint256[]) private _userUpgrades;

    // Collection whitelist
    mapping(address => bool) public whitelistedCollections;

    // Statistics
    uint256 public totalActiveUpgrades;

    // Storage gap for future upgrades
    uint256[50] private __gap;

    // ============ MODIFIERS ============

    modifier whenNotPaused() {
        require(!circuitBreaker.globalPause(), "Portal: system paused");
        require(
            !circuitBreaker.isContractPaused(address(this)),
            "Portal: portal paused"
        );
        _;
    }

    // ============ INITIALIZER ============

    function initialize(
        address circuitBreakerAddr,
        address agentFactoryAddr,
        address defaultLogicAddr,
        uint256 initialUpgradeFee,
        address ownerAddr
    ) public initializer {
        require(circuitBreakerAddr != address(0), "Portal: circuit breaker is zero");
        require(agentFactoryAddr != address(0), "Portal: agent factory is zero");
        require(defaultLogicAddr != address(0), "Portal: default logic is zero");
        require(ownerAddr != address(0), "Portal: owner is zero");

        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        circuitBreaker = ICircuitBreaker(circuitBreakerAddr);
        agentFactory = AgentFactory(agentFactoryAddr);
        defaultLogicAddress = defaultLogicAddr;
        upgradeFee = initialUpgradeFee;

        _transferOwnership(ownerAddr);
    }

    // ============ CORE FUNCTIONS ============

    /**
     * @dev Upgrades an existing ERC-721 NFT into a BAP-578 agent.
     *      User must have approved the portal to transfer their NFT.
     * @param params The upgrade parameters
     * @return upgradeId The ID of the upgrade record
     */
    function upgrade(UpgradeParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256 upgradeId)
    {
        require(msg.value == FACTORY_FEE + upgradeFee, "Portal: incorrect fee");
        upgradeId = _upgrade(params, msg.sender);
    }

    /**
     * @dev Upgrades multiple ERC-721 NFTs in a single transaction.
     * @param paramsList Array of upgrade parameters
     * @return upgradeIds Array of upgrade record IDs
     */
    function batchUpgrade(UpgradeParams[] calldata paramsList)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256[] memory upgradeIds)
    {
        uint256 count = paramsList.length;
        require(count > 0, "Portal: empty batch");
        require(count <= MAX_BATCH_SIZE, "Portal: batch too large");
        require(
            msg.value == count * (FACTORY_FEE + upgradeFee),
            "Portal: incorrect total fee"
        );

        upgradeIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            upgradeIds[i] = _upgrade(paramsList[i], msg.sender);
        }

        emit BatchUpgradeCompleted(msg.sender, count);
    }

    /**
     * @dev Unwraps a BAP-578 agent back to the original NFT.
     *      Caller must be the current owner of the BAP-578 agent token
     *      and must have approved the portal to transfer it.
     * @param upgradeId The ID of the upgrade record
     */
    function unwrap(uint256 upgradeId)
        external
        override
        nonReentrant
        whenNotPaused
    {
        UpgradeRecord storage record = _upgradeRecords[upgradeId];
        require(record.status == UpgradeStatus.Active, "Portal: not active");

        BAP578 agentContract = BAP578(payable(record.agentContract));
        uint256 agentTokenId = record.agentTokenId;

        // Verify caller owns the agent
        require(
            agentContract.ownerOf(agentTokenId) == msg.sender,
            "Portal: caller not agent owner"
        );

        // Transfer agent to portal (caller must have approved)
        agentContract.transferFrom(msg.sender, address(this), agentTokenId);

        // Record balance before terminate to forward any remaining funds
        uint256 balanceBefore = address(this).balance;

        // Terminate the agent (sends remaining balance to ownerOf = portal)
        agentContract.terminate(agentTokenId);

        // Forward any BNB received from termination to the user
        uint256 balanceReceived = address(this).balance - balanceBefore;
        if (balanceReceived > 0) {
            (bool sent, ) = payable(msg.sender).call{value: balanceReceived}("");
            require(sent, "Portal: BNB forward failed");
        }

        // Return original NFT to user
        IERC721(record.originalCollection).transferFrom(
            address(this),
            msg.sender,
            record.originalTokenId
        );

        // Update record
        record.status = UpgradeStatus.Unwrapped;
        record.unwrapTimestamp = block.timestamp;

        // Clear one-to-one mapping so NFT can be re-upgraded
        bytes32 key = _originalKey(record.originalCollection, record.originalTokenId);
        delete _originalToUpgradeId[key];
        delete _agentToUpgradeId[record.agentContract];

        totalActiveUpgrades--;

        emit NFTUnwrapped(
            upgradeId,
            record.originalCollection,
            record.originalTokenId,
            record.agentContract,
            msg.sender
        );
    }

    // ============ INTERNAL ============

    function _upgrade(UpgradeParams calldata params, address upgrader)
        internal
        returns (uint256 upgradeId)
    {
        require(params.collection != address(0), "Portal: collection is zero");

        // Whitelist check
        if (whitelistMode) {
            require(
                whitelistedCollections[params.collection],
                "Portal: collection not whitelisted"
            );
        }

        // One-to-one constraint
        bytes32 key = _originalKey(params.collection, params.tokenId);
        require(
            _originalToUpgradeId[key] == 0,
            "Portal: NFT already upgraded"
        );

        // Transfer original NFT to portal (caller must have approved)
        IERC721(params.collection).transferFrom(
            upgrader,
            address(this),
            params.tokenId
        );

        // Try to cache tokenURI from original
        string memory cachedURI = _tryGetTokenURI(params.collection, params.tokenId);

        // Resolve logic address
        address logicAddr = params.logicAddress != address(0)
            ? params.logicAddress
            : defaultLogicAddress;

        // Create BAP-578 agent via factory (mints to this portal)
        address agentAddr = agentFactory.createAgent{value: FACTORY_FEE}(
            params.agentName,
            params.agentSymbol,
            logicAddr,
            params.metadataURI
        );

        // Agent token ID is always 1 for newly created agent contracts
        uint256 agentTokenId = 1;

        // Transfer agent from portal to user
        BAP578(payable(agentAddr)).transferFrom(
            address(this),
            upgrader,
            agentTokenId
        );

        // Create upgrade record
        _upgradeIdCounter.increment();
        upgradeId = _upgradeIdCounter.current();

        _upgradeRecords[upgradeId] = UpgradeRecord({
            originalCollection: params.collection,
            originalTokenId: params.tokenId,
            agentContract: agentAddr,
            agentTokenId: agentTokenId,
            upgrader: upgrader,
            upgradeTimestamp: block.timestamp,
            unwrapTimestamp: 0,
            status: UpgradeStatus.Active,
            originalTokenURI: cachedURI
        });

        // Update lookups
        _originalToUpgradeId[key] = upgradeId;
        _agentToUpgradeId[agentAddr] = upgradeId;
        _userUpgrades[upgrader].push(upgradeId);

        totalActiveUpgrades++;

        emit NFTUpgraded(
            upgradeId,
            params.collection,
            params.tokenId,
            agentAddr,
            agentTokenId,
            upgrader
        );
    }

    function _originalKey(address collection, uint256 tokenId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(collection, tokenId));
    }

    function _tryGetTokenURI(address collection, uint256 tokenId)
        internal
        view
        returns (string memory)
    {
        try IERC721Metadata(collection).tokenURI(tokenId) returns (
            string memory uri
        ) {
            return uri;
        } catch {
            return "";
        }
    }

    // ============ VIEW FUNCTIONS ============

    function getUpgradeRecord(uint256 upgradeId)
        external
        view
        override
        returns (UpgradeRecord memory)
    {
        return _upgradeRecords[upgradeId];
    }

    function getUpgradeByOriginal(address collection, uint256 tokenId)
        external
        view
        override
        returns (uint256)
    {
        return _originalToUpgradeId[_originalKey(collection, tokenId)];
    }

    function getUpgradeByAgent(address agentContract)
        external
        view
        override
        returns (uint256)
    {
        return _agentToUpgradeId[agentContract];
    }

    function getUserUpgrades(address user)
        external
        view
        override
        returns (uint256[] memory)
    {
        return _userUpgrades[user];
    }

    function isCollectionWhitelisted(address collection)
        external
        view
        override
        returns (bool)
    {
        return whitelistedCollections[collection];
    }

    function getUpgradeFee() external view override returns (uint256) {
        return upgradeFee;
    }

    function getTotalUpgrades() external view override returns (uint256) {
        return _upgradeIdCounter.current();
    }

    // ============ ADMIN FUNCTIONS ============

    function setUpgradeFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = upgradeFee;
        upgradeFee = newFee;
        emit UpgradeFeeUpdated(oldFee, newFee);
    }

    function setWhitelistMode(bool enabled) external onlyOwner {
        whitelistMode = enabled;
        emit WhitelistModeUpdated(enabled);
    }

    function setCollectionWhitelist(address collection, bool whitelisted)
        external
        onlyOwner
    {
        require(collection != address(0), "Portal: collection is zero");
        whitelistedCollections[collection] = whitelisted;
        emit CollectionWhitelistUpdated(collection, whitelisted);
    }

    function batchSetCollectionWhitelist(
        address[] calldata collections,
        bool whitelisted
    ) external onlyOwner {
        for (uint256 i = 0; i < collections.length; i++) {
            require(collections[i] != address(0), "Portal: collection is zero");
            whitelistedCollections[collections[i]] = whitelisted;
            emit CollectionWhitelistUpdated(collections[i], whitelisted);
        }
    }

    function setDefaultLogicAddress(address newLogic) external onlyOwner {
        require(newLogic != address(0), "Portal: logic is zero");
        address oldLogic = defaultLogicAddress;
        defaultLogicAddress = newLogic;
        emit DefaultLogicUpdated(oldLogic, newLogic);
    }

    function setAgentFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "Portal: factory is zero");
        agentFactory = AgentFactory(newFactory);
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Portal: no fees to withdraw");
        (bool sent, ) = payable(owner()).call{value: balance}("");
        require(sent, "Portal: withdraw failed");
    }

    /**
     * @dev Emergency recovery for stuck NFTs that do NOT have active upgrade records.
     *      Cannot be used to steal locked NFTs from active upgrades.
     */
    function emergencyRecoverNFT(
        address collection,
        uint256 tokenId,
        address to
    ) external onlyOwner {
        bytes32 key = _originalKey(collection, tokenId);
        uint256 existingUpgradeId = _originalToUpgradeId[key];
        if (existingUpgradeId != 0) {
            require(
                _upgradeRecords[existingUpgradeId].status != UpgradeStatus.Active,
                "Portal: cannot recover active upgrade"
            );
        }
        IERC721(collection).transferFrom(address(this), to, tokenId);
    }

    // ============ ERC721 RECEIVER ============

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721ReceiverUpgradeable.onERC721Received.selector;
    }

    // ============ RECEIVE BNB ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
