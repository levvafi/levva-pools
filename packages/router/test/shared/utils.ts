import { ContractTransaction } from 'ethers';
import { ERC20, MarginlyRouter } from '../../typechain-types';
import { formatUnits } from 'ethers';
import { reset } from '@nomicfoundation/hardhat-network-helpers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { expect } from 'chai';
const hre = require('hardhat');

export const SWAP_ONE = 1 << 15;

export const Dex = {
  UniswapV3: 0n,
  ApeSwap: 1n,
  Balancer: 2n,
  Camelot: 3n,
  KyberClassicSwap: 4n,
  KyberElasticSwap: 5n,
  QuickSwap: 6n,
  SushiSwap: 7n,
  TraderJoe: 8n,
  Woofi: 9n,
  Ramses: 10n,
  DodoV1: 11n,
  DodoV2: 12n,
  Curve: 13n,
  Pendle: 17n,
  PendleMarket: 19n,
  PendleCurveRouter: 30n,
  PendleCurve: 31n,
  Spectra: 32n,
  PendlePtToAsset: 33n,
};

export function constructSwap(dex: bigint[], ratios: bigint[]): bigint {
  if (dex.length != ratios.length) {
    throw new Error(`dex and ratios arrays length are different`);
  }

  let swap = 0n;
  for (let i = 0; i < dex.length; ++i) {
    swap = (((swap << 6n) + dex[i]) << 16n) + ratios[i];
  }
  swap = (swap << 4n) + BigInt(dex.length);
  return swap;
}

export async function showGasUsage(tx: ContractTransaction) {
  const warningLimit = 1_000_000;
  console.log(`⛽ gas used ${txReceipt.gasUsed} ${txReceipt.gasUsed.gt(warningLimit) ? '!!! WARNING' : ''}`);
}

export async function showBalance(token: ERC20, account: string, startPhrase = ''): Promise<bigint> {
  const [balance, symbol, decimals] = await Promise.all([token.balanceOf(account), token.symbol(), token.decimals()]);

  console.log(`${startPhrase.replace('$symbol', symbol)} ${formatUnits(balance, decimals)} ${symbol}`);
  return balance;
}

export async function showBalanceDelta(balanceBefore: bigint, balanceAfter: bigint, token: ERC20, startPhrase = '') {
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);

  console.log(
    `${startPhrase.replace('$symbol', symbol)} ${formatUnits(balanceAfter - balanceBefore, decimals)} ${symbol}`
  );
}

export async function resetFork(blockNumber?: number) {
  const hardhatConfig = (<HardhatRuntimeEnvironment>hre).config;
  const forkingBlockNumber = hardhatConfig.networks.hardhat.forking?.blockNumber;
  const forkingUrl = hardhatConfig.networks.hardhat.forking?.url;

  await reset(forkingUrl, blockNumber ?? forkingBlockNumber);
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertSwapEvent(
  expectedValues: {
    isExactInput: boolean;
    amountIn: bigint;
    amountOut: bigint;
    tokenIn: string;
    tokenOut: string;
  },
  router: MarginlyRouter,
  tx: any
) {
  const swapEvent = await getSwapEvent(router, tx);
  expect(swapEvent.args.isExactInput).to.be.eq(expectedValues.isExactInput);
  expect(swapEvent.args.amountIn).to.be.eq(expectedValues.amountIn);
  expect(swapEvent.args.amountOut).to.be.eq(expectedValues.amountOut);
  expect(swapEvent.args.tokenIn.toLocaleLowerCase()).to.be.eq(expectedValues.tokenIn.toLocaleLowerCase());
  expect(swapEvent.args.tokenOut.toLocaleLowerCase()).to.be.eq(expectedValues.tokenOut.toLocaleLowerCase());
}

async function getSwapEvent(router: MarginlyRouter, tx: any): Promise<any> {
  const eventFilter = router.filters['Swap(bool,uint256,address,address,address,uint256,uint256)'];
  const events = await router.queryFilter(eventFilter, tx.blockHash);
  expect(events.length).to.be.eq(1);
  const swapEvent = events[0];

  expect(swapEvent).to.not.be.undefined;
  return swapEvent;
}
