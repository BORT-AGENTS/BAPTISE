const { ethers, upgrades } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Deploying Baptise (NFT Upgrade Portal)...\n');

  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.utils.formatEther(await deployer.getBalance()));

  const network = await ethers.provider.getNetwork();
  console.log('Network:', network.name, '| Chain ID:', network.chainId);

  // Set these as env vars before deploying to a live network.
  // On the local Hardhat network the test suite deploys everything fresh.
  const CIRCUIT_BREAKER = process.env.CIRCUIT_BREAKER || '';
  const AGENT_FACTORY   = process.env.AGENT_FACTORY   || '';
  const DEFAULT_LOGIC   = process.env.DEFAULT_LOGIC    || '';

  if (!CIRCUIT_BREAKER || !AGENT_FACTORY || !DEFAULT_LOGIC) {
    console.error('\nSet CIRCUIT_BREAKER, AGENT_FACTORY, and DEFAULT_LOGIC env vars.');
    process.exit(1);
  }

  const upgradeFee = ethers.utils.parseEther('0.005');

  const NFTUpgradePortal = await ethers.getContractFactory('NFTUpgradePortal');
  const portal = await upgrades.deployProxy(
    NFTUpgradePortal,
    [CIRCUIT_BREAKER, AGENT_FACTORY, DEFAULT_LOGIC, upgradeFee, deployer.address],
    { initializer: 'initialize', kind: 'uups' }
  );
  await portal.deployed();
  console.log('\nNFTUpgradePortal:', portal.address);

  // Save deployment
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const data = {
    network: network.name,
    chainId: network.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    NFTUpgradePortal: portal.address,
    config: { CIRCUIT_BREAKER, AGENT_FACTORY, DEFAULT_LOGIC, upgradeFee: '0.005' },
  };

  const filename = 'baptise-' + network.chainId + '-' + Date.now() + '.json';
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(data, null, 2));
  console.log('Saved:', filename);
}

main().catch(function(err) { console.error(err); process.exitCode = 1; });
