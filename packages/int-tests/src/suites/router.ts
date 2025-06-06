import assert = require('assert');
import { parseUnits, ZeroAddress } from 'ethers';
import { SystemUnderTest } from '.';
import { logger } from '../utils/logger';
import { constructSwap, Dex, SWAP_ONE } from '../utils/chain-ops';
import { ethers } from 'ethers';

export async function routerSwaps(sut: SystemUnderTest) {
  logger.info(`Starting routerSwaps test suite`);
  const { treasury, usdc, weth, swapRouter, provider } = sut;

  let currentWethBalance = await weth.balanceOf(treasury.address);
  let currentUsdcBalance = await usdc.balanceOf(treasury.address);

  const dexShouldFail = new Set<bigint>([Dex.DodoV1]);

  for (const dexInfo of Object.entries(Dex)) {
    const adapterAddress = await swapRouter.adapters(dexInfo[1]);
    if (adapterAddress == ZeroAddress) continue;

    // balancer adapter abi is used since it has both getPool and balancerVault methods
    const adapter = new ethers.Contract(
      adapterAddress,
      require(`@marginly/router/artifacts/contracts/adapters/BalancerAdapter.sol/BalancerAdapter.json`).abi,
      provider
    );
    const dexPoolAddress = dexInfo[0] == 'Balancer' ? await adapter.balancerVault() : await adapter.getPool(weth, usdc);

    if (dexPoolAddress == ZeroAddress) continue;
    logger.info(`Testing ${dexInfo[0]} dex`);

    const dex = constructSwap([dexInfo[1]], [SWAP_ONE]);

    {
      logger.info(`  Testing swapExactOutput`);
      const wethAmount = parseUnits('0.01', 18);
      const usdcAmount = parseUnits('10', 6);

      const oldWethBalance = currentWethBalance;
      const oldUsdcBalance = currentUsdcBalance;

      const oldPoolWethBalance = await weth.balanceOf(dexPoolAddress);
      const oldPoolUsdcBalance = await usdc.balanceOf(dexPoolAddress);

      await weth.connect(treasury).approve(swapRouter, wethAmount);
      if (dexShouldFail.has(dexInfo[1])) {
        let failed = false;
        try {
          await (
            await swapRouter.swapExactOutput(dex, weth, usdc, wethAmount, usdcAmount, {
              gasLimit: 1_000_000,
            })
          ).wait();
        } catch {
          failed = true;
        }
        logger.info(`    Checking fail`);
        assert(failed);
      } else {
        await (
          await swapRouter.swapExactOutput(dex, weth, usdc, wethAmount, usdcAmount, {
            gasLimit: 1_000_000,
          })
        ).wait();

        currentWethBalance = await weth.balanceOf(treasury);
        currentUsdcBalance = await usdc.balanceOf(treasury);

        const currentPoolWethBalance = await weth.balanceOf(dexPoolAddress);
        const currentPoolUsdcBalance = await usdc.balanceOf(dexPoolAddress);

        logger.info(`    Checking weth balances`);
        const poolWethDelta = currentPoolWethBalance - oldPoolWethBalance;
        const wethDelta = oldWethBalance - currentWethBalance;
        assert(wethDelta >= poolWethDelta);
        assert(wethDelta != 0n);
        assert(wethDelta <= wethAmount);

        logger.info(`    Checking usdc balances`);
        const poolUsdcDelta = oldPoolUsdcBalance - currentPoolUsdcBalance;
        const usdcDelta = currentUsdcBalance - oldUsdcBalance;
        assert(usdcDelta >= poolUsdcDelta);
        assert(usdcDelta == usdcAmount);
      }
    }

    {
      logger.info(`  Testing swapExactInput`);
      const wethAmount = parseUnits('0.01', 18);
      const usdcAmount = parseUnits('100', 6);

      const oldWethBalance = currentWethBalance;
      const oldUsdcBalance = currentUsdcBalance;

      const oldPoolWethBalance = await weth.balanceOf(dexPoolAddress);
      const oldPoolUsdcBalance = await usdc.balanceOf(dexPoolAddress);

      await usdc.connect(treasury).approve(swapRouter, usdcAmount);
      await (
        await swapRouter.swapExactInput(dex, usdc, weth, usdcAmount, wethAmount, {
          gasLimit: 1_000_000,
        })
      ).wait();

      currentWethBalance = await weth.balanceOf(treasury);
      currentUsdcBalance = await usdc.balanceOf(treasury);

      const currentPoolWethBalance = await weth.balanceOf(dexPoolAddress);
      const currentPoolUsdcBalance = await usdc.balanceOf(dexPoolAddress);

      logger.info(`    Checking weth balances`);
      const poolWethDelta = oldPoolWethBalance - currentPoolWethBalance;
      const wethDelta = currentWethBalance - oldWethBalance;

      if (dexInfo[1] != Dex.DodoV2 && dexInfo[1] != Dex.DodoV1) {
        // DODO transfer fee out from the pool, so poolWethDelta > wethDelta
        assert(wethDelta == poolWethDelta);
      }
      assert(wethDelta >= wethAmount);

      logger.info(`    Checking usdc balances`);
      const poolUsdcDelta = currentPoolUsdcBalance - oldPoolUsdcBalance;
      const usdcDelta = oldUsdcBalance - currentUsdcBalance;

      if (dexInfo[1] == Dex.DodoV1) {
        // In case of Dodo V1 exactInput swap usdcDelta = poolUsdcDelta + uniswapV3UsdcDelta
        assert(usdcDelta >= poolUsdcDelta);
      } else {
        assert(usdcDelta == poolUsdcDelta);
      }
      assert(usdcDelta == usdcAmount);
    }
  }
}

