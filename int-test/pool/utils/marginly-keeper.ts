import { AbiCoder, Addressable } from 'ethers';

export function encodeLiquidationParams(
  asset: string | Addressable,
  amount: bigint,
  marginlyPool: string | Addressable,
  positionToLiquidate: string | Addressable,
  liquidator: string | Addressable,
  uniswapPool: string | Addressable,
  minProfit: bigint,
  swapCallData: bigint
): string {
  /**
       *  address asset;
        uint256 amount;
        address marginlyPool;
        address positionToLiquidate;
        address liquidator;
        address uniswapPool;
        uint256 minProfit;
        uint256 swapCallData;
       */

  return AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'address', 'address', 'address', 'address', 'uint256', 'uint256'],
    [asset, amount, marginlyPool, positionToLiquidate, liquidator, uniswapPool, minProfit, swapCallData]
  );
}
export function encodeLiquidationParamsAave(
  marginlyPool: string | Addressable,
  positionToLiquidate: string | Addressable,
  liquidator: string | Addressable,
  minProfit: bigint,
  swapCallData: bigint
): string {
  /**
    address marginlyPool;
    address positionToLiquidate;
    address liquidator;
    uint256 minProfit;
    uint256 swapCallData;
   */

  return AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'address', 'uint256', 'uint256'],
    [marginlyPool, positionToLiquidate, liquidator, minProfit, swapCallData]
  );
}

export function encodeLiquidationParamsBalancer(
  marginlyPool: string | Addressable,
  positionToLiquidate: string | Addressable,
  liquidator: string | Addressable,
  minProfit: bigint,
  swapCallData: bigint
): string {
  /**
 *  
  address marginlyPool;
  address positionToLiquidate;
  address liquidator;
  uint256 minProfit;
  uint256 swapCallData;
 */

  return AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'address', 'uint256', 'uint256'],
    [marginlyPool, positionToLiquidate, liquidator, minProfit, swapCallData]
  );
}
