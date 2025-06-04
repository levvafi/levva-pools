// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IAToken} from "@aave/core-v3/contracts/interfaces/IAToken.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {WadRayMath} from "@aave/core-v3/contracts/protocol/libraries/math/WadRayMath.sol";

import {IPriceOracle} from "@marginly/contracts/contracts/interfaces/IPriceOracle.sol";

contract AavePriceOracle is IPriceOracle, Ownable2Step {
    uint256 private constant X96ONE = 79228162514264337593543950336;

    address private immutable i_poolAddressProvider;

    struct OracleParams {
        bool initialized;
        bool isInverse;
    }

    mapping(address quoteToken => mapping(address baseToken => OracleParams)) private s_params;

    error AaveATokenPriceOracle__ZeroAddress();
    error AaveATokenPriceOracle__WrongInput();
    error AaveATokenPriceOracle__NotInitialized();

    constructor(address _poolAddressProvider) {
        if (_poolAddressProvider == address(0)) revert AaveATokenPriceOracle__ZeroAddress();

        i_poolAddressProvider = _poolAddressProvider;
    }

    function setPair(address quoteToken, address aToken) external onlyOwner {
        if (quoteToken == address(0) || aToken == address(0)) revert AaveATokenPriceOracle__ZeroAddress();

        address aavePool = IPoolAddressesProvider(i_poolAddressProvider).getPool();
        if (aToken != IPool(aavePool).getReserveData(quoteToken).aTokenAddress) {
            revert AaveATokenPriceOracle__WrongInput();
        }

        s_params[quoteToken][aToken] = OracleParams({initialized: true, isInverse: false});
        s_params[aToken][quoteToken] = OracleParams({initialized: true, isInverse: true});
    }

    function getBalancePrice(address quoteToken, address baseToken) external view returns (uint256) {
        return _getPriceX96(quoteToken, baseToken);
    }

    /// @notice Returns margin call price as X96 value
    function getMargincallPrice(address quoteToken, address baseToken) external view returns (uint256) {
        return _getPriceX96(quoteToken, baseToken);
    }

    function getPoolAddressProvider() external view returns (address) {
        return i_poolAddressProvider;
    }

    function getParams(address quoteToken, address baseToken) public view returns (OracleParams memory) {
        return s_params[quoteToken][baseToken];
    }

    function _getPriceX96(address quoteToken, address baseToken) private view returns (uint256) {
        OracleParams memory params = _getParamsSafe(quoteToken, baseToken);

        address underlyingAsset = params.isInverse ? baseToken : quoteToken;
        address aavePool = IPoolAddressesProvider(i_poolAddressProvider).getPool();
        uint256 reserveNormalizedIncome = IPool(aavePool).getReserveNormalizedIncome(underlyingAsset);

        // convert from ray to X96
        return params.isInverse
            ? WadRayMath.rayDiv(X96ONE, reserveNormalizedIncome)
            : WadRayMath.rayMul(X96ONE, reserveNormalizedIncome);
    }

    function _getParamsSafe(address quoteToken, address baseToken) private view returns (OracleParams memory) {
        OracleParams memory params = getParams(quoteToken, baseToken);
        if (!params.initialized) revert AaveATokenPriceOracle__NotInitialized();
        return params;
    }
}