export async function routerMultipleSwaps(sut: SystemUnderTest) {
  logger.info(`Starting routerMultipleSwaps test suite`);
  const { treasury, usdc, weth, swapRouter, provider } = sut;

  let currentWethBalance = await weth.balanceOf(treasury.address);
  let currentUsdcBalance = await usdc.balanceOf(treasury.address);

  const dexs = new Array<{ dexName: string; dexIndex: number; address: string } | undefined>();

  for (const dexInfo of Object.entries(Dex)) {
    const adapterAddress = await swapRouter.adapters(dexInfo[1]);
    if (adapterAddress == ZeroAddress || dexInfo[1] == Dex.DodoV1) continue;

    // balancer adapter abi is used since it has both getPool and balancerVault methods
    const adapter = new ethers.Contract(
      await swapRouter.adapters(dexInfo[1]),
      require(`@marginly/router/artifacts/contracts/adapters/BalancerAdapter.sol/BalancerAdapter.json`).abi,
      provider.provider
    );
    const dexPoolAddress = dexInfo[0] == 'Balancer' ? await adapter.balancerVault() : await adapter.getPool(weth, usdc);

    const element =
      dexPoolAddress != ZeroAddress
        ? { dexName: dexInfo[0], dexIndex: Number(dexInfo[1]), address: dexPoolAddress }
        : undefined;
    dexs.push(element);
  }

  const dexNumber = dexs.length;
  let firstDex;
  do {
    firstDex = Math.floor(Math.random() * dexNumber);
  } while (!dexs[firstDex]);
  logger.info(`First dex is ${dexs[firstDex]!.dexName}`);

  let secondDex;
  do {
    secondDex = Math.floor(Math.random() * dexNumber);
  } while (!dexs[secondDex] || secondDex === firstDex);
  logger.info(`Second dex is ${dexs[secondDex]!.dexName}`);

  const firstDexRatio = BigInt(Math.floor(Math.random() * Number(SWAP_ONE)));
  logger.info(`${dexs[firstDex]!.dexName} dex ratio: ${firstDexRatio}`);
  const secondDexRatio = SWAP_ONE - firstDexRatio;
  logger.info(`${dexs[secondDex]!.dexName} dex ratio: ${secondDexRatio}`);

  const swapCalldata = constructSwap(
    [BigInt(dexs[firstDex]?.dexIndex!), BigInt(dexs[secondDex]?.dexIndex!)],
    [firstDexRatio, secondDexRatio]
  );
  logger.info(`swap calldata: ${swapCalldata}`);

  {
    logger.info(`  Testing swapExactOutput`);
    const wethAmount = parseUnits('0.01', 18);
    const usdcAmount = parseUnits('10', 6);

    const oldWethBalance = currentWethBalance;
    const oldUsdcBalance = currentUsdcBalance;

    const oldFirstPoolWethBalance = await weth.balanceOf(dexs[firstDex]!.address);
    const oldFirstPoolUsdcBalance = await usdc.balanceOf(dexs[firstDex]!.address);

    const oldSecondPoolWethBalance = await weth.balanceOf(dexs[secondDex]!.address);
    const oldSecondPoolUsdcBalance = await usdc.balanceOf(dexs[secondDex]!.address);

    await weth.connect(treasury).approve(swapRouter, wethAmount);
    await (
      await swapRouter.swapExactOutput(swapCalldata, weth, usdc, wethAmount, usdcAmount, {
        gasLimit: 1_000_000,
      })
    ).wait();

    currentWethBalance = await weth.balanceOf(treasury);
    currentUsdcBalance = await usdc.balanceOf(treasury);

    const currentFirstPoolWethBalance = await weth.balanceOf(dexs[firstDex]!.address);
    const currentFirstPoolUsdcBalance = await usdc.balanceOf(dexs[firstDex]!.address);

    const currentSecondPoolWethBalance = await weth.balanceOf(dexs[secondDex]!.address);
    const currentSecondPoolUsdcBalance = await usdc.balanceOf(dexs[secondDex]!.address);

    logger.info(`    Checking weth balances`);
    const firstPoolWethDelta = currentFirstPoolWethBalance - oldFirstPoolWethBalance;
    const secondPoolWethDelta = currentSecondPoolWethBalance - oldSecondPoolWethBalance;
    const wethDelta = oldWethBalance - currentWethBalance;
    assert(wethDelta >= firstPoolWethDelta + secondPoolWethDelta);
    assert(wethDelta != 0n);
    assert(wethDelta <= wethAmount);

    logger.info(`    Checking usdc balances`);
    const firstPoolUsdcDelta = oldFirstPoolUsdcBalance - currentFirstPoolUsdcBalance;
    const secondPoolUsdcDelta = oldSecondPoolUsdcBalance - currentSecondPoolUsdcBalance;
    const usdcDelta = currentUsdcBalance - oldUsdcBalance;
    if (BigInt(dexs[firstDex]?.dexIndex!) != Dex.DodoV2 && BigInt(dexs[secondDex]?.dexIndex!) != Dex.DodoV2) {
      // DODO v2 transfer fee out from the pool, so poolUsdcDelta > usdcDelta
      assert(usdcDelta == firstPoolUsdcDelta + secondPoolUsdcDelta);
    }
    assert(usdcDelta == usdcAmount);
  }

  {
    logger.info(`  Testing swapExactInput`);
    const wethAmount = parseUnits('0.01', 18);
    const usdcAmount = parseUnits('100', 6);

    const oldWethBalance = currentWethBalance;
    const oldUsdcBalance = currentUsdcBalance;

    const oldFirstPoolWethBalance = await weth.balanceOf(dexs[firstDex]!.address);
    const oldFirstPoolUsdcBalance = await usdc.balanceOf(dexs[firstDex]!.address);

    const oldSecondPoolWethBalance = await weth.balanceOf(dexs[secondDex]!.address);
    const oldSecondPoolUsdcBalance = await usdc.balanceOf(dexs[secondDex]!.address);

    await usdc.connect(treasury).approve(swapRouter, usdcAmount);
    await (
      await swapRouter.swapExactInput(swapCalldata, usdc, weth, usdcAmount, wethAmount, {
        gasLimit: 1_000_000,
      })
    ).wait();

    currentWethBalance = await weth.balanceOf(treasury);
    currentUsdcBalance = await usdc.balanceOf(treasury);

    const currentFirstPoolWethBalance = await weth.balanceOf(dexs[firstDex]!.address);
    const currentFirstPoolUsdcBalance = await usdc.balanceOf(dexs[firstDex]!.address);

    const currentSecondPoolWethBalance = await weth.balanceOf(dexs[secondDex]!.address);
    const currentSecondPoolUsdcBalance = await usdc.balanceOf(dexs[secondDex]!.address);

    logger.info(`    Checking weth balances`);
    const firstPoolWethDelta = oldFirstPoolWethBalance - currentFirstPoolWethBalance;
    const secondPoolWethDelta = oldSecondPoolWethBalance - currentSecondPoolWethBalance;
    const wethDelta = currentWethBalance - oldWethBalance;
    if (BigInt(dexs[firstDex]?.dexIndex!) != Dex.DodoV2 && BigInt(dexs[secondDex]?.dexIndex!) != Dex.DodoV2) {
      // DODO v2 transfer fee out from the pool, so poolWethDelta > wethDelta
      assert(wethDelta == firstPoolWethDelta + secondPoolWethDelta);
    }
    assert(wethDelta >= wethAmount);

    logger.info(`    Checking usdc balances`);
    const firstPoolUsdcDelta = currentFirstPoolUsdcBalance - oldFirstPoolUsdcBalance;
    const secondPoolUsdcDelta = currentSecondPoolUsdcBalance - oldSecondPoolUsdcBalance;
    const usdcDelta = oldUsdcBalance - currentUsdcBalance;

    assert(usdcDelta == firstPoolUsdcDelta + secondPoolUsdcDelta);
    assert(usdcDelta == usdcAmount);
  }
}
