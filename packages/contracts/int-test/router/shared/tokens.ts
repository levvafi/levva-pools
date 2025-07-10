// Addresses of tokens `balanceOf` storage slot.
// Used to set ERC20 account balance on fork
// internal details: https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
import { AbiCoder, Addressable, keccak256, toBeHex } from 'ethers';
import { ethers } from 'hardhat';

export enum ArbMainnetERC20BalanceOfSlot {
  USDC = '0000000000000000000000000000000000000000000000000000000000000009',
  WETH = '0000000000000000000000000000000000000000000000000000000000000033',
  FRXETH = '0000000000000000000000000000000000000000000000000000000000000000',
  PTWEETH = '0000000000000000000000000000000000000000000000000000000000000000',
  WEETH = '0000000000000000000000000000000000000000000000000000000000000033',
}

// How to get: 1) decompile contract https://ethervm.io/decompile
// 2) find balanceOf function and slot
// or find slot in blockexplorer statechange  e.g. https://etherscan.io/tx/0xd3a83090d4e736aef85302e9835850d925c7d8da5180678fe440edc519966906#statechange
export enum EthereumMainnetERC20BalanceOfSlot {
  WETH = '0000000000000000000000000000000000000000000000000000000000000003',
  DAI = '0000000000000000000000000000000000000000000000000000000000000002',
  WBTC = '0000000000000000000000000000000000000000000000000000000000000000',
  USDC = '0000000000000000000000000000000000000000000000000000000000000009',
  SUSDE = '0000000000000000000000000000000000000000000000000000000000000004',
  PTSUSDE = '0000000000000000000000000000000000000000000000000000000000000000',
  PTSWINWSTETHS = '52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00',
  INWSTETHS = '0000000000000000000000000000000000000000000000000000000000000065',
  WSTUSR = '52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00',
  SDOLA = '0000000000000000000000000000000000000000000000000000000000000003',
  USR = '52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00',
  DOLA = '0000000000000000000000000000000000000000000000000000000000000006',
}

function getAccountBalanceStorageSlot(account: string, tokenMappingSlot: string): string {
  return keccak256('0x' + account.slice(2).padStart(64, '0') + tokenMappingSlot);
}

export async function setTokenBalance(
  tokenAddress: string | Addressable,
  balanceOfSlotAddress: string,
  account: string,
  newBalance: bigint
) {
  const balanceOfStorageSlot = getAccountBalanceStorageSlot(account, balanceOfSlotAddress);

  await ethers.provider.send('hardhat_setStorageAt', [
    tokenAddress.toString(),
    balanceOfStorageSlot,
    toBeHex(newBalance, 32),
  ]);
}
