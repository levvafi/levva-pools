// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import './IMarginlyPoolOwnerActions.sol';
import '../dataTypes/Mode.sol';
import '../libraries/FP96.sol';
import '../dataTypes/Position.sol';
import '../dataTypes/Call.sol';

interface IMarginlyPool is IMarginlyPoolOwnerActions {
  /// @dev Emitted when margin call took place
  /// @param user User that was reinited
  /// @param swapPriceX96 Price of swap worth in quote token as Q96
  event EnactMarginCall(address indexed user, uint256 swapPriceX96, int256 collateralSurplus, PositionType _type);

  /// @dev Emitted when deleverage took place
  /// @param positionType deleveraged positions type
  /// @param totalCollateralReduced total collateral reduced from all positions
  /// @param totalDebtReduced total debt reduced from all positions
  event Deleverage(PositionType positionType, uint256 totalCollateralReduced, uint256 totalDebtReduced);

  /// @dev Emitted when user deposited base token
  /// @param user Depositor
  /// @param amount Amount of token user deposited
  /// @param newPositionType User position type after deposit
  /// @param baseDiscountedAmount Discounted amount of base tokens after deposit
  event DepositBase(address indexed user, uint256 amount, PositionType newPositionType, uint256 baseDiscountedAmount);

  /// @dev Emitted when user deposited quote token
  /// @param user Depositor
  /// @param amount Amount of token user deposited
  /// @param newPositionType User position type after deposit
  /// @param quoteDiscountedAmount Discounted amount of quote tokens after deposit
  event DepositQuote(address indexed user, uint256 amount, PositionType newPositionType, uint256 quoteDiscountedAmount);

  /// @dev Emitted when user withdrew base token
  /// @param user User
  /// @param amount Amount of token user withdrew
  /// @param baseDiscountedDelta Discounted delta amount of base tokens user withdrew
  event WithdrawBase(address indexed user, uint256 amount, uint256 baseDiscountedDelta);

  /// @dev Emitted when user withdrew quote token
  /// @param user User
  /// @param amount Amount of token user withdrew
  /// @param quoteDiscountedDelta Discounted delta amount of quote tokens user withdrew
  event WithdrawQuote(address indexed user, uint256 amount, uint256 quoteDiscountedDelta);

  /// @dev Emitted when user shorted
  /// @param user Depositor
  /// @param amount Amount of token user use in short position
  /// @param swapPriceX96 Price of swap worth in quote token as Q96
  /// @param quoteDiscountedDelta Discounted delta amount of quote tokens
  /// @param baseDiscountedDelta Discounted delta amount of base tokens
  event Short(
    address indexed user,
    uint256 amount,
    bool amountInQuote,
    uint256 swapPriceX96,
    uint256 quoteDiscountedDelta,
    uint256 baseDiscountedDelta
  );

  /// @dev Emitted when user made long position
  /// @param user User
  /// @param amount Amount of token user use in long position
  /// @param swapPriceX96 Price of swap worth in quote token as Q96
  /// @param quoteDiscountedDelta Discounted delta amount of quote tokens
  /// @param baseDiscountedDelta Discounted delta amount of base tokens
  event Long(
    address indexed user,
    uint256 amount,
    bool amountInQuote,
    uint256 swapPriceX96,
    uint256 quoteDiscountedDelta,
    uint256 baseDiscountedDelta
  );

  /// @dev Emitted when user sell all the base tokens from position before Short
  /// @param user User
  /// @param baseDelta amount of base token sold
  /// @param quoteDelta amount of quote tokens received
  /// @param discountedBaseCollateralDelta discounted delta amount of base tokens decreased collateral
  /// @param discountedQuoteCollateralDelta discounted amount of quote tokens increased collateral
  event SellBaseForQuote(
    address indexed user,
    uint256 baseDelta,
    uint256 quoteDelta,
    uint256 discountedBaseCollateralDelta,
    uint256 discountedQuoteCollateralDelta
  );

