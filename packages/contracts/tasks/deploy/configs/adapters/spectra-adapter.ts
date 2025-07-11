import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface ISpectraAdapterPairSettings {
  ptToken: IErc20Config;
  quoteToken: IErc20Config;
  spectraPool: string;
}

export interface ISpectraAdapterDeployConfig extends IConfigBase {
  dexId: number;
  settings?: ISpectraAdapterPairSettings[];
}

export class SpectraAdapterDeployConfig implements ISpectraAdapterDeployConfig {
  public readonly dexId: number;
  public readonly settings: ISpectraAdapterPairSettings[];

  constructor(jsonParsed: ISpectraAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        ptToken: new Erc20Config(settings.ptToken),
        quoteToken: new Erc20Config(settings.quoteToken),
        spectraPool: settings.spectraPool,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    if (this.dexId === undefined) {
      throw new Error('Undefined dexId');
    }

    for (const [_, settings] of this.settings.entries()) {
      validateAddress(settings.spectraPool);
      await Promise.all([settings.ptToken.validate(provider), settings.quoteToken.validate(provider)]);
    }
  }
}
