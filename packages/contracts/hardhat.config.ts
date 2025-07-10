import { config as dotEnvConfig } from 'dotenv';
import fs from 'fs';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-contract-sizer';
import 'solidity-docgen';

if (fs.existsSync('./typechain-types')) {
  require('./tasks/deploy');
}

dotEnvConfig();

const HARDHAT_NETWORK_FORKING_CONFIGS = new Map<string, any>([
  ['INT-TEST-ETH', {
    enabled: true,
    url: process.env.ETH_NODE_URL,
    blockNumber: 22810000,
  }],
  ['INT-TEST-ARB', {
    enabled: true,
    url: process.env.ARB_NODE_URL,
    blockNumber: 350678000,
  }],
  ['UNIT-TEST', undefined]
]);

const config = {
  solidity: {
    version: '0.8.28',
    settings: {
      viaIR: true,
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        enabled: true,
        url: process.env.ARB_NODE_URL,
      },
      accounts: {
        count: 40,
      },
      gasPrice: 1_000_000,
      initialBaseFeePerGas: 1_000_000,
    },
    mainnet: {
      accounts: [process.env.PRIVATE_KEY!],
      url: process.env.ETH_NODE_URL,
    },
    arbitrum: {
      accounts: [process.env.PRIVATE_KEY!],
      url: process.env.ARB_NODE_URL,
    },
  },
  etherscan: {
    apiKey: process.env.ETH_API_KEY,
  },
  sourcify: {
    enabled: true,
  },
  mocha: {
    timeout: 600_000,
  },
  gasReporter: {
    excludeContracts: ['Test', 'Mock'],
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: false,
    only: ['Marginly', 'Levva', 'TimelockWhitelist'],
    except: ['Mock', 'Test'],
  },
  docgen: {
    outputDir: './docs',
    templates: './docgen-templates',
    clear: true,
    pages: 'files',
    exclude: ['test'],
  },
};

export default config;
