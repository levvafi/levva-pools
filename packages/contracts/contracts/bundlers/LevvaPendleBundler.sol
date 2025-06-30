// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IPMarket} from '@pendle/core-v2/contracts/interfaces/IPMarket.sol';
import {IPPrincipalToken} from '@pendle/core-v2/contracts/interfaces/IPPrincipalToken.sol';
import {IPAllActionV3} from '@pendle/core-v2/contracts/interfaces/IPAllActionV3.sol';
import {
  TokenInput,
  ApproxParams,
  LimitOrderData,
  SwapData,
  TokenOutput
} from '@pendle/core-v2/contracts/interfaces/IPAllActionTypeV3.sol';
import {IPPrincipalToken} from '@pendle/core-v2/contracts/interfaces/IPPrincipalToken.sol';

import '../pool/interfaces/IMarginlyPool.sol';
import '../pool/interfaces/IMarginlyFactory.sol';
import '../pool/dataTypes/Call.sol';

contract LevvaPendleBundler {
  using SafeERC20 for IERC20;

  error SlippageProtection();
  error WrongMarket();
  error ZeroAddress();

  address public immutable pendleRouter;

  constructor(address _pendleRouter) {
    if (_pendleRouter == address(0)) revert ZeroAddress();

    pendleRouter = _pendleRouter;
  }

  function enter(
    address levvaPool,
    address market,
    uint256 minPt,
    int256 longAmount,
    bool longAmountInQuote,
    uint256 limitPrice,
    ApproxParams calldata approxParams,
    TokenInput calldata tokenInput,
    LimitOrderData calldata limitOrderData
  ) external {
    address poolPtToken = IMarginlyPool(levvaPool).baseToken();
    (, IPPrincipalToken marketPtToken, ) = IPMarket(market).readTokens();
    if (poolPtToken != address(marketPtToken)) revert WrongMarket();

    uint256 ptAmount = _swapExactTokenForPt(market, approxParams, tokenInput, limitOrderData, minPt);

    IERC20(poolPtToken).forceApprove(levvaPool, ptAmount);
    uint256 swapCalldata = IMarginlyPool(levvaPool).defaultSwapCallData();
    IMarginlyPool(levvaPool).execute(
      CallType.DepositBase,
      ptAmount,
      longAmount,
      limitPrice,
      longAmountInQuote,
      msg.sender,
      swapCalldata
    );
  }

  function _swapExactTokenForPt(
    address market,
    ApproxParams calldata approxParams,
    TokenInput calldata tokenInput,
    LimitOrderData calldata limitOrderData,
    uint256 minPtOut
  ) private returns (uint256 netPtOut) {
    IERC20(tokenInput.tokenIn).safeTransferFrom(msg.sender, address(this), tokenInput.netTokenIn);
    IERC20(tokenInput.tokenIn).forceApprove(pendleRouter, tokenInput.netTokenIn);

    (netPtOut, , ) = IPAllActionV3(pendleRouter).swapExactTokenForPt(
      address(this),
      market,
      minPtOut,
      approxParams,
      tokenInput,
      limitOrderData
    );

    if (netPtOut < minPtOut) {
      revert SlippageProtection();
    }
  }
}
