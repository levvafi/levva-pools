import { config as dotEnvConfig } from 'dotenv';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-contract-sizer';
import 'solidity-docgen';
import './scripts';

dotEnvConfig();

const HARDHAT_NETWORK_FORKING_CONFIGS = new Map<string, any>([
  ['INT-TEST-ETH', {
    enabled: true,
    url: process.env.ETH_NODE_URL,
    blockNumber: 22730520,
  }],
  ['UNIT-TEST', undefined]
]);

const config = {
  solidity: {
    version: '0.8.28',
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
  networks: {
    hardhat: {
      forking: HARDHAT_NETWORK_FORKING_CONFIGS.get(process.env.MODE ?? 'UNIT-TEST'),
      accounts: {
        count: 40,
      },
    },
    mainnet: {
      url: process.env.ETH_NODE_URL,
    },
    arbitrumOne: {
      url: process.env.ARB_NODE_URL,
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETH_API_KEY,
      arbitrumOne: process.env.ARB_API_KEY,
    },
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
    only: ['Marginly', 'Levva'],
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
