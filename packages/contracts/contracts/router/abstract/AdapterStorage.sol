// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import '@openzeppelin/contracts/access/Ownable2Step.sol';

import '../interfaces/IMarginlyAdapter.sol';

struct PoolInput {
  address token0;
  address token1;
  address pool;
}

abstract contract AdapterStorage is IMarginlyAdapter, Ownable2Step {
  /// @notice Emitted when new pool is added
  event NewPool(address indexed token0, address indexed token1, address indexed pool);

  error UnknownPool();

  error Forbidden();

  mapping(address => mapping(address => address)) public getPool;

  constructor(PoolInput[] memory pools) Ownable(msg.sender) {
    PoolInput memory input;
    uint256 length = pools.length;
    for (uint256 i; i < length; ) {
      input = pools[i];
      getPool[input.token0][input.token1] = input.pool;
      getPool[input.token1][input.token0] = input.pool;
      emit NewPool(input.token0, input.token1, input.pool);

      unchecked {
        ++i;
      }
    }
  }

  function addPools(PoolInput[] calldata pools) external onlyOwner {
    PoolInput memory input;
    uint256 length = pools.length;
    for (uint256 i; i < length; ) {
      input = pools[i];
      getPool[input.token0][input.token1] = input.pool;
      getPool[input.token1][input.token0] = input.pool;
      emit NewPool(input.token0, input.token1, input.pool);

      unchecked {
        ++i;
      }
    }
  }

  function getPoolSafe(address tokenA, address tokenB) internal view returns (address pool) {
    pool = getPool[tokenA][tokenB];
    if (pool == address(0)) revert UnknownPool();
  }

  function renounceOwnership() public view override onlyOwner {
    revert Forbidden();
  }
}