  /// @dev Emitted when user sell all the quote tokens from position before Long
  /// @param user User
  /// @param quoteDelta amount of quote tokens sold
  /// @param baseDelta amount of base token received
  /// @param discountedQuoteCollateralDelta discounted amount of quote tokens decreased collateral
  /// @param discountedBaseCollateralDelta discounted delta amount of base tokens increased collateral
  event SellQuoteForBase(
    address indexed user,
    uint256 quoteDelta,
    uint256 baseDelta,
    uint256 discountedQuoteCollateralDelta,
    uint256 discountedBaseCollateralDelta
  );

  /// @dev Emitted if long position sold base for quote
  /// @param user User
  /// @param realQuoteDebtDelta real value of quote debt repaid
  /// @param discountedQuoteDebtDelta discounted value of quote debt repaid
  event QuoteDebtRepaid(address indexed user, uint256 realQuoteDebtDelta, uint256 discountedQuoteDebtDelta);

  /// @dev Emitted if short position sold quote for base
  /// @param user User
  /// @param realBaseDebtDelta real value of base debt repaid
  /// @param discountedBaseDebtDelta discounted value of base debt repaid
  event BaseDebtRepaid(address indexed user, uint256 realBaseDebtDelta, uint256 discountedBaseDebtDelta);

  /// @dev Emitted when user closed position
  /// @param user User
  /// @param token Collateral token
  /// @param collateralDelta Amount of collateral reduction
  /// @param swapPriceX96 Price of swap worth in quote token as Q96
  /// @param collateralDiscountedDelta Amount of discounted collateral reduction
  event ClosePosition(
    address indexed user,
    address indexed token,
    uint256 collateralDelta,
    uint256 swapPriceX96,
    uint256 collateralDiscountedDelta
  );

  /// @dev Emitted when position liquidation happened
  /// @param liquidator Liquidator
  /// @param position Liquidated position
  /// @param newPositionType Type of tx sender new position
  /// @param newPositionQuoteDiscounted Discounted amount of quote tokens for new position
  /// @param newPositionBaseDiscounted Discounted amount of base tokens for new position
  event ReceivePosition(
    address indexed liquidator,
    address indexed position,
    PositionType newPositionType,
    uint256 newPositionQuoteDiscounted,
    uint256 newPositionBaseDiscounted
  );

  /// @dev When system switched to emergency mode
  /// @param mode Emergency mode
  event Emergency(Mode mode);

  /// @dev Emitted when user made emergency withdraw
  /// @param who Position owner
  /// @param token Token of withdraw
  /// @param amount Amount of withdraw
  event EmergencyWithdraw(address indexed who, address indexed token, uint256 amount);

  /// @dev Emitted when reinit happened
  /// @param reinitTimestamp timestamp when reinit happened
  event Reinit(uint256 reinitTimestamp, uint256 baseDebtDistributed, uint256 quoteDebtDistributed);

  /// @dev Emitted when balance sync happened
  event BalanceSync();

  /// @dev Emitted when setParameters method was called
  event ParametersChanged();

  /// @dev Initializes the pool
  function initialize(
    address quoteToken,
    address baseToken,
    address priceOracle,
    uint32 defaultSwapCallData,
    MarginlyParams calldata params
  ) external;

  /// @notice Returns the address of quote token from pool
  function quoteToken() external view returns (address token);

  /// @notice Returns the address of base token from pool
  function baseToken() external view returns (address token);

  /// @notice Returns the address of price oracle
  function priceOracle() external view returns (address);

  /// @notice Returns default swap call data
  function defaultSwapCallData() external view returns (uint32);

  /// @notice Returns address of Marginly factory
  function factory() external view returns (address);

  /// @notice Return current value of base price used in all calculations (e.g. leverage)
  function getBasePrice() external view returns (FP96.FixedPoint memory);

  function execute(
    CallType call,
    uint256 amount1,
    int256 amount2,
    uint256 limitPriceX96,
    bool unwrapWETH,
    address receivePositionAddress,
    uint256 swapCalldata
  ) external payable;
}
