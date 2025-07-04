import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IGeneralAdapterPairSettings {
  tokenA: IErc20Config;
  tokenB: IErc20Config;
  poolAddress: string;
}

export interface IGeneralAdapterDeployConfig extends IConfigBase {
  dexId: number;
  settings?: IGeneralAdapterPairSettings[];
}

export class GeneralAdapterDeployConfig implements IGeneralAdapterDeployConfig {
  public readonly dexId: number;
  public readonly settings: IGeneralAdapterPairSettings[];

  constructor(jsonParsed: IGeneralAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        tokenA: new Erc20Config(settings.tokenA),
        tokenB: new Erc20Config(settings.tokenB),
        poolAddress: settings.poolAddress,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    if (this.dexId === undefined) {
      throw new Error('Undefined dexId');
    }

    for (const [_, settings] of this.settings.entries()) {
      validateAddress(settings.poolAddress);
      await Promise.all([settings.tokenA.validate(provider), settings.tokenB.validate(provider)]);
    }
  }
}
