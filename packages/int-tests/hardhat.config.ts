import '@nomicfoundation/hardhat-toolbox';

export default {
  networks: {
    hardhat: {
      forking: {
        enabled: true,
        url: 'https://ethereum-rpc.publicnode.com',
        blockNumber: 21814800,
      },
    },
  },
};
