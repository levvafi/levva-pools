import { formatUnits, Provider } from 'ethers';

export function formatBalance(amount: bigint, decimals: bigint, assetSymbol: string): string {
  return `${amount} (${formatUnits(amount, decimals)} ${assetSymbol.toUpperCase()})`;
}

export const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const waitForTx = async (provider: Provider, hash: string) => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) {
      await sleep(3000);
    } else {
      if (!receipt.status) {
        throw new Error('Transaction failed');
      }
      break;
    }
  }
};
