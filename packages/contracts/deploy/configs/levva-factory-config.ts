import { Provider } from 'ethers';
import { IConfigBase } from '../base/base-config';
import { validateAddress } from '../base/utils';
import { Erc20Config, IErc20Config } from './erc20-config';

export enum PoolType {
  Trading,
  Farming,
}

export interface ILevvaFactoryConfig extends IConfigBase {
  poolType: PoolType | string;
  marginlyPoolImplementationAddress: string | undefined;
  swapRouterAddress: string | undefined;
  feeHolderAddress: string;
  techPositionOwnerAddress: string;
  WETH9: IErc20Config;
}

export class LevvaFactoryConfig implements ILevvaFactoryConfig {
  public readonly poolType: PoolType;
  public readonly marginlyPoolImplementationAddress: string | undefined;
  public readonly swapRouterAddress: string | undefined;
  public readonly feeHolderAddress: string;
  public readonly techPositionOwnerAddress: string;
  public readonly WETH9: Erc20Config;

  constructor(jsonParsed: ILevvaFactoryConfig) {
    this.poolType = PoolType[jsonParsed.poolType as keyof typeof PoolType];
    this.marginlyPoolImplementationAddress = jsonParsed.marginlyPoolImplementationAddress;
    this.swapRouterAddress = jsonParsed.swapRouterAddress;
    this.feeHolderAddress = jsonParsed.feeHolderAddress;
    this.techPositionOwnerAddress = jsonParsed.techPositionOwnerAddress;
    this.WETH9 = new Erc20Config(jsonParsed.WETH9);
  }

  async validate(provider: Provider): Promise<void> {
    if (this.marginlyPoolImplementationAddress !== undefined) {
      validateAddress(this.marginlyPoolImplementationAddress);
    }

    if (this.swapRouterAddress !== undefined) {
      validateAddress(this.swapRouterAddress);
    }

    validateAddress(this.feeHolderAddress);
    validateAddress(this.techPositionOwnerAddress);

    await this.WETH9.validate(provider);
  }
}
