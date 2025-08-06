import { ethers } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

export function validateAddress(address: string) {
  if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
    throw new Error(`Wrong ${address} evm address`);
  }
}

export function isSameAddress(addressA: string, addressB: string): boolean {
  return ethers.getAddress(addressA) === ethers.getAddress(addressB);
}

export function isDryRun(hre: HardhatRuntimeEnvironment): boolean {
  return hre.network.name === 'hardhat';
}
