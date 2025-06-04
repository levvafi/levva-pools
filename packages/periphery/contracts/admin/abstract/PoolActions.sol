// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@marginly/contracts/contracts/interfaces/IMarginlyFactory.sol';
import '@marginly/contracts/contracts/interfaces/IMarginlyPool.sol';
import '@marginly/contracts/contracts/dataTypes/MarginlyParams.sol';
import '@marginly/contracts/contracts/libraries/MarginlyErrors.sol';
import '@marginly/router/contracts/MarginlyRouter.sol';
import '@marginly/router/contracts/abstract/AdapterStorage.sol';

import './MarginlyAdminStorage.sol';

abstract contract PoolActions is MarginlyAdminStorage {
  /// @dev Create a new Marginly pool. The signer will be granted owner role for a new pool
  /// @param underlyingPool Address of underlyig pool
  /// @param quoteToken Address of a quote token
  /// @param baseToken Address of a base token
  /// @param priceOracle Address of price oracle
  /// @param defaultSwapCallData Swap call data that used in MC case
  /// @param params Marginly pool parameters
  function createPool(
    address underlyingPool,
    address quoteToken,
    address baseToken,
    address priceOracle,
    uint32 defaultSwapCallData,
    MarginlyParams calldata params
  ) external returns (address marginlyPoolAddress) {
    if (baseToken == address(0)) revert MarginlyErrors.Forbidden();
    if (quoteToken == address(0)) revert MarginlyErrors.Forbidden();

    marginlyPoolAddress = IMarginlyFactory(marginlyFactoryAddress).createPool(
      quoteToken,
      baseToken,
      priceOracle,
      defaultSwapCallData,
      params
    );
    MarginlyRouter marginlyRouter = MarginlyRouter(IMarginlyFactory(marginlyFactoryAddress).swapRouter());
    address adapterAddress = marginlyRouter.adapters(UNISWAPV3_ADAPTER_INDEX);
    if (adapterAddress == address(0)) revert MarginlyErrors.Forbidden();

    AdapterStorage adapterStorage = AdapterStorage(adapterAddress);
    address poolAddressFromAdapter = adapterStorage.getPool(baseToken, quoteToken);

    if (poolAddressFromAdapter == address(0)) {
      PoolInput[] memory poolInput = new PoolInput[](1);
      poolInput[0] = PoolInput(baseToken, quoteToken, underlyingPool);
      adapterStorage.addPools(poolInput);
    } else if (poolAddressFromAdapter != underlyingPool) {
      revert InvalidUnderlyingPool();
    }

    poolsOwners[marginlyPoolAddress] = msg.sender;
    emit NewPoolOwner(marginlyPoolAddress, msg.sender);
  }

  /// @dev Set new params for a Marginly pool. Allowed only for pool owner
  /// @param marginlyPool Address of a Marginly pool
  /// @param params Marginly pool parameters
  function setParameters(address marginlyPool, MarginlyParams calldata params) external {
    if (msg.sender != poolsOwners[marginlyPool]) revert MarginlyErrors.NotOwner();
    IMarginlyPool(marginlyPool).setParameters(params);
  }

  /// @dev Switch Marginly pool to emergency mode when collateral of any side not enough to cover debt.
  /// @dev Allowed only for pool owner
  /// @param marginlyPool Address of a Marginly pool
  /// @param swapCalldata param of IMarginlyPool.shutDown method
  function shutDown(address marginlyPool, uint256 swapCalldata) external {
    if (msg.sender != poolsOwners[marginlyPool]) revert MarginlyErrors.NotOwner();
    IMarginlyPool(marginlyPool).shutDown(swapCalldata);
  }

  /// @dev Sweep ETH balance of Marginly pool. Allowed only for pool owner
  /// @param marginlyPool Address of a Marginly pool
  function sweepETH(address marginlyPool) external returns (uint256 amount) {
    if (msg.sender != poolsOwners[marginlyPool]) revert MarginlyErrors.NotOwner();
    amount = marginlyPool.balance;
    if (amount > 0) {
      IMarginlyPool(marginlyPool).sweepETH();
      TransferHelper.safeTransferETH(msg.sender, amount);
    }
  }

  /// @dev Set a new owner of a Marginly pool. Allowed only for Marginly pool owner
  /// @param marginlyPool Address of a Marginly pool
  /// @param to Address of a new Marginly pool owner
  function transferMarginlyPoolOwnership(address marginlyPool, address to) external {
    if (msg.sender != poolsOwners[marginlyPool]) revert MarginlyErrors.NotOwner();
    poolsOwners[marginlyPool] = to;
    emit NewPoolOwner(marginlyPool, to);
  }

  /// @dev This function is required for the sweepETH successful execution
  receive() external payable {}
}
