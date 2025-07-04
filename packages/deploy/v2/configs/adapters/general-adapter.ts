import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IGeneralAdapterPairSettings {
  token0: IErc20Config;
  token1: IErc20Config;
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
        token0: new Erc20Config(settings.token0),
        token1: new Erc20Config(settings.token1),
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
      await Promise.all([settings.token0.validate(provider), settings.token1.validate(provider)]);
    }
  }
}
