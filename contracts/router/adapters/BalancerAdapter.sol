// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';

import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

import '../abstract/AdapterStorage.sol';
import '../interfaces/IMarginlyRouter.sol';

contract BalancerAdapter is AdapterStorage {
  address public immutable balancerVault;

  constructor(PoolInput[] memory pools, address _balancerVault) AdapterStorage(pools) {
    balancerVault = _balancerVault;
  }

  function swapExactInput(
    address recipient,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 minAmountOut,
    bytes calldata data
  ) external returns (uint256 amountOut) {
    address pool = getPoolSafe(tokenIn, tokenOut);
    SingleSwap memory swap;
    swap.poolId = IBasePool(pool).getPoolId();
    swap.kind = SwapKind.GIVEN_IN;
    swap.amount = amountIn;
    swap.assetIn = IAsset(tokenIn);
    swap.assetOut = IAsset(tokenOut);

    FundManagement memory funds;
    funds.sender = address(this);
    funds.recipient = payable(recipient);

    IMarginlyRouter(msg.sender).adapterCallback(address(this), amountIn, data);
    SafeERC20.forceApprove(IERC20(tokenIn), balancerVault, amountIn);
    amountOut = IVault(balancerVault).swap(swap, funds, minAmountOut, block.timestamp);
    if (amountOut < minAmountOut) revert InsufficientAmount();
  }

  function swapExactOutput(
    address recipient,
    address tokenIn,
    address tokenOut,
    uint256 maxAmountIn,
    uint256 amountOut,
    bytes calldata data
  ) external returns (uint256 amountIn) {
    address pool = getPoolSafe(tokenIn, tokenOut);
    SingleSwap memory swap;
    swap.poolId = IBasePool(pool).getPoolId();
    swap.kind = SwapKind.GIVEN_OUT;
    swap.amount = amountOut;
    swap.assetIn = IAsset(tokenIn);
    swap.assetOut = IAsset(tokenOut);

    FundManagement memory funds;
    funds.sender = address(this);
    funds.recipient = payable(recipient);

    IMarginlyRouter(msg.sender).adapterCallback(address(this), maxAmountIn, data);
    SafeERC20.forceApprove(IERC20(tokenIn), balancerVault, maxAmountIn);
    amountIn = IVault(balancerVault).swap(swap, funds, maxAmountIn, block.timestamp);
    if (amountIn > maxAmountIn) revert TooMuchRequested();
    SafeERC20.forceApprove(IERC20(tokenIn), balancerVault, 0);
    TransferHelper.safeTransfer(
      tokenIn,
      abi.decode(data, (IMarginlyRouter.AdapterCallbackData)).payer,
      maxAmountIn - amountIn
    );
  }
}

struct FundManagement {
  address sender;
  bool fromInternalBalance;
  address payable recipient;
  bool toInternalBalance;
}

struct SingleSwap {
  bytes32 poolId;
  SwapKind kind;
  IAsset assetIn;
  IAsset assetOut;
  uint256 amount;
  bytes userData;
}

enum SwapKind {
  GIVEN_IN,
  GIVEN_OUT
}

interface IVault {
  function swap(
    SingleSwap memory singleSwap,
    FundManagement memory funds,
    uint256 limit,
    uint256 deadline
  ) external payable returns (uint256);
}

interface IAsset {}

interface IBasePool {
  function getPoolId() external view returns (bytes32);
}
