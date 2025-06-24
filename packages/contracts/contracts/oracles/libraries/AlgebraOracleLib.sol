// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import '@cryptoalgebra/v1.9-core/contracts/interfaces/pool/IAlgebraPoolDerivedState.sol';

/// @title Oracle library
/// @notice Provides functions to integrate with V3 pool oracle
library AlgebraOracleLib {
  error ZeroSeconds();

  /// @dev Based on DataStorageLibrary.consult() from Algebra V1.9 https://github.com/cryptoalgebra/AlgebraV1.9/blob/main/src/periphery/contracts/libraries/DataStorageLibrary.sol
  function getArithmeticMeanTick(address pool, uint32 period) internal view returns (int24 arithmeticMeanTick) {
    if (period == 0) revert ZeroSeconds();

    uint32[] memory secondsAgos = new uint32[](2);
    secondsAgos[0] = period;
    secondsAgos[1] = 0;

    (int56[] memory tickCumulatives, , , ) = IAlgebraPoolDerivedState(pool).getTimepoints(secondsAgos);
    int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];

    arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(period)));
    // Always round to negative infinity
    if (tickCumulativesDelta < 0 && (tickCumulativesDelta % int56(uint56(period)) != 0)) arithmeticMeanTick--;
  }
}
