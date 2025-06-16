// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';
import '@openzeppelin/contracts/utils/Address.sol';

import '@marginly/router/contracts/interfaces/IMarginlyRouter.sol';

import './LevvaPoolVirtual.sol';
import '../interfaces/IMarginlyFactory.sol';
import '../interfaces/IPriceOracle.sol';
import '../libraries/FP48.sol';

abstract contract LevvaPoolCommon is LevvaPoolVirtual {
  using FP96 for FP96.FixedPoint;
  using LowGasSafeMath for uint256;

  /// @dev Denominator of fee value
  uint24 internal constant WHOLE_ONE = 1e6;
  /// @dev Min available leverage
  uint8 internal constant MIN_LEVERAGE = 1;

  /// @inheritdoc IMarginlyPool
  address public factory;
  /// @inheritdoc IMarginlyPool
  uint32 public defaultSwapCallData;
  /// @dev Timestamp of last reinit execution
  uint256 public lastReinitTimestampSeconds;
  /// @inheritdoc IMarginlyPool
  address public quoteToken;
  /// @inheritdoc IMarginlyPool
  address public baseToken;
  /// @inheritdoc IMarginlyPool
  address public priceOracle;

  Mode public mode;

  MarginlyParams public params;

  /// @dev Initial price. Used to sort key and shutdown calculations. Value gets reset for the latter one
  FP96.FixedPoint public initialPrice;
  /// @notice users positions
  mapping(address => Position) public positions;

  /// @dev Sum of  all base token collateral
  uint256 public discountedBaseCollateral;
  /// @dev Aggregate for base collateral time change calculations
  FP96.FixedPoint public baseCollateralCoeff;
  /// @dev Sum of  all quote token collateral
  uint256 public discountedQuoteCollateral;
  /// @dev Aggregate for quote collateral time change calculations
  FP96.FixedPoint public quoteCollateralCoeff;

  function __LevvaPoolCommon_init(
    address _quoteToken,
    address _baseToken,
    address _priceOracle,
    uint32 _defaultSwapCallData,
    MarginlyParams calldata _params
  ) internal {
    if (factory != address(0)) revert MarginlyErrors.Forbidden();

    if (_quoteToken == address(0)) revert MarginlyErrors.WrongValue();
    if (_baseToken == address(0)) revert MarginlyErrors.WrongValue();
    if (_priceOracle == address(0)) revert MarginlyErrors.WrongValue();

    factory = msg.sender;
    quoteToken = _quoteToken;
    baseToken = _baseToken;
    priceOracle = _priceOracle;
    defaultSwapCallData = _defaultSwapCallData;
    lastReinitTimestampSeconds = block.timestamp;

    baseCollateralCoeff = FP96.one();
    quoteCollateralCoeff = FP96.one();

    initialPrice = getBasePrice(); // TODO: can be replaced with FP96.one?

    _setParameters(_params);

    Position storage techPosition = _getTechPosition();
    techPosition._type = PositionType.Lend;
  }

  /// @notice Get oracle price baseToken / quoteToken
  function getBasePrice() public view returns (FP96.FixedPoint memory) {
    uint256 price = IPriceOracle(priceOracle).getBalancePrice(quoteToken, baseToken);
    return FP96.FixedPoint({inner: price});
  }

  /// @notice Get TWAP price used in mc slippage calculations
  function getLiquidationPrice() public view returns (FP96.FixedPoint memory) {
    uint256 price = IPriceOracle(priceOracle).getMargincallPrice(quoteToken, baseToken);
    return FP96.FixedPoint({inner: price});
  }

  /// @dev Returns Uniswap SwapRouter address
  function _getSwapRouter() internal view returns (address) {
    return IMarginlyFactory(factory).swapRouter();
  }

  /// @dev Returns WETH9 address
  function _getWETH9Address() internal view returns (address) {
    return IMarginlyFactory(factory).WETH9();
  }

  function _setParameters(MarginlyParams calldata _params) internal {
    if (
      _params.interestRate > WHOLE_ONE ||
      _params.fee > WHOLE_ONE ||
      _params.swapFee > WHOLE_ONE ||
      _params.mcSlippage > WHOLE_ONE ||
      _params.maxLeverage < MIN_LEVERAGE ||
      _params.quoteLimit == 0 ||
      _params.positionMinAmount == 0
    ) revert MarginlyErrors.WrongValue();

    params = _params;
    emit ParametersChanged();
  }

  function _newPoolBaseBalance(uint256 extraRealBaseCollateral) internal view returns (uint256) {
    return _calcRealBaseCollateralTotal().add(extraRealBaseCollateral).sub(_calcRealBaseDebtTotal());
  }

  function _newPoolQuoteBalance(uint256 extraRealQuoteCollateral) internal view returns (uint256) {
    return _calcRealQuoteCollateralTotal().add(extraRealQuoteCollateral).sub(_calcRealQuoteDebtTotal());
  }

  function _positionHasBadLeverage(
    Position storage position,
    FP96.FixedPoint memory basePrice
  ) internal view returns (bool) {
    uint256 realTotalCollateral;
    uint256 realTotalDebt;
    if (position._type == PositionType.Short) {
      realTotalCollateral = _calcRealQuoteCollateral(position.discountedQuoteAmount, position.discountedBaseAmount);
      realTotalDebt = basePrice.mul(_calcRealBaseDebt(position.discountedBaseAmount));
    } else if (position._type == PositionType.Long) {
      realTotalCollateral = basePrice.mul(
        _calcRealBaseCollateral(position.discountedBaseAmount, position.discountedQuoteAmount)
      );
      realTotalDebt = _calcRealQuoteDebt(position.discountedQuoteAmount);
    } else {
      return false;
    }

    uint256 maxLeverageX96 = uint256(params.maxLeverage) << FP96.RESOLUTION;
    uint256 leverageX96 = _calcLeverage(realTotalCollateral, realTotalDebt);
    return leverageX96 > maxLeverageX96;
  }

  function _calcLeverage(uint256 collateral, uint256 debt) private pure returns (uint256 leverage) {
    if (collateral > debt) {
      return Math.mulDiv(FP96.Q96, collateral, collateral - debt);
    } else {
      return FP96.INNER_MAX;
    }
  }

  /// @dev Charge fee (swap or debt fee) in quote token
  /// @param feeAmount amount of token
  function _chargeFee(uint256 feeAmount) internal {
    SafeERC20.safeTransfer(IERC20(quoteToken), IMarginlyFactory(factory).feeHolder(), feeAmount);
  }

  /// @dev Returns tech position
  function _getTechPosition() internal view returns (Position storage) {
    return positions[IMarginlyFactory(factory).techPositionOwner()];
  }

  /// @dev Swaps tokens to receive exact amountOut and send at most amountInMaximum
  function _swapExactOutput(
    bool quoteIn,
    uint256 amountInMaximum,
    uint256 amountOut,
    uint256 swapCalldata
  ) internal returns (uint256 amountInActual) {
    address swapRouter = _getSwapRouter();
    (address tokenIn, address tokenOut) = quoteIn ? (quoteToken, baseToken) : (baseToken, quoteToken);

    SafeERC20.forceApprove(IERC20(tokenIn), swapRouter, amountInMaximum);

    amountInActual = IMarginlyRouter(swapRouter).swapExactOutput(
      swapCalldata,
      tokenIn,
      tokenOut,
      amountInMaximum,
      amountOut
    );

    SafeERC20.forceApprove(IERC20(tokenIn), swapRouter, 0);
  }

  /// @dev Swaps tokens to spend exact amountIn and receive at least amountOutMinimum
  function _swapExactInput(
    bool quoteIn,
    uint256 amountIn,
    uint256 amountOutMinimum,
    uint256 swapCalldata
  ) internal returns (uint256 amountOutActual) {
    address swapRouter = _getSwapRouter();
    (address tokenIn, address tokenOut) = quoteIn ? (quoteToken, baseToken) : (baseToken, quoteToken);

    SafeERC20.forceApprove(IERC20(tokenIn), swapRouter, amountIn);

    amountOutActual = IMarginlyRouter(swapRouter).swapExactInput(
      swapCalldata,
      tokenIn,
      tokenOut,
      amountIn,
      amountOutMinimum
    );
  }

  /// @dev Changes tech position base collateral so total calculated base balance to be equal to actual
  function _syncBaseBalance() internal {
    uint256 baseBalance = _getBalance(baseToken);
    uint256 actualBaseCollateral = _calcRealBaseDebtTotal().add(baseBalance);
    uint256 baseCollateral = _calcRealBaseCollateralTotal();
    Position storage techPosition = _getTechPosition();
    if (actualBaseCollateral > baseCollateral) {
      uint256 discountedBaseDelta = baseCollateralCoeff.recipMul(actualBaseCollateral.sub(baseCollateral));
      techPosition.discountedBaseAmount += discountedBaseDelta;
      discountedBaseCollateral += discountedBaseDelta;
    } else {
      uint256 discountedBaseDelta = baseCollateralCoeff.recipMul(baseCollateral.sub(actualBaseCollateral));
      techPosition.discountedBaseAmount -= discountedBaseDelta;
      discountedBaseCollateral -= discountedBaseDelta;
    }
  }

  /// @dev Changes tech position quote collateral so total calculated quote balance to be equal to actual
  function _syncQuoteBalance() internal {
    uint256 quoteBalance = _getBalance(quoteToken);
    uint256 actualQuoteCollateral = _calcRealQuoteDebtTotal().add(quoteBalance);
    uint256 quoteCollateral = _calcRealQuoteCollateralTotal();
    Position storage techPosition = _getTechPosition();
    if (actualQuoteCollateral > quoteCollateral) {
      uint256 discountedQuoteDelta = quoteCollateralCoeff.recipMul(actualQuoteCollateral.sub(quoteCollateral));
      techPosition.discountedQuoteAmount += discountedQuoteDelta;
      discountedQuoteCollateral += discountedQuoteDelta;
    } else {
      uint256 discountedQuoteDelta = quoteCollateralCoeff.recipMul(quoteCollateral.sub(actualQuoteCollateral));
      techPosition.discountedQuoteAmount -= discountedQuoteDelta;
      discountedQuoteCollateral -= discountedQuoteDelta;
    }
  }

  /// @dev returns ERC20 token balance of this contract
  function _getBalance(address erc20Token) internal view returns (uint256) {
    return IERC20(erc20Token).balanceOf(address(this));
  }

  /// @dev Calculate sort key for ordering long/short positions.
  /// Sort key represents value of debt / collateral both in quoteToken.
  /// as FixedPoint with 10 bits for decimals
  function _calcSortKey(uint256 collateral, uint256 debt) internal pure returns (uint96) {
    uint96 maxValue = type(uint96).max;
    if (collateral != 0) {
      uint256 result = Math.mulDiv(FP48.Q48, debt, collateral);
      if (result > maxValue) {
        return maxValue;
      } else {
        return uint96(result);
      }
    } else {
      return maxValue;
    }
  }

  function _updateBaseCollateralCoeffs(FP96.FixedPoint memory factor) internal virtual override {
    baseCollateralCoeff = baseCollateralCoeff.mul(factor);
  }

  function _updateQuoteCollateralCoeffs(FP96.FixedPoint memory factor) internal virtual override {
    quoteCollateralCoeff = quoteCollateralCoeff.mul(factor);
  }

  function _calcRealBaseCollateralTotal() internal view virtual override returns (uint256) {
    return baseCollateralCoeff.mul(discountedBaseCollateral);
  }

  function _calcRealQuoteCollateralTotal() internal view virtual override returns (uint256) {
    return quoteCollateralCoeff.mul(discountedQuoteCollateral);
  }

  function _calcRealBaseCollateral(
    uint256 disBaseCollateral,
    uint256 /*disQuoteDebt*/
  ) internal view virtual override returns (uint256) {
    return baseCollateralCoeff.mul(disBaseCollateral);
  }

  function _calcRealQuoteCollateral(
    uint256 disQuoteCollateral,
    uint256 /*disBaseDebt*/
  ) internal view virtual override returns (uint256) {
    return quoteCollateralCoeff.mul(disQuoteCollateral);
  }
}
