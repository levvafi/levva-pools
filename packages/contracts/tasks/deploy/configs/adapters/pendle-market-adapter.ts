import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { validateAddress } from '../../base/utils';
import { Erc20Config, IErc20Config } from '../erc20-config';

export interface IPendleMarketAdapterPairSettings {
  ptToken: IErc20Config;
  ibToken: IErc20Config;
  market: string;
  slippage: number;
}

export interface IPendleMarketAdapterDeployConfig extends IConfigBase {
  dexId: number;
  settings?: IPendleMarketAdapterPairSettings[];
}

export class PendleMarketAdapterDeployConfig implements IPendleMarketAdapterDeployConfig {
  public readonly dexId: number;
  public readonly settings: IPendleMarketAdapterPairSettings[];

  constructor(jsonParsed: IPendleMarketAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        ptToken: new Erc20Config(settings.ptToken),
        ibToken: new Erc20Config(settings.ibToken),
        market: settings.market,
        slippage: settings.slippage,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    if (this.dexId === undefined) {
      throw new Error('Undefined dexId');
    }

    for (const [_, settings] of this.settings.entries()) {
      // TODO: validate slippage
      validateAddress(settings.market);
      await Promise.all([settings.ptToken.validate(provider), settings.ibToken.validate(provider)]);
    }
  }
}
