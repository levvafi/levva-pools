import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { validateAddress } from '../../base/utils';
import { Erc20Config, IErc20Config } from '../erc20-config';

export interface IPendleCurveAdapterPairSettings {
  ibToken: IErc20Config;
  quoteToken: IErc20Config;
  curvePool: string;
  pendleMarket: string;
  slippage: number;
  curveSlippage: number;
}

export interface IPendleCurveAdapterDeployConfig extends IConfigBase {
  dexId: number;
  settings?: IPendleCurveAdapterPairSettings[];
}

export class PendleCurveAdapterDeployConfig implements IPendleCurveAdapterDeployConfig {
  public readonly dexId: number;
  public readonly settings: IPendleCurveAdapterPairSettings[];

  constructor(jsonParsed: IPendleCurveAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        ibToken: new Erc20Config(settings.ibToken),
        quoteToken: new Erc20Config(settings.quoteToken),
        curvePool: settings.curvePool,
        pendleMarket: settings.pendleMarket,
        slippage: settings.slippage,
        curveSlippage: settings.curveSlippage,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    if (this.dexId === undefined) {
      throw new Error('Undefined dexId');
    }

    for (const [_, settings] of this.settings.entries()) {
      // TODO: validate slippages
      validateAddress(settings.curvePool);
      validateAddress(settings.pendleMarket);
      await Promise.all([settings.ibToken.validate(provider), settings.quoteToken.validate(provider)]);
    }
  }
}
