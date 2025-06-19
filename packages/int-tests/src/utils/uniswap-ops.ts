import { formatUnits, parseUnits } from 'ethers';
import { tickToPrice } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';
import { uniswapV3Swapdata } from './chain-ops';
import { IUniswapV3Pool, IUSDC, IWETH9 } from '../../../contracts/typechain-types';
import { MarginlyRouter } from '../../../router/typechain-types';
import { abs } from './fixed-point';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { Logger } from 'pino';

export async function changeWethPrice(
  treasury: SignerWithAddress,
  {
    weth,
    usdc,
    uniswap,
    swapRouter,
  }: {
    weth: IWETH9;
    usdc: IUSDC;
    uniswap: IUniswapV3Pool;
    swapRouter: MarginlyRouter;
  },
  targetPrice: bigint,
  logger: Logger
) {
  logger.info(`Start changing price, target: ${targetPrice.toString()}`);
  const { tick } = await uniswap.connect(treasury.provider).slot0();
  const USDC = new Token(1, usdc.target.toString(), 6, 'USDC');
  const WETH = new Token(1, weth.target.toString(), 18, 'WETH');

  const wethPrice = BigInt(tickToPrice(WETH, USDC, Number(tick)).toFixed(0));
  logger.info(`WETH price is ${wethPrice}`);
  logger.info(`WETH balance uniswap ${formatUnits(await weth.balanceOf(uniswap), 18)}`);
  logger.info(`USDC balance uniswap ${formatUnits(await usdc.balanceOf(uniswap), 6)}`);

  const decreasingPrice = wethPrice >= targetPrice;

  let amountIn = decreasingPrice
    ? parseUnits('2000', 18) // 2000 ETH
    : parseUnits('3200000', 6); //3_200_000 USDC
  const depositAmount = amountIn * 1_000_000n;

  if (decreasingPrice) {
    await (await weth.connect(treasury).deposit({ value: depositAmount, gasLimit: 3000000 })).wait();
    await (await weth.connect(treasury).approve(swapRouter, depositAmount)).wait();
  } else {
    await (await usdc.connect(treasury).mint(treasury, depositAmount, { gasLimit: 3000000 })).wait();
    await (await usdc.connect(treasury).approve(swapRouter, depositAmount)).wait();
  }

  const fee = await uniswap.fee();
  let currentPrice = wethPrice;
  let priceDelta = 0n;

  while (decreasingPrice ? currentPrice > targetPrice : targetPrice > currentPrice) {
    const [tokenIn, tokenOut] = decreasingPrice ? [weth, usdc] : [usdc, weth];

    const priceLeft = abs(targetPrice - currentPrice);
    if (priceDelta > priceLeft) {
      amountIn = (amountIn * priceLeft) / priceDelta;
    }
    await swapRouter.connect(treasury).swapExactInput(uniswapV3Swapdata(), tokenIn, tokenOut, amountIn, 0);

    const { tick } = await uniswap.connect(treasury.provider).slot0();
    const price = BigInt(tickToPrice(WETH, USDC, Number(tick)).toFixed(0));
    priceDelta = abs(price - currentPrice);
    currentPrice = price;
    logger.info(`  WETH price is ${currentPrice}`);
    logger.info(`  uniswap WETH balance  is ${formatUnits(await weth.balanceOf(uniswap), 18)}`);
    logger.info(`  uniswap USDC balance is ${formatUnits(await usdc.balanceOf(uniswap), 6)}`);
  }

  {
    const { tick } = await uniswap.connect(treasury.provider).slot0();
    const wethPrice = BigInt(tickToPrice(WETH, USDC, Number(tick)).toFixed(0));
    logger.info(`WETH price is ${wethPrice}`);
    logger.info(`uniswap WETH balance  is ${formatUnits(await weth.balanceOf(uniswap), 18)}`);
    logger.info(`uniswap USDC balance is ${formatUnits(await usdc.balanceOf(uniswap), 6)}`);
  }
  logger.info(`Price changed`);
}
