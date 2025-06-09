import { ethers } from 'hardhat';
import { CurveAdapter, ERC20, ICurvePool, MarginlyRouter } from '../../typechain-types';
import { PoolInputStruct } from '../../typechain-types/contracts/adapters/CurveAdapter';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ArbMainnetERC20BalanceOfSlot, setTokenBalance } from '../shared/tokens';
import { formatEther, formatUnits, parseUnits } from 'ethers';

interface TokenInfo {
  contract: ERC20;
  symbol: string;
  decimals: bigint;
  balanceOfSlot: string;
}

function formatTokenBalance(token: TokenInfo, amount: bigint): string {
  return `${formatUnits(amount, token.decimals)} ${token.symbol}`;
}

describe('Curve adapter for frxETH/WETH pool (CurveAdapter)', () => {
  // rxETH/WETH pool - https://curve.fi/#/arbitrum/pools/factory-v2-140/deposit
  const poolAddress = '0x1DeB3b1cA6afca0FF9C5cE9301950dC98Ac0D523';
  let token0: TokenInfo;
  let token1: TokenInfo;
  let pool: ICurvePool;
  let router: MarginlyRouter;
  let adapter: CurveAdapter;

  before(async () => {
    pool = await ethers.getContractAt('ICurvePool', poolAddress);
    const adapterFactory = await ethers.getContractFactory('CurveAdapter');

    const token0Address = await pool.coins(0);
    const token1Address = await pool.coins(1);
    const token0Contract = await ethers.getContractAt('ERC20', token0Address);
    const token1Contract = await ethers.getContractAt('ERC20', token1Address);
    const token0Symbol = await token0Contract.symbol();
    const token1Symbol = await token1Contract.symbol();
    const token0Decimals = await token0Contract.decimals();
    const token1Decimals = await token1Contract.decimals();

    token0 = <TokenInfo>{
      contract: token0Contract,
      symbol: token0Symbol,
      decimals: token0Decimals,
      balanceOfSlot: ArbMainnetERC20BalanceOfSlot.WETH,
    };
    token1 = <TokenInfo>{
      contract: token1Contract,
      symbol: token1Symbol,
      decimals: token1Decimals,
      balanceOfSlot: ArbMainnetERC20BalanceOfSlot.FRXETH,
    };
    adapter = await adapterFactory.deploy([
      <PoolInputStruct>{ token0: token0Address, token1: token1Address, pool: poolAddress },
    ]);

    const routerFactory = await ethers.getContractFactory('MarginlyRouter');
    router = await routerFactory.deploy([{ dexIndex: 0, adapter: adapter }]);

    const [owner, user1, user2] = await ethers.getSigners();

    const token0InitBalance = parseUnits('1', 18);
    await setTokenBalance(token0Address, token0.balanceOfSlot, owner.address, token0InitBalance);
    await setTokenBalance(token0Address, token0.balanceOfSlot, user1.address, token0InitBalance);
    await setTokenBalance(token0Address, token0.balanceOfSlot, user2.address, token0InitBalance);

    const token1InitBalance = parseUnits('10', 18);
    await setTokenBalance(token1Address, token1.balanceOfSlot, owner.address, token1InitBalance);
    await setTokenBalance(token1Address, token1.balanceOfSlot, user1.address, token1InitBalance);
    await setTokenBalance(token1Address, token1.balanceOfSlot, user2.address, token1InitBalance);
  });

  function printPrice(priceInToken0: bigint) {
    const priceStr = formatEther(priceInToken0);
    const inversePrice = 1 / Number.parseFloat(priceStr);
    console.log(`1 ${token1.symbol} = ${priceStr} ${token0.symbol}`);
    console.log(`1 ${token0.symbol} = ${inversePrice} ${token1.symbol}`);
  }

  function printPriceWithDelta(newPriceInToken0: bigint, oldPriceInToken0: bigint) {
    const newPriceStr = formatEther(newPriceInToken0);
    const inverseNewPrice = 1 / Number.parseFloat(newPriceStr);

    const oldPriceStr = formatEther(oldPriceInToken0);
    const inverseOldPrice = 1 / Number.parseFloat(oldPriceStr);

    const deltaPrice = newPriceInToken0 - oldPriceInToken0;
    const deltaPriceStr = formatEther(deltaPrice);
    const deltaInversePrice = inverseNewPrice - inverseOldPrice;

    console.log(`1 ${token1.symbol} = ${newPriceStr} ${token0.symbol}, delta: ${deltaPriceStr} ${token0.symbol}`);
    console.log(
      `1 ${token0.symbol} = ${inverseNewPrice} ${token1.symbol}, ` + `delta: ${deltaInversePrice} ${token1.symbol}`
    );
  }

  async function swapExactInput(signer: SignerWithAddress, zeroToOne: boolean, amountIn: bigint, minAmountOut: bigint) {
    const inToken = zeroToOne ? token0 : token1;
    const outToken = zeroToOne ? token1 : token0;
    const inTokenBalanceBefore = await inToken.contract.balanceOf(signer);
    const outTokenBalanceBefore = await outToken.contract.balanceOf(signer);

    console.log(
      `signer balance before swap: ${formatTokenBalance(inToken, inTokenBalanceBefore)}, ` +
        `${formatTokenBalance(outToken, outTokenBalanceBefore)}`
    );
    const amountInStr = formatTokenBalance(inToken, amountIn);
    const minAmountOutStr = formatTokenBalance(outToken, minAmountOut);

    console.log(`swapExactInput:`);
    console.log(`amountIn: ${amountInStr}`);
    console.log(`minAmountOut: ${minAmountOutStr}`);

    const priceInToken0Before = await pool.last_price();

    await router.swapExactInput(0n, inToken.contract, outToken.contract, amountIn, minAmountOut);

    const inTokenBalanceAfter = await inToken.contract.balanceOf(signer);
    const outTokenBalanceAfter = await outToken.contract.balanceOf(signer);

    console.log(
      `\nsigner balance after swap: ${formatTokenBalance(inToken, inTokenBalanceAfter)}, ` +
        `${formatTokenBalance(outToken, outTokenBalanceAfter)}`
    );

    const inTokenDelta = inTokenBalanceBefore - inTokenBalanceAfter;
    const outTokenDelta = outTokenBalanceAfter - outTokenBalanceBefore;
    console.log(
      `signer balances delta: -${formatTokenBalance(inToken, inTokenDelta)}, ` +
        `${formatTokenBalance(outToken, outTokenDelta)}`
    );
    const one = parseUnits('1', 18);
    let actualPriceInToken0: bigint;
    if (zeroToOne) {
      actualPriceInToken0 = (inTokenDelta * one) / outTokenDelta;
    } else {
      actualPriceInToken0 = (outTokenDelta * one) / inTokenDelta;
    }

    console.log(`\nPrice before swap (fees not included):`);
    printPrice(priceInToken0Before);
    console.log(`\nActual swap price (with fees):`);
    printPriceWithDelta(actualPriceInToken0, priceInToken0Before);

    expect(inTokenBalanceAfter).to.be.equal(inTokenBalanceBefore - amountIn);
    expect(outTokenBalanceAfter).to.be.greaterThanOrEqual(outTokenBalanceBefore + minAmountOut);
  }

  async function swapExactOutput(
    signer: SignerWithAddress,
    zeroToOne: boolean,
    maxAmountIn: bigint,
    amountOut: bigint
  ) {
    const inToken = zeroToOne ? token0 : token1;
    const outToken = zeroToOne ? token1 : token0;
    const inTokenBalanceBefore = await inToken.contract.balanceOf(signer);
    const outTokenBalanceBefore = await outToken.contract.balanceOf(signer);

    console.log(
      `signer balance before swap: ${formatTokenBalance(inToken, inTokenBalanceBefore)}, ` +
        `${formatTokenBalance(outToken, outTokenBalanceBefore)}`
    );
    const maxAmountInStr = formatTokenBalance(inToken, maxAmountIn);
    const amountOutStr = formatTokenBalance(outToken, amountOut);

    console.log(`swapExactInput:`);
    console.log(`maxAmountIn: ${maxAmountInStr}`);
    console.log(`minAmountOut: ${amountOutStr}`);

    const priceInToken0Before = await pool.last_price();

    await router.swapExactOutput(0n, inToken.contract, outToken.contract, maxAmountIn, amountOut);

    const inTokenBalanceAfter = await inToken.contract.balanceOf(signer);
    const outTokenBalanceAfter = await outToken.contract.balanceOf(signer);

    console.log(
      `\nsigner balance after swap: ${formatTokenBalance(inToken, inTokenBalanceAfter)}, ` +
        `${formatTokenBalance(outToken, outTokenBalanceAfter)}`
    );

    const inTokenDelta = inTokenBalanceBefore - inTokenBalanceAfter;
    const outTokenDelta = outTokenBalanceAfter - outTokenBalanceBefore;
    console.log(
      `signer balances delta: -${formatTokenBalance(inToken, inTokenDelta)}, ` +
        `${formatTokenBalance(outToken, outTokenDelta)}`
    );
    const one = parseUnits('1', 18);
    let actualPriceInToken0: bigint;
    if (zeroToOne) {
      actualPriceInToken0 = (inTokenDelta * one) / outTokenDelta;
    } else {
      actualPriceInToken0 = (outTokenDelta * one) / inTokenDelta;
    }

    console.log(`\nPrice before swap (fees not included):`);
    printPrice(priceInToken0Before);
    console.log(`\nActual swap price (with fees):`);
    printPriceWithDelta(actualPriceInToken0, priceInToken0Before);

    expect(inTokenBalanceAfter).to.be.greaterThanOrEqual(inTokenBalanceBefore - maxAmountIn);
    expect(outTokenBalanceAfter).to.be.equal(outTokenBalanceBefore + amountOut);
  }

  it('swapExactInput WETH to frxETH', async () => {
    const [owner] = await ethers.getSigners();
    const amountIn = parseUnits('0.0001', 18); // 0.0001 WETH
    const minAmountOut = amountIn / 100n;

    await token0.contract.approve(router, amountIn);

    await swapExactInput(owner, true, amountIn, minAmountOut);
  });

  it('swapExactInput frxETH to WETH', async () => {
    const [owner] = await ethers.getSigners();
    const amountIn = parseUnits('0.0001', 18); // 0.0001 frxETH
    const minAmountOut = amountIn / 10n;

    await token1.contract.approve(router, amountIn);

    await swapExactInput(owner, false, amountIn, minAmountOut);
  });

  it('swapExactOutput frxETH to WETH', async () => {
    const [owner] = await ethers.getSigners();

    const maxAmountIn = parseUnits('0.0001', 18); // 0.0001 frxETH
    const amountOut = maxAmountIn / 100n;

    await token1.contract.approve(router, maxAmountIn);

    await swapExactOutput(owner, false, maxAmountIn, amountOut);
  });

  it('swapExactOutput WETH to frxETH', async () => {
    const [owner] = await ethers.getSigners();

    const maxAmountIn = parseUnits('0.0001', 18); // 0.0001 frxETH
    const amountOut = maxAmountIn / 100n;

    await token0.contract.approve(router, maxAmountIn);

    await swapExactOutput(owner, true, maxAmountIn, amountOut);
  });

  it('swapExactInput WETH to frxETH. TooMuchRequested', async () => {
    const [owner] = await ethers.getSigners();
    const amountIn = parseUnits('0.0001', 18); // 0.0001 WETH
    const minAmountOut = amountIn * 1000n;

    await token0.contract.approve(router, amountIn);

    await expect(swapExactInput(owner, true, amountIn, minAmountOut)).to.be.revertedWith(
      'Exchange resulted in fewer coins than expected'
    );
  });

  it('swapExactInput frxETH to WETH. TooMuchRequested', async () => {
    const [owner] = await ethers.getSigners();
    const amountIn = parseUnits('0.0001', 18); // 0.0001 frxETH
    const minAmountOut = amountIn * 1000n;

    await token1.contract.approve(router, amountIn);

    await expect(swapExactInput(owner, false, amountIn, minAmountOut)).to.be.revertedWith(
      'Exchange resulted in fewer coins than expected'
    );
  });

  it('swapExactOutput WETH to frxETH. TooMuchRequested', async () => {
    const [owner] = await ethers.getSigners();

    const maxAmountIn = parseUnits('0.0001', 18); // 0.0001 WETH
    const amountOut = maxAmountIn * 1000n;

    await token0.contract.approve(router, maxAmountIn);

    await expect(swapExactOutput(owner, true, maxAmountIn, amountOut)).to.be.revertedWith(
      'Exchange resulted in fewer coins than expected'
    );
  });

  it('swapExactOutput frxETH to WETH. TooMuchRequested', async () => {
    const [owner] = await ethers.getSigners();

    const maxAmountIn = parseUnits('0.0001', 18); // 0.0001 frxETH
    const amountOut = maxAmountIn * 1000n;

    await token1.contract.approve(router, maxAmountIn);

    await expect(swapExactOutput(owner, false, maxAmountIn, amountOut)).to.be.revertedWith(
      'Exchange resulted in fewer coins than expected'
    );
  });
});
