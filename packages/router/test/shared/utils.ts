import { BigNumber, ContractTransaction } from 'ethers';
import { ERC20, MarginlyRouter } from '../../typechain-types';
import { formatUnits } from 'ethers/lib/utils';
import { reset } from '@nomicfoundation/hardhat-network-helpers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { SwapEvent } from '../../typechain-types/contracts/interfaces/IMarginlyRouter';
import { expect } from 'chai';
const hre = require('hardhat');

export const SWAP_ONE = 1 << 15;

export const Dex = {
  UniswapV3: 0,
  ApeSwap: 1,
  Balancer: 2,
  Camelot: 3,
  KyberClassicSwap: 4,
  KyberElasticSwap: 5,
  QuickSwap: 6,
  SushiSwap: 7,
  TraderJoe: 8,
  Woofi: 9,
  Ramses: 10,
  DodoV1: 11,
  DodoV2: 12,
  Curve: 13,
  Pendle: 17,
  PendleMarket: 19,
  PendleCurveRouter: 30,
  PendleCurve: 31,
  Spectra: 32,
  PendlePtToAsset: 33,
};

export function constructSwap(dex: number[], ratios: number[]): BigNumber {
  if (dex.length != ratios.length) {
    throw new Error(`dex and ratios arrays length are different`);
  }

  let swap = BigInt(0);
  for (let i = 0; i < dex.length; ++i) {
    swap = (((swap << BigInt(6)) + BigInt(dex[i])) << BigInt(16)) + BigInt(ratios[i]);
  }
  swap = (swap << BigInt(4)) + BigInt(dex.length);
  return BigNumber.from(swap);
}

export async function showGasUsage(tx: ContractTransaction) {
  const txReceipt = await tx.wait();
  const warningLimit = 1_000_000;
  console.log(`⛽ gas used ${txReceipt.gasUsed} ${txReceipt.gasUsed.gt(warningLimit) ? '!!! WARNING' : ''}`);
}

export async function showBalance(token: ERC20, account: string, startPhrase = ''): Promise<BigNumber> {
  const [balance, symbol, decimals] = await Promise.all([token.balanceOf(account), token.symbol(), token.decimals()]);

  console.log(`${startPhrase.replace('$symbol', symbol)} ${formatUnits(balance, decimals)} ${symbol}`);
  return balance;
}

export async function showBalanceDelta(
  balanceBefore: BigNumber,
  balanceAfter: BigNumber,
  token: ERC20,
  startPhrase = ''
) {
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);

  console.log(
    `${startPhrase.replace('$symbol', symbol)} ${formatUnits(balanceAfter.sub(balanceBefore), decimals)} ${symbol}`
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
    amountIn: BigNumber;
    amountOut: BigNumber;
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

async function getSwapEvent(router: MarginlyRouter, tx: any): Promise<SwapEvent> {
  const eventFilter = router.filters['Swap(bool,uint256,address,address,address,uint256,uint256)'](
    null,
    null,
    null,
    null,
    null,
    null
  );
  const events = await router.queryFilter(eventFilter, tx.blockHash);
  expect(events.length).to.be.eq(1);
  const swapEvent = events[0];

  expect(swapEvent).to.not.be.undefined;
  return swapEvent;
}
