// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import '@marginly/router/contracts/interfaces/IMarginlyRouter.sol';
import './TestUniswapPool.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import 'hardhat/console.sol';

contract TestSwapRouter is IMarginlyRouter {
  address uniswapPool;

  constructor(address _uniswapPool) {
    uniswapPool = _uniswapPool;
  }

  error TooMuchRequested();
  error InsufficientAmount();

  function swapExactInput(
    uint256,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 minAmountOut
  ) external override returns (uint256 amountOut) {
    uint160 token1ToToken0SqrtPriceX96 = TestUniswapPool(uniswapPool).token1ToToken0SqrtPriceX96();
    uint256 priceX96 = Math.mulDiv(token1ToToken0SqrtPriceX96, token1ToToken0SqrtPriceX96, 2 ** 96);

    if (tokenIn == TestUniswapPool(uniswapPool).token0()) {
      priceX96 = Math.mulDiv(2 ** 96, 2 ** 96, priceX96); // price = 1 / price
    }

    amountOut = Math.mulDiv(amountIn, 2 ** 96, priceX96);

    IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
    IERC20(tokenOut).transfer(msg.sender, amountOut);

    if (amountOut < minAmountOut) revert TooMuchRequested();
  }

  function swapExactOutput(
    uint256,
    address tokenIn,
    address tokenOut,
    uint256 maxAmountIn,
    uint256 amountOut
  ) external override returns (uint256 amountIn) {
    uint160 token1ToToken0SqrtPriceX96 = TestUniswapPool(uniswapPool).token1ToToken0SqrtPriceX96();
    uint256 priceX96 = Math.mulDiv(token1ToToken0SqrtPriceX96, token1ToToken0SqrtPriceX96, 2 ** 96);

    if (tokenIn == TestUniswapPool(uniswapPool).token1()) {
      priceX96 = Math.mulDiv(2 ** 96, 2 ** 96, priceX96); // price = 1 / price
    }

    amountIn = Math.mulDiv(amountOut, 2 ** 96, priceX96);

    IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
    IERC20(tokenOut).transfer(msg.sender, amountOut);

    if (amountIn > maxAmountIn) revert InsufficientAmount();
  }

  function adapterCallback(address recipient, uint256 amount, bytes calldata data) external {}
}
