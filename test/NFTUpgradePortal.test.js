const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('NFTUpgradePortal', function () {
  let portal;
  let agentFactory;
  let bap578Implementation;
  let circuitBreaker;
  let treasury;
  let merkleTreeLearning;
  let basicLogic;
  let mockNFT;
  let mockNFTNoURI;

  let owner;
  let governance;
  let emergencyMultiSig;
  let user1;
  let user2;
  let user3;

  const FACTORY_FEE = ethers.utils.parseEther('0.01');
  const UPGRADE_FEE = ethers.utils.parseEther('0.005');
  const TOTAL_FEE = FACTORY_FEE.add(UPGRADE_FEE);

  beforeEach(async function () {
    [owner, governance, emergencyMultiSig, user1, user2, user3] =
      await ethers.getSigners();

    // Deploy CircuitBreaker
    const CircuitBreaker = await ethers.getContractFactory('CircuitBreaker');
    circuitBreaker = await upgrades.deployProxy(
      CircuitBreaker,
      [governance.address, emergencyMultiSig.address],
      { initializer: 'initialize' }
    );
    await circuitBreaker.deployed();

    // Deploy BAP578 implementation (raw, not proxied)
    const BAP578 = await ethers.getContractFactory('BAP578');
    bap578Implementation = await BAP578.deploy();
    await bap578Implementation.deployed();

    // Deploy MerkleTreeLearning
    const MerkleTreeLearning = await ethers.getContractFactory('MerkleTreeLearning');
    merkleTreeLearning = await MerkleTreeLearning.deploy();
    await merkleTreeLearning.deployed();

    // Deploy Treasury
    const BAP578Treasury = await ethers.getContractFactory('BAP578Treasury');
    treasury = await upgrades.deployProxy(
      BAP578Treasury,
      [
        circuitBreaker.address,
        owner.address, // foundation
        owner.address, // community
        owner.address, // staking rewards
        owner.address,
      ],
      { initializer: 'initialize' }
    );
    await treasury.deployed();

    // Deploy AgentFactory
    const AgentFactory = await ethers.getContractFactory('AgentFactory');
    agentFactory = await upgrades.deployProxy(
      AgentFactory,
      [
        bap578Implementation.address,
        owner.address,
        merkleTreeLearning.address,
        treasury.address,
        circuitBreaker.address,
      ],
      { initializer: 'initialize', kind: 'uups' }
    );
    await agentFactory.deployed();

    // Deploy BasicAgentLogic
    const BasicAgentLogic = await ethers.getContractFactory('BasicAgentLogic');
    basicLogic = await BasicAgentLogic.deploy('BasicLogic', 'v1');
    await basicLogic.deployed();

    // Deploy MockERC721
    const MockERC721 = await ethers.getContractFactory('MockERC721');
    mockNFT = await MockERC721.deploy('TestNFT', 'TNFT');
    await mockNFT.deployed();

    // Deploy MockERC721NoURI
    const MockERC721NoURI = await ethers.getContractFactory('MockERC721NoURI');
    mockNFTNoURI = await MockERC721NoURI.deploy();
    await mockNFTNoURI.deployed();

    // Deploy NFTUpgradePortal
    const NFTUpgradePortal = await ethers.getContractFactory('NFTUpgradePortal');
    portal = await upgrades.deployProxy(
      NFTUpgradePortal,
      [
        circuitBreaker.address,
        agentFactory.address,
        basicLogic.address,
        UPGRADE_FEE,
        owner.address,
      ],
      { initializer: 'initialize', kind: 'uups' }
    );
    await portal.deployed();
  });

  // Helper: mint an NFT to a user and approve portal
  async function mintAndApprove(user, uri = 'ipfs://QmOriginal') {
    const tx = await mockNFT.mint(user.address, uri);
    const receipt = await tx.wait();
    // Token ID is incremental starting from 1
    const tokenId = receipt.events.find((e) => e.event === 'Transfer').args
      .tokenId;
    await mockNFT.connect(user).approve(portal.address, tokenId);
    return tokenId;
  }

  // Helper: create default upgrade params
  function upgradeParams(collection, tokenId, logicAddress) {
    return {
      collection: collection || mockNFT.address,
      tokenId: tokenId || 1,
      agentName: 'Upgraded Agent',
      agentSymbol: 'UA',
      logicAddress: logicAddress || ethers.constants.AddressZero,
      metadataURI: 'ipfs://QmAgentMetadata',
    };
  }

  // Helper: perform a full upgrade and return upgrade details
  async function performUpgrade(user, uri = 'ipfs://QmOriginal') {
    const tokenId = await mintAndApprove(user, uri);
    const params = upgradeParams(mockNFT.address, tokenId);
    const tx = await portal
      .connect(user)
      .upgrade(params, { value: TOTAL_FEE });
    const receipt = await tx.wait();
    const event = receipt.events.find((e) => e.event === 'NFTUpgraded');
    return {
      upgradeId: event.args.upgradeId,
      agentContract: event.args.agentContract,
      agentTokenId: event.args.agentTokenId,
      originalTokenId: tokenId,
      receipt,
    };
  }

  // ============ INITIALIZATION ============

  describe('Initialization', function () {
    it('Should set correct addresses', async function () {
      expect(await portal.circuitBreaker()).to.equal(circuitBreaker.address);
      expect(await portal.agentFactory()).to.equal(agentFactory.address);
      expect(await portal.defaultLogicAddress()).to.equal(basicLogic.address);
      expect(await portal.upgradeFee()).to.equal(UPGRADE_FEE);
      expect(await portal.owner()).to.equal(owner.address);
    });

    it('Should start with zero upgrades', async function () {
      expect(await portal.getTotalUpgrades()).to.equal(0);
      expect(await portal.totalActiveUpgrades()).to.equal(0);
    });

    it('Should have whitelist mode off by default', async function () {
      expect(await portal.whitelistMode()).to.equal(false);
    });

    it('Should revert on zero circuit breaker', async function () {
      const NFTUpgradePortal = await ethers.getContractFactory('NFTUpgradePortal');
      await expect(
        upgrades.deployProxy(
          NFTUpgradePortal,
          [
            ethers.constants.AddressZero,
            agentFactory.address,
            basicLogic.address,
            UPGRADE_FEE,
            owner.address,
          ],
          { initializer: 'initialize', kind: 'uups' }
        )
      ).to.be.revertedWith('Portal: circuit breaker is zero');
    });

    it('Should revert on zero agent factory', async function () {
      const NFTUpgradePortal = await ethers.getContractFactory('NFTUpgradePortal');
      await expect(
        upgrades.deployProxy(
          NFTUpgradePortal,
          [
            circuitBreaker.address,
            ethers.constants.AddressZero,
            basicLogic.address,
            UPGRADE_FEE,
            owner.address,
          ],
          { initializer: 'initialize', kind: 'uups' }
        )
      ).to.be.revertedWith('Portal: agent factory is zero');
    });

    it('Should revert on zero default logic', async function () {
      const NFTUpgradePortal = await ethers.getContractFactory('NFTUpgradePortal');
      await expect(
        upgrades.deployProxy(
          NFTUpgradePortal,
          [
            circuitBreaker.address,
            agentFactory.address,
            ethers.constants.AddressZero,
            UPGRADE_FEE,
            owner.address,
          ],
          { initializer: 'initialize', kind: 'uups' }
        )
      ).to.be.revertedWith('Portal: default logic is zero');
    });
  });

  // ============ UPGRADE (HAPPY PATH) ============

  describe('Upgrade', function () {
    it('Should upgrade an NFT into a BAP-578 agent', async function () {
      const { upgradeId, agentContract, agentTokenId, originalTokenId } =
        await performUpgrade(user1);

      // Verify upgrade record
      const record = await portal.getUpgradeRecord(upgradeId);
      expect(record.originalCollection).to.equal(mockNFT.address);
      expect(record.originalTokenId).to.equal(originalTokenId);
      expect(record.agentContract).to.equal(agentContract);
      expect(record.agentTokenId).to.equal(1);
      expect(record.upgrader).to.equal(user1.address);
      expect(record.status).to.equal(1); // Active
      expect(record.unwrapTimestamp).to.equal(0);
    });

    it('Should lock original NFT in portal', async function () {
      const { originalTokenId } = await performUpgrade(user1);
      expect(await mockNFT.ownerOf(originalTokenId)).to.equal(portal.address);
    });

    it('Should mint agent token to user', async function () {
      const { agentContract } = await performUpgrade(user1);
      const agent = await ethers.getContractAt('BAP578', agentContract);
      expect(await agent.ownerOf(1)).to.equal(user1.address);
    });

    it('Should cache original tokenURI', async function () {
      const testURI = 'ipfs://QmSpecificURI';
      const { upgradeId } = await performUpgrade(user1, testURI);
      const record = await portal.getUpgradeRecord(upgradeId);
      expect(record.originalTokenURI).to.equal(testURI);
    });

    it('Should set correct bidirectional lookups', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      expect(
        await portal.getUpgradeByOriginal(mockNFT.address, originalTokenId)
      ).to.equal(upgradeId);
      expect(await portal.getUpgradeByAgent(agentContract)).to.equal(
        upgradeId
      );
    });

    it('Should track user upgrades', async function () {
      const { upgradeId } = await performUpgrade(user1);
      const userUpgrades = await portal.getUserUpgrades(user1.address);
      expect(userUpgrades.length).to.equal(1);
      expect(userUpgrades[0]).to.equal(upgradeId);
    });

    it('Should increment total and active upgrade counts', async function () {
      await performUpgrade(user1);
      expect(await portal.getTotalUpgrades()).to.equal(1);
      expect(await portal.totalActiveUpgrades()).to.equal(1);

      await performUpgrade(user2);
      expect(await portal.getTotalUpgrades()).to.equal(2);
      expect(await portal.totalActiveUpgrades()).to.equal(2);
    });

    it('Should use default logic when logicAddress is zero', async function () {
      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);
      // logicAddress is already zero in default params
      const tx = await portal
        .connect(user1)
        .upgrade(params, { value: TOTAL_FEE });
      const receipt = await tx.wait();
      const event = receipt.events.find((e) => e.event === 'NFTUpgraded');

      const agent = await ethers.getContractAt(
        'BAP578',
        event.args.agentContract
      );
      const state = await agent.getState(1);
      expect(state.logicAddress).to.equal(basicLogic.address);
    });

    it('Should use custom logic when logicAddress is provided', async function () {
      const customLogic = user3.address; // Using signer address as mock logic
      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId, customLogic);
      const tx = await portal
        .connect(user1)
        .upgrade(params, { value: TOTAL_FEE });
      const receipt = await tx.wait();
      const event = receipt.events.find((e) => e.event === 'NFTUpgraded');

      const agent = await ethers.getContractAt(
        'BAP578',
        event.args.agentContract
      );
      const state = await agent.getState(1);
      expect(state.logicAddress).to.equal(customLogic);
    });

    it('Should emit NFTUpgraded event', async function () {
      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);

      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.emit(portal, 'NFTUpgraded');
    });
  });

  // ============ UPGRADE (EDGE CASES) ============

  describe('Upgrade - Edge Cases', function () {
    it('Should handle NFT without tokenURI gracefully', async function () {
      const tx = await mockNFTNoURI.mint(user1.address);
      const receipt = await tx.wait();
      const tokenId = receipt.events.find((e) => e.event === 'Transfer').args
        .tokenId;
      await mockNFTNoURI.connect(user1).approve(portal.address, tokenId);

      const params = upgradeParams(mockNFTNoURI.address, tokenId);
      const upgradeTx = await portal
        .connect(user1)
        .upgrade(params, { value: TOTAL_FEE });
      const upgradeReceipt = await upgradeTx.wait();
      const event = upgradeReceipt.events.find(
        (e) => e.event === 'NFTUpgraded'
      );
      const record = await portal.getUpgradeRecord(event.args.upgradeId);
      expect(record.originalTokenURI).to.equal('');
    });

    it('Should revert on incorrect fee', async function () {
      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);

      await expect(
        portal.connect(user1).upgrade(params, { value: FACTORY_FEE })
      ).to.be.revertedWith('Portal: incorrect fee');

      await expect(
        portal.connect(user1).upgrade(params, { value: 0 })
      ).to.be.revertedWith('Portal: incorrect fee');
    });

    it('Should revert on double-upgrade of same NFT', async function () {
      const { originalTokenId } = await performUpgrade(user1);

      // Try to upgrade the same NFT again (portal owns it now, so this won't work anyway)
      const params = upgradeParams(mockNFT.address, originalTokenId);
      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: NFT already upgraded');
    });

    it('Should revert if user has not approved portal', async function () {
      await mockNFT.mint(user1.address, 'ipfs://QmTest');
      const params = upgradeParams(mockNFT.address, 1);

      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.reverted; // ERC721: caller is not token owner or approved
    });

    it('Should revert on zero collection address', async function () {
      const params = upgradeParams(ethers.constants.AddressZero, 1);

      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: collection is zero');
    });
  });

  // ============ UNWRAP ============

  describe('Unwrap', function () {
    it('Should return original NFT to user', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      // Approve portal to transfer agent
      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await portal.connect(user1).unwrap(upgradeId);

      expect(await mockNFT.ownerOf(originalTokenId)).to.equal(user1.address);
    });

    it('Should pause the BAP-578 agent (not terminate)', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await portal.connect(user1).unwrap(upgradeId);

      const state = await agent.getState(1);
      expect(state.status).to.equal(0); // Paused
    });

    it('Should update upgrade record', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await portal.connect(user1).unwrap(upgradeId);

      const record = await portal.getUpgradeRecord(upgradeId);
      expect(record.status).to.equal(2); // Unwrapped
      expect(record.unwrapTimestamp).to.be.gt(0);
    });

    it('Should decrement active upgrade count', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);
      expect(await portal.totalActiveUpgrades()).to.equal(1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await portal.connect(user1).unwrap(upgradeId);
      expect(await portal.totalActiveUpgrades()).to.equal(0);
      // Total upgrades should remain the same
      expect(await portal.getTotalUpgrades()).to.equal(1);
    });

    it('Should clear bidirectional lookups', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await portal.connect(user1).unwrap(upgradeId);

      expect(
        await portal.getUpgradeByOriginal(mockNFT.address, originalTokenId)
      ).to.equal(0);
      expect(await portal.getUpgradeByAgent(agentContract)).to.equal(0);
    });

    it('Should reactivate same agent on re-upgrade (not create new)', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      // Unwrap (pauses agent, stores for reactivation)
      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);
      await portal.connect(user1).unwrap(upgradeId);

      // Verify previous agent stored
      const prevAgent = await portal.getPreviousAgent(mockNFT.address, originalTokenId);
      expect(prevAgent).to.equal(agentContract);

      // Re-upgrade — only pays upgradeFee (no factory fee)
      await mockNFT.connect(user1).approve(portal.address, originalTokenId);
      const params = upgradeParams(mockNFT.address, originalTokenId);
      const tx = await portal
        .connect(user1)
        .upgrade(params, { value: UPGRADE_FEE });
      const receipt = await tx.wait();

      // Should emit NFTReactivated, not NFTUpgraded
      const reactivateEvent = receipt.events.find((e) => e.event === 'NFTReactivated');
      expect(reactivateEvent).to.not.be.undefined;
      expect(reactivateEvent.args.agentContract).to.equal(agentContract);

      // Same agent contract, user owns it again
      expect(await agent.ownerOf(1)).to.equal(user1.address);

      // Previous agent cleared
      const prevAgentAfter = await portal.getPreviousAgent(mockNFT.address, originalTokenId);
      expect(prevAgentAfter).to.equal(ethers.constants.AddressZero);
    });

    it('Should forward BNB from agent on unwrap', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);

      // Fund the agent with some BNB
      const agent = await ethers.getContractAt('BAP578', agentContract);
      const fundAmount = ethers.utils.parseEther('0.1');
      await agent.connect(user1).fundAgent(1, { value: fundAmount });

      // Approve and unwrap
      await agent.connect(user1).approve(portal.address, 1);

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const tx = await portal.connect(user1).unwrap(upgradeId);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const balanceAfter = await ethers.provider.getBalance(user1.address);

      // User should have received the funded amount back (minus gas)
      expect(balanceAfter.add(gasUsed).sub(balanceBefore)).to.equal(
        fundAmount
      );
    });

    it('Should emit NFTUnwrapped event', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await expect(portal.connect(user1).unwrap(upgradeId)).to.emit(
        portal,
        'NFTUnwrapped'
      );
    });
  });

  // ============ UNWRAP (EDGE CASES) ============

  describe('Unwrap - Edge Cases', function () {
    it('Should revert if caller is not agent owner', async function () {
      const { upgradeId } = await performUpgrade(user1);

      await expect(
        portal.connect(user2).unwrap(upgradeId)
      ).to.be.revertedWith('Portal: caller not agent owner');
    });

    it('Should revert if upgrade is already unwrapped', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);
      await portal.connect(user1).unwrap(upgradeId);

      await expect(
        portal.connect(user1).unwrap(upgradeId)
      ).to.be.revertedWith('Portal: not active');
    });

    it('Should revert for non-existent upgrade ID', async function () {
      await expect(portal.connect(user1).unwrap(999)).to.be.revertedWith(
        'Portal: not active'
      );
    });

    it('Should allow new owner to unwrap after agent transfer', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      // Transfer agent to user2
      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent
        .connect(user1)
        .transferFrom(user1.address, user2.address, 1);

      // user2 should be able to unwrap
      await agent.connect(user2).approve(portal.address, 1);
      await portal.connect(user2).unwrap(upgradeId);

      // Original NFT goes to user2 (current agent owner), not user1 (original upgrader)
      expect(await mockNFT.ownerOf(originalTokenId)).to.equal(user2.address);
    });
  });

  // ============ BATCH UPGRADE ============

  describe('Batch Upgrade', function () {
    it('Should upgrade multiple NFTs in one transaction', async function () {
      const tokenId1 = await mintAndApprove(user1, 'ipfs://QmNFT1');
      const tokenId2 = await mintAndApprove(user1, 'ipfs://QmNFT2');
      const tokenId3 = await mintAndApprove(user1, 'ipfs://QmNFT3');

      const paramsList = [
        {
          ...upgradeParams(mockNFT.address, tokenId1),
          agentName: 'Agent 1',
          agentSymbol: 'A1',
        },
        {
          ...upgradeParams(mockNFT.address, tokenId2),
          agentName: 'Agent 2',
          agentSymbol: 'A2',
        },
        {
          ...upgradeParams(mockNFT.address, tokenId3),
          agentName: 'Agent 3',
          agentSymbol: 'A3',
        },
      ];

      const tx = await portal
        .connect(user1)
        .batchUpgrade(paramsList, { value: TOTAL_FEE.mul(3) });
      const receipt = await tx.wait();

      const upgradeEvents = receipt.events.filter(
        (e) => e.event === 'NFTUpgraded'
      );
      expect(upgradeEvents.length).to.equal(3);

      expect(await portal.getTotalUpgrades()).to.equal(3);
      expect(await portal.totalActiveUpgrades()).to.equal(3);
    });

    it('Should emit BatchUpgradeCompleted event', async function () {
      const tokenId1 = await mintAndApprove(user1);
      const tokenId2 = await mintAndApprove(user1);

      const paramsList = [
        upgradeParams(mockNFT.address, tokenId1),
        upgradeParams(mockNFT.address, tokenId2),
      ];

      await expect(
        portal
          .connect(user1)
          .batchUpgrade(paramsList, { value: TOTAL_FEE.mul(2) })
      ).to.emit(portal, 'BatchUpgradeCompleted');
    });

    it('Should revert on empty batch', async function () {
      await expect(
        portal.connect(user1).batchUpgrade([], { value: 0 })
      ).to.be.revertedWith('Portal: empty batch');
    });

    it('Should revert if batch exceeds MAX_BATCH_SIZE', async function () {
      // Create 11 params (MAX_BATCH_SIZE is 10)
      const paramsList = [];
      for (let i = 0; i < 11; i++) {
        const tokenId = await mintAndApprove(user1, `ipfs://QmNFT${i}`);
        paramsList.push(upgradeParams(mockNFT.address, tokenId));
      }

      await expect(
        portal
          .connect(user1)
          .batchUpgrade(paramsList, { value: TOTAL_FEE.mul(11) })
      ).to.be.revertedWith('Portal: batch too large');
    });

    it('Should revert on incorrect total fee', async function () {
      const tokenId1 = await mintAndApprove(user1);
      const tokenId2 = await mintAndApprove(user1);

      const paramsList = [
        upgradeParams(mockNFT.address, tokenId1),
        upgradeParams(mockNFT.address, tokenId2),
      ];

      await expect(
        portal.connect(user1).batchUpgrade(paramsList, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: incorrect total fee');
    });
  });

  // ============ WHITELIST ============

  describe('Whitelist', function () {
    it('Should allow any collection when whitelist mode is off', async function () {
      // Default mode is off — upgrade should work
      await performUpgrade(user1);
      expect(await portal.getTotalUpgrades()).to.equal(1);
    });

    it('Should block non-whitelisted collection when whitelist mode is on', async function () {
      await portal.setWhitelistMode(true);

      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);

      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: collection not whitelisted');
    });

    it('Should allow whitelisted collection', async function () {
      await portal.setWhitelistMode(true);
      await portal.setCollectionWhitelist(mockNFT.address, true);

      await performUpgrade(user1);
      expect(await portal.getTotalUpgrades()).to.equal(1);
    });

    it('Should allow batch whitelisting', async function () {
      await portal.batchSetCollectionWhitelist(
        [mockNFT.address, mockNFTNoURI.address],
        true
      );

      expect(
        await portal.isCollectionWhitelisted(mockNFT.address)
      ).to.equal(true);
      expect(
        await portal.isCollectionWhitelisted(mockNFTNoURI.address)
      ).to.equal(true);
    });

    it('Should only allow owner to modify whitelist', async function () {
      await expect(
        portal.connect(user1).setCollectionWhitelist(mockNFT.address, true)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should emit WhitelistModeUpdated', async function () {
      await expect(portal.setWhitelistMode(true))
        .to.emit(portal, 'WhitelistModeUpdated')
        .withArgs(true);
    });

    it('Should emit CollectionWhitelistUpdated', async function () {
      await expect(portal.setCollectionWhitelist(mockNFT.address, true))
        .to.emit(portal, 'CollectionWhitelistUpdated')
        .withArgs(mockNFT.address, true);
    });
  });

  // ============ ADMIN ============

  describe('Admin', function () {
    it('Should allow owner to update upgrade fee', async function () {
      const newFee = ethers.utils.parseEther('0.01');
      await expect(portal.setUpgradeFee(newFee))
        .to.emit(portal, 'UpgradeFeeUpdated')
        .withArgs(UPGRADE_FEE, newFee);
      expect(await portal.getUpgradeFee()).to.equal(newFee);
    });

    it('Should allow setting fee to zero', async function () {
      await portal.setUpgradeFee(0);
      expect(await portal.getUpgradeFee()).to.equal(0);

      // Upgrade should work with only factory fee
      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);
      await portal
        .connect(user1)
        .upgrade(params, { value: FACTORY_FEE });
      expect(await portal.getTotalUpgrades()).to.equal(1);
    });

    it('Should allow owner to update default logic', async function () {
      const newLogic = user3.address;
      await expect(portal.setDefaultLogicAddress(newLogic))
        .to.emit(portal, 'DefaultLogicUpdated')
        .withArgs(basicLogic.address, newLogic);
      expect(await portal.defaultLogicAddress()).to.equal(newLogic);
    });

    it('Should allow owner to update agent factory', async function () {
      await portal.setAgentFactory(user3.address);
      expect(await portal.agentFactory()).to.equal(user3.address);
    });

    it('Should allow owner to withdraw fees', async function () {
      // Perform an upgrade to accumulate fees
      await performUpgrade(user1);

      expect(await portal.accumulatedFees()).to.equal(UPGRADE_FEE);

      const ownerBalanceBefore = await ethers.provider.getBalance(
        owner.address
      );
      const tx = await portal.withdrawFees();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const ownerBalanceAfter = await ethers.provider.getBalance(
        owner.address
      );

      expect(ownerBalanceAfter.sub(ownerBalanceBefore).add(gasUsed)).to.equal(
        UPGRADE_FEE
      );
      expect(await portal.accumulatedFees()).to.equal(0);
    });

    it('Should only withdraw tracked fees, not entire balance', async function () {
      // Perform an upgrade (portal gets UPGRADE_FEE)
      await performUpgrade(user1);

      // Send extra BNB directly to portal
      await owner.sendTransaction({
        to: portal.address,
        value: ethers.utils.parseEther('1.0'),
      });

      // Portal has UPGRADE_FEE + 1.0 BNB, but should only withdraw UPGRADE_FEE
      const portalBalanceBefore = await ethers.provider.getBalance(portal.address);
      expect(portalBalanceBefore).to.equal(
        UPGRADE_FEE.add(ethers.utils.parseEther('1.0'))
      );

      await portal.withdrawFees();

      const portalBalanceAfter = await ethers.provider.getBalance(portal.address);
      // The extra 1.0 BNB should remain untouched
      expect(portalBalanceAfter).to.equal(ethers.utils.parseEther('1.0'));
    });

    it('Should revert withdraw when no fees', async function () {
      await expect(portal.withdrawFees()).to.be.revertedWith(
        'Portal: no fees to withdraw'
      );
    });

    it('Should not allow non-owner to call admin functions', async function () {
      await expect(
        portal.connect(user1).setUpgradeFee(0)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        portal.connect(user1).setWhitelistMode(true)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        portal.connect(user1).setDefaultLogicAddress(user3.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        portal.connect(user1).setAgentFactory(user3.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        portal.connect(user1).withdrawFees()
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  // ============ EMERGENCY RECOVERY ============

  describe('Emergency Recovery', function () {
    it('Should not allow recovering NFT with active upgrade', async function () {
      const { originalTokenId } = await performUpgrade(user1);

      await expect(
        portal.emergencyRecoverNFT(
          mockNFT.address,
          originalTokenId,
          owner.address
        )
      ).to.be.revertedWith('Portal: cannot recover active upgrade');
    });

    it('Should allow recovering NFT after unwrap', async function () {
      // This scenario: someone accidentally sends an NFT directly to the portal
      // After an upgrade is unwrapped, the mapping is cleared,
      // so recovery of an unrelated stuck NFT should work

      // Send an NFT directly to portal (simulating a stuck token)
      await mockNFT.mint(owner.address, 'ipfs://QmStuck');
      const stuckTokenId = 1; // first minted
      await mockNFT.transferFrom(owner.address, portal.address, stuckTokenId);

      // Recover it
      await portal.emergencyRecoverNFT(
        mockNFT.address,
        stuckTokenId,
        owner.address
      );
      expect(await mockNFT.ownerOf(stuckTokenId)).to.equal(owner.address);
    });

    it('Should only allow owner to recover', async function () {
      await expect(
        portal
          .connect(user1)
          .emergencyRecoverNFT(mockNFT.address, 1, user1.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  // ============ CIRCUIT BREAKER ============

  describe('Circuit Breaker', function () {
    it('Should block upgrade when globally paused', async function () {
      await circuitBreaker.connect(governance).setGlobalPause(true);

      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);

      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: system paused');
    });

    it('Should block upgrade when portal is contract-paused', async function () {
      await circuitBreaker
        .connect(governance)
        .setContractPause(portal.address, true);

      const tokenId = await mintAndApprove(user1);
      const params = upgradeParams(mockNFT.address, tokenId);

      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: portal paused');
    });

    it('Should block unwrap when globally paused', async function () {
      const { upgradeId, agentContract } = await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);

      await circuitBreaker.connect(governance).setGlobalPause(true);

      await expect(
        portal.connect(user1).unwrap(upgradeId)
      ).to.be.revertedWith('Portal: system paused');
    });
  });

  // ============ VIEW FUNCTIONS ============

  describe('View Functions', function () {
    it('Should return empty array for user with no upgrades', async function () {
      const upgrades = await portal.getUserUpgrades(user1.address);
      expect(upgrades.length).to.equal(0);
    });

    it('Should return zero for non-existent original lookup', async function () {
      expect(
        await portal.getUpgradeByOriginal(mockNFT.address, 999)
      ).to.equal(0);
    });

    it('Should return zero for non-existent agent lookup', async function () {
      expect(
        await portal.getUpgradeByAgent(ethers.constants.AddressZero)
      ).to.equal(0);
    });

    it('Should return default record for non-existent upgrade ID', async function () {
      const record = await portal.getUpgradeRecord(999);
      expect(record.originalCollection).to.equal(ethers.constants.AddressZero);
      expect(record.status).to.equal(0); // None
    });
  });

  // ============ PAGINATION ============

  describe('Pagination', function () {
    it('Should return correct page of user upgrades', async function () {
      // Create 5 upgrades
      for (let i = 0; i < 5; i++) {
        await performUpgrade(user1, `ipfs://QmNFT${i}`);
      }

      expect(await portal.getUserUpgradeCount(user1.address)).to.equal(5);

      // Page 1: offset 0, limit 2
      const page1 = await portal.getUserUpgradesPaginated(user1.address, 0, 2);
      expect(page1.length).to.equal(2);
      expect(page1[0]).to.equal(1);
      expect(page1[1]).to.equal(2);

      // Page 2: offset 2, limit 2
      const page2 = await portal.getUserUpgradesPaginated(user1.address, 2, 2);
      expect(page2.length).to.equal(2);
      expect(page2[0]).to.equal(3);
      expect(page2[1]).to.equal(4);

      // Page 3: offset 4, limit 2 (only 1 left)
      const page3 = await portal.getUserUpgradesPaginated(user1.address, 4, 2);
      expect(page3.length).to.equal(1);
      expect(page3[0]).to.equal(5);
    });

    it('Should return empty array when offset exceeds length', async function () {
      await performUpgrade(user1);
      const page = await portal.getUserUpgradesPaginated(user1.address, 100, 10);
      expect(page.length).to.equal(0);
    });

    it('Should return correct count for user with no upgrades', async function () {
      expect(await portal.getUserUpgradeCount(user1.address)).to.equal(0);
    });
  });

  // ============ REACTIVATION ============

  describe('Reactivation', function () {
    it('Should preserve agent state across unwrap and re-upgrade', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);

      // Agent is active
      let state = await agent.getState(1);
      expect(state.status).to.equal(1); // Active

      // Unwrap — agent gets paused
      await agent.connect(user1).approve(portal.address, 1);
      await portal.connect(user1).unwrap(upgradeId);

      // Agent is now paused, owned by portal
      state = await agent.getState(1);
      expect(state.status).to.equal(0); // Paused
      expect(await agent.ownerOf(1)).to.equal(portal.address);

      // Re-upgrade — reactivates same agent
      await mockNFT.connect(user1).approve(portal.address, originalTokenId);
      const params = upgradeParams(mockNFT.address, originalTokenId);
      await portal.connect(user1).upgrade(params, { value: UPGRADE_FEE });

      // Agent is active again, user owns it
      state = await agent.getState(1);
      expect(state.status).to.equal(1); // Active
      expect(await agent.ownerOf(1)).to.equal(user1.address);
    });

    it('Should create new agent if previous was externally terminated', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);

      // User terminates agent directly (outside portal)
      await agent.connect(user1).terminate(1);

      // Approve and unwrap — pause will fail (already terminated) but unwrap continues
      await agent.connect(user1).approve(portal.address, 1);
      await portal.connect(user1).unwrap(upgradeId);

      // Previous agent is stored but terminated
      const prevAgent = await portal.getPreviousAgent(mockNFT.address, originalTokenId);
      expect(prevAgent).to.equal(agentContract);

      // Re-upgrade — fee check detects terminated agent, requires full fee
      await mockNFT.connect(user1).approve(portal.address, originalTokenId);
      const params = upgradeParams(mockNFT.address, originalTokenId);
      const tx = await portal.connect(user1).upgrade(params, { value: TOTAL_FEE });
      const receipt = await tx.wait();

      // Should create a NEW agent (not reactivate terminated one)
      const event = receipt.events.find((e) => e.event === 'NFTUpgraded');
      expect(event).to.not.be.undefined;
      expect(event.args.agentContract).to.not.equal(agentContract);

      // Previous agent entry should be cleared
      const prevAgentAfter = await portal.getPreviousAgent(mockNFT.address, originalTokenId);
      expect(prevAgentAfter).to.equal(ethers.constants.AddressZero);
    });

    it('Should charge only upgradeFee for reactivation, not factory fee', async function () {
      const { upgradeId, agentContract, originalTokenId } =
        await performUpgrade(user1);

      const agent = await ethers.getContractAt('BAP578', agentContract);
      await agent.connect(user1).approve(portal.address, 1);
      await portal.connect(user1).unwrap(upgradeId);

      await mockNFT.connect(user1).approve(portal.address, originalTokenId);
      const params = upgradeParams(mockNFT.address, originalTokenId);

      // Full fee should fail
      await expect(
        portal.connect(user1).upgrade(params, { value: TOTAL_FEE })
      ).to.be.revertedWith('Portal: incorrect fee (reactivation)');

      // Only upgrade fee should work
      await portal.connect(user1).upgrade(params, { value: UPGRADE_FEE });
      expect(await portal.getTotalUpgrades()).to.equal(2);
    });
  });
});
