import { config as dotEnvConfig } from 'dotenv';
import '@nomicfoundation/hardhat-toolbox';
import 'hardhat-contract-sizer';
import 'solidity-docgen';
import './scripts';

dotEnvConfig();

const config = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
  networks: {
    hardhat: {
      accounts: {
        count: 30,
      },
    },
    polygonMumbai: {
      url: 'https://rpc.ankr.com/polygon_mumbai',
    },
    arbitrumGoerli: {
      url: 'https://goerli-rollup.arbitrum.io/rpc',
    },
    arbitrumOne: {
      url: 'https://arb1.arbitrum.io/rpc',
    },
    arbitrumSepolia: {
      url: 'https://sepolia-rollup.arbitrum.io/rpc',
    },
    x1Testnet: {
      url: 'https://x1-testnet.blockpi.network/v1/rpc/public',
    },
    artioTestnet: {
      url: 'https://artio.rpc.berachain.com',
    },
    blastSepolia: {
      url: 'https://sepolia.blast.io',
    },
    mainnet: {
      url: 'https://ethereum-rpc.publicnode.com',
    },
    sonic: {
      url: 'https://rpc.soniclabs.com',
    },
  },
  etherscan: {
    apiKey: {
      polygonMumbai: process.env.API_KEY,
      arbitrumGoerli: process.env.API_KEY,
      arbitrumOne: process.env.API_KEY,
      arbitrumSepolia: process.env.API_KEY,
      x1Testnet: process.env.API_KEY,
      artioTestnet: 'artio_testnet',
      blastSepolia: 'blast_sepolia',
      mainnet: process.env.ETH_API_KEY,
      sonic: process.env.SONIC_API_KEY,
    },
    customChains: [
      {
        network: 'arbitrumSepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io/',
        },
      },
      {
        network: 'x1Testnet',
        chainId: 195,
        urls: {
          apiURL: 'https://www.oklink.com/api/v5/explorer/contract/verify-source-code',
          browserURL: 'https://www.okx.com/explorer/x1-test/',
        },
      },
      {
        network: 'artioTestnet',
        chainId: 80085,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/80085/etherscan',
          browserURL: 'https://artio.beratrail.io',
        },
      },
      {
        network: 'blastSepolia',
        chainId: 168587773,
        urls: {
          apiURL: 'https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan',
          browserURL: 'https://testnet.blastscan.io',
        },
      },
      {
        network: 'sonic',
        chainId: 146,
        urls: {
          apiURL: 'https://api.sonicscan.org/api',
          browserURL: 'https://sonicscan.org',
        },
      },
    ],
  },
  mocha: {
    timeout: 200_000,
  },
  gasReporter: {
    excludeContracts: [
      'TestERC20',
      'TestUniswapFactory',
      'TestUniswapPool',
      'ERC20',
      'MockAavePool',
      'MockAavePoolAddressesProvider',
      'MockMarginlyPool',
      'MockSwapRouter',
    ],
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
