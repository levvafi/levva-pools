import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { validateAddress } from '../../base/utils';
import { Erc20Config, IErc20Config } from '../erc20-config';

export interface IPendleMarketAdapterPairSettings {
  tokenA: IErc20Config;
  tokenB: IErc20Config;
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
        tokenA: new Erc20Config(settings.tokenA),
        tokenB: new Erc20Config(settings.tokenB),
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
      await Promise.all([settings.tokenA.validate(provider), settings.tokenB.validate(provider)]);
    }
  }
}
