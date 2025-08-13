// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/pool/IUniswapV3PoolImmutables.sol';

/// @dev Stub of UniswapFactory
contract TestUniswapFactory is IUniswapV3Factory {
  struct Pool {
    address pool;
    address tokenA;
    address tokenB;
    uint24 fee;
  }

  mapping(address => mapping(address => mapping(uint24 => address))) public override getPool;
  address public override owner;

  constructor(Pool[] memory _pools) {
    owner = msg.sender;

    uint256 length = _pools.length;
    Pool memory input;
    for (uint256 i; i < length; ) {
      input = _pools[i];

      getPool[input.tokenA][input.tokenB][input.fee] = input.pool;
      getPool[input.tokenB][input.tokenA][input.fee] = input.pool;

      unchecked {
        ++i;
      }
    }
  }

  function addPool(address pool) external {
    IUniswapV3PoolImmutables uniswapPool = IUniswapV3PoolImmutables(pool);
    address token0 = uniswapPool.token0();
    address token1 = uniswapPool.token1();
    uint24 fee = uniswapPool.fee();

    getPool[token0][token1][fee] = pool;
    getPool[token1][token0][fee] = pool;
  }

  function feeAmountTickSpacing(uint24) external pure override returns (int24) {
    return 0;
  }

  function createPool(address, address, uint24) external pure override returns (address) {
    revert('not implemented');
  }

  function setOwner(address) external pure override {
    revert('not implemented');
  }

  function enableFeeAmount(uint24, int24) external pure override {
    revert('not implemented');
  }
}
