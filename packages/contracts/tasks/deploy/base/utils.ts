import { ethers } from 'ethers';

export function validateAddress(address: string) {
  if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
    throw new Error(`Wrong ${address} evm address`);
  }
}

export function isSameAddress(addressA: string, addressB: string): boolean {
  return ethers.getAddress(addressA) === ethers.getAddress(addressB);
}
