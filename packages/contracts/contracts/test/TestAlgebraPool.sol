// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import '@cryptoalgebra/v1.9-core/contracts/interfaces/callback/IAlgebraFlashCallback.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';
import '@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract TestAlgebraPool {
  /// @notice Emitted by the pool for any flashes of token0/token1
  /// @param sender The address that initiated the swap call, and that received the callback
  /// @param recipient The address that received the tokens from flash
  /// @param amount0 The amount of token0 that was flashed
  /// @param amount1 The amount of token1 that was flashed
  /// @param paid0 The amount of token0 paid for the flash, which can exceed the amount0 plus the fee
  /// @param paid1 The amount of token1 paid for the flash, which can exceed the amount1 plus the fee
  event Flash(
    address indexed sender,
    address indexed recipient,
    uint256 amount0,
    uint256 amount1,
    uint256 paid0,
    uint256 paid1
  );

  address public token0;
  address public token1;

  uint160 public token1ToToken0SqrtPriceX96 = 0x02000000000000000000000000;
  int56 tickCumulativesSecond = 13863 * 900;

  constructor(address _token0, address _token1) {
    token0 = _token0;
    token1 = _token1;
  }

  function setTokenPriceAndTickCumulative(uint160 _token1ToToken1SqrtPriceX96, int56 _tickCumulativesSecond) external {
    token1ToToken0SqrtPriceX96 = _token1ToToken1SqrtPriceX96;
    tickCumulativesSecond = _tickCumulativesSecond;
  }

  /// token1ToToken0Price = 1
  function setParityPrice() external {
    token1ToToken0SqrtPriceX96 = 79228162514264337593543950336; // 1 * 2^96
    tickCumulativesSecond = 0;
  }

  /// token1ToToken0Price = 4
  function setDefaultQuoteBasePrice() external {
    token1ToToken0SqrtPriceX96 = 0x02000000000000000000000000; // 2 * 2^96
    tickCumulativesSecond = 13863 * 900;
  }

  /// token1ToToken1Price = 16
  function setPriceQuoteBiggerThanBase() external {
    token1ToToken0SqrtPriceX96 = 0x04000000000000000000000000; // 4 * 2^96
    tickCumulativesSecond = 27727 * 900;
  }

  /// token1ToToken1Price = 1/4
  function setPriceQuoteLowerThanBase() external {
    token1ToToken0SqrtPriceX96 = 39614081257132168796771975168; // 0.5 * 2^96
    tickCumulativesSecond = -13863 * 900;
  }

  /// @notice The contract that deployed the pool, which must adhere to the IUniswapV3Factory interface
  /// @return The contract address
  function factory() external pure returns (address) {
    return address(0);
  }

  /// @notice The pool's fee in hundredths of a bip, i.e. 1e-6
  /// @return The fee
  function fee() external pure returns (uint24) {
    return 3000;
  }

  /// @notice The pool tick spacing
  /// @dev Ticks can only be used at multiples of this value, minimum of 1 and always positive
  /// e.g.: a tickSpacing of 3 means ticks can be initialized every 3rd tick, i.e., ..., -6, -3, 0, 3, 6, ...
  /// This value is an int24 to avoid casting even though it is always positive.
  /// @return The tick spacing
  function tickSpacing() external pure returns (int24) {
    return 0;
  }

  /// @notice The maximum amount of position liquidity that can use any tick in the range
  /// @dev This parameter is enforced per tick to prevent liquidity from overflowing a uint128 at any point, and
  /// also prevents out-of-range liquidity from being used to prevent adding in-range liquidity to a pool
  /// @return The max amount of liquidity per tick
  function maxLiquidityPerTick() external pure returns (uint128) {
    return 0;
  }

  /// @notice The 0th storage slot in the pool stores many values, and is exposed as a single method to save gas
  /// when accessed externally.
  /// @return sqrtPriceX96 The current price of the pool as a sqrt(token1/token0) Q64.96 value
  /// tick The current tick of the pool, i.e. according to the last tick transition that was run.
  /// This value may not always be equal to SqrtTickMath.getTickAtSqrtRatio(sqrtPriceX96) if the price is on a tick
  /// boundary.
  /// observationIndex The index of the last oracle observation that was written,
  /// observationCardinality The current maximum number of observations stored in the pool,
  /// observationCardinalityNext The next maximum number of observations, to be updated when the observation.
  /// feeProtocol The protocol fee for both tokens of the pool.
  /// Encoded as two 4 bit values, where the protocol fee of token1 is shifted 4 bits and the protocol fee of token0
  /// is the lower 4 bits. Used as the denominator of a fraction of the swap fee, e.g. 4 means 1/4th of the swap fee.
  /// unlocked Whether the pool is currently locked to reentrancy
  function slot0()
    external
    view
    returns (
      uint160 sqrtPriceX96,
      int24 tick,
      uint16 observationIndex,
      uint16 observationCardinality,
      uint16 observationCardinalityNext,
      uint8 feeProtocol,
      bool unlocked
    )
  {
    sqrtPriceX96 = token1ToToken0SqrtPriceX96;
    tick = 0;
    observationIndex = 0;
    observationCardinality = 0;
    observationCardinalityNext = 0;
    feeProtocol = 0;
    unlocked = false;
  }

  /// @notice The fee growth as a Q128.128 fees of token0 collected per unit of liquidity for the entire life of the pool
  /// @dev This value can overflow the uint256
  function feeGrowthGlobal0X128() external pure returns (uint256) {
    return 0;
  }

  /// @notice The fee growth as a Q128.128 fees of token1 collected per unit of liquidity for the entire life of the pool
  /// @dev This value can overflow the uint256
  function feeGrowthGlobal1X128() external pure returns (uint256) {
    return 0;
  }

  /// @notice The amounts of token0 and token1 that are owed to the protocol
  /// @dev Protocol fees will never exceed uint128 max in either token
  function protocolFees() external pure returns (uint128 token0_amount, uint128 token1_amount) {
    token0_amount = 0;
    token1_amount = 0;
  }

  /// @notice The currently in range liquidity available to the pool
  /// @dev This value has no relationship to the total liquidity across all ticks
  function liquidity() external pure returns (uint128) {
    return 0;
  }

  /// @notice Look up information about a specific tick in the pool
  /// @param /*tick*/ The tick to look up
  /// @return liquidityGross the total amount of position liquidity that uses the pool either as tick lower or
  /// tick upper,
  /// liquidityNet how much liquidity changes when the pool price crosses the tick,
  /// feeGrowthOutside0X128 the fee growth on the other side of the tick from the current tick in token0,
  /// feeGrowthOutside1X128 the fee growth on the other side of the tick from the current tick in token1,
  /// tickCumulativeOutside the cumulative tick value on the other side of the tick from the current tick
  /// secondsPerLiquidityOutsideX128 the seconds spent per liquidity on the other side of the tick from the current tick,
  /// secondsOutside the seconds spent on the other side of the tick from the current tick,
  /// initialized Set to true if the tick is initialized, i.e. liquidityGross is greater than 0, otherwise equal to false.
  /// Outside values can only be used if the tick is initialized, i.e. if liquidityGross is greater than 0.
  /// In addition, these values are only relative and must be used only in comparison to previous snapshots for
  /// a specific position.
  function ticks(
    int24 /*tick*/
  )
    external
    pure
    returns (
      uint128 liquidityGross,
      int128 liquidityNet,
      uint256 feeGrowthOutside0X128,
      uint256 feeGrowthOutside1X128,
      int56 tickCumulativeOutside,
      uint160 secondsPerLiquidityOutsideX128,
      uint32 secondsOutside,
      bool initialized
    )
  {
    liquidityGross = 0;
    liquidityNet = 0;
    feeGrowthOutside0X128 = 0;
    feeGrowthOutside1X128 = 0;
    tickCumulativeOutside = 0;
    secondsPerLiquidityOutsideX128 = 0;
    secondsOutside = 0;
    initialized = false;
  }

  /// @notice Returns the information about a position by the position's key
  /// @param /*key*/ The position's key is a hash of a preimage composed by the owner, tickLower and tickUpper
  /// @return _liquidity The amount of liquidity in the position,
  /// Returns feeGrowthInside0LastX128 fee growth of token0 inside the tick range as of the last mint/burn/poke,
  /// Returns feeGrowthInside1LastX128 fee growth of token1 inside the tick range as of the last mint/burn/poke,
  /// Returns tokensOwed0 the computed amount of token0 owed to the position as of the last mint/burn/poke,
  /// Returns tokensOwed1 the computed amount of token1 owed to the position as of the last mint/burn/poke
  function positions(
    bytes32 /*key*/
  )
    external
    pure
    returns (
      uint128 _liquidity,
      uint256 feeGrowthInside0LastX128,
      uint256 feeGrowthInside1LastX128,
      uint128 tokensOwed0,
      uint128 tokensOwed1
    )
  {
    _liquidity = 0;
    feeGrowthInside0LastX128 = 0;
    feeGrowthInside1LastX128 = 0;
    tokensOwed0 = 0;
    tokensOwed1 = 0;
  }

  /// @notice Returns data about a specific observation index
  /// @param /*index*/ The element of the observations array to fetch
  /// @dev You most likely want to use #observe() instead of this method to get an observation as of some amount of time
  /// ago, rather than at a specific index in the array.
  /// @return blockTimestamp The timestamp of the observation,
  /// Returns tickCumulative the tick multiplied by seconds elapsed for the life of the pool as of the observation timestamp,
  /// Returns secondsPerLiquidityCumulativeX128 the seconds per in range liquidity for the life of the pool as of the observation timestamp,
  /// Returns initialized whether the observation has been initialized and the values are safe to use
  function observations(
    uint256 /*index*/
  )
    external
    pure
    returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)
  {
    blockTimestamp = 0;
    tickCumulative = 0;
    secondsPerLiquidityCumulativeX128 = 0;
    initialized = false;
  }

  /// @notice Returns the cumulative tick and liquidity as of each timestamp `secondsAgo` from the current block timestamp
  /// @dev To get a time weighted average tick or liquidity-in-range, you must call this with two values, one representing
  /// the beginning of the period and another for the end of the period. E.g., to get the last hour time-weighted average tick,
  /// you must call it with secondsAgos = [3600, 0].
  /// @dev The time weighted average tick represents the geometric time weighted average price of the pool, in
  /// log base sqrt(1.0001) of token1 / token0. The TickMath library can be used to go from a tick value to a ratio.
  /// @param /*secondsAgos*/ From how long ago each cumulative tick and liquidity value should be returned
  /// @return tickCumulatives Cumulative tick values as of each `secondsAgos` from the current block timestamp
  /// @return secondsPerLiquidityCumulativeX128s Cumulative seconds per liquidity-in-range value as of each `secondsAgos` from the current block
  /// timestamp
  function observe(
    uint32[] calldata /*secondsAgos*/
  ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) {
    tickCumulatives = new int56[](2);
    // 1.0001 ^ ((tickCumulatives[0] - tickCumulatives[1]) / secsAgo) = 1/ (TOKEN1_TO_TOKEN0_SQRT_PRICE ^ 2)
    // 1.0001 ^ (-13863.6) = 0.25
    tickCumulatives[0] = 0;
    tickCumulatives[1] = tickCumulativesSecond;
    secondsPerLiquidityCumulativeX128s = new uint160[](2);
  }

  function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external {
    uint256 fee0 = Math.mulDiv(amount0, this.fee(), 1e6, Math.Rounding.Ceil);
    uint256 fee1 = Math.mulDiv(amount1, this.fee(), 1e6, Math.Rounding.Ceil);

    uint256 balance0Before = IERC20(token0).balanceOf(address(this));
    uint256 balance1Before = IERC20(token1).balanceOf(address(this));

    if (amount0 > 0) TransferHelper.safeTransfer(token0, recipient, amount0);
    if (amount1 > 0) TransferHelper.safeTransfer(token1, recipient, amount1);

    IAlgebraFlashCallback(msg.sender).algebraFlashCallback(fee0, fee1, data);

    uint256 balance0After = IERC20(token0).balanceOf(address(this));
    uint256 balance1After = IERC20(token1).balanceOf(address(this));

    require(balance0Before + fee0 <= balance0After, 'F0');
    require(balance1Before + fee1 <= balance1After, 'F1');

    // sub is safe because we know balanceAfter is gt balanceBefore by at least fee
    uint256 paid0 = balance0After - balance0Before;
    uint256 paid1 = balance1After - balance1Before;

    emit Flash(msg.sender, recipient, amount0, amount1, paid0, paid1);
  }

  function getTimepoints(
    uint32[] calldata secondsAgos
  )
    external
    view
    returns (
      int56[] memory tickCumulatives,
      uint160[] memory secondsPerLiquidityCumulatives,
      uint112[] memory volatilityCumulatives,
      uint256[] memory volumePerAvgLiquiditys
    )
  {
    tickCumulatives = new int56[](2);
    tickCumulatives[0] = 0;
    tickCumulatives[1] = tickCumulativesSecond * int56(uint56(secondsAgos[0] - secondsAgos[1]));

    secondsPerLiquidityCumulatives = new uint160[](2);
    volatilityCumulatives = new uint112[](2);
    volumePerAvgLiquiditys = new uint256[](2);
  }
}
