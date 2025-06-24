import { ethers } from 'hardhat';

export const oneX96 = 2n ** 96n;
export const one = 10n ** 18n;

export function printPrices(balancePrice: bigint, mcPrice: bigint, decimalsDiff: bigint) {
  console.log(`Balance price is ${toHumanPrice(balancePrice, decimalsDiff)}  (${balancePrice})`);
  console.log(`MC price is ${toHumanPrice(mcPrice, decimalsDiff)} (${mcPrice})`);
}

export async function getDecimals(contractAddress: string): Promise<bigint> {
  const abi = ['function decimals() view returns (uint8)'];
  const contract = new ethers.Contract(contractAddress, abi, ethers.provider);
  return await contract.decimals();
}

export async function getDecimalsDiff(quoteToken: string, baseToken: string): Promise<bigint> {
  const baseDecimals = await getDecimals(baseToken);
  const quoteDecimals = await getDecimals(quoteToken);
  return baseDecimals - quoteDecimals;
}

function toHumanPrice(priceX96: bigint, decimalsDiff: bigint): string {
  const multiplier = 10n ** decimalsDiff;
  priceX96 = decimalsDiff > 0 ? priceX96 * multiplier : priceX96 / multiplier;

  const priceIntermediate = Number(priceX96 / 2n ** 48n);
  return (priceIntermediate / 2 ** 48).toString();
}
