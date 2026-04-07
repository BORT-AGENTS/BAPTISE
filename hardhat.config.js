require('@nomiclabs/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('@nomicfoundation/hardhat-verify');
require('@openzeppelin/hardhat-upgrades');
require('dotenv').config();

const TESTNET_RPC_URL =
  process.env.TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const MAINNET_RPC_URL =
  process.env.MAINNET_RPC_URL || 'https://bsc-dataseed1.binance.org/';
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ||
  '0000000000000000000000000000000000000000000000000000000000000000';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || '';

module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.9',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      {
        version: '0.8.19',
        settings: { viaIR: true, optimizer: { enabled: true, runs: 1 } },
      },
    ],
  },
  networks: {
    hardhat: { chainId: 31337 },
    testnet: {
      url: TESTNET_RPC_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 97,
      gasPrice: 10000000000,
    },
    mainnet: {
      url: MAINNET_RPC_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 56,
      gasPrice: 100000000,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: { timeout: 40000 },
  etherscan: {
    apiKey: BSCSCAN_API_KEY,
    customChains: [
      {
        network: 'mainnet',
        chainId: 56,
        urls: {
          apiURL: 'https://api.bscscan.com/api',
          browserURL: 'https://bscscan.com',
        },
      },
    ],
  },
};
