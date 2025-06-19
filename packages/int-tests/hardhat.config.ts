import '@nomicfoundation/hardhat-toolbox';

export default {
  networks: {
    hardhat: {
      forking: {
        enabled: true,
        url: 'https://ethereum-rpc.publicnode.com',
        blockNumber: 22730520,
      },
      accounts: {
        count: 40,
      },
    },
  },
  mocha: {
    timeout: 6000000,
  }
};
