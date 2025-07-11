import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { validateAddress } from '../../base/utils';
import { Erc20Config, IErc20Config } from '../erc20-config';

export interface IPendlePtToAssetAdapterPairSettings {
  ptToken: IErc20Config;
  asset: IErc20Config;
  market: string;
  slippage: number;
}

export interface IPendlePtToAssetAdapterDeployConfig extends IConfigBase {
  dexId: number;
  settings?: IPendlePtToAssetAdapterPairSettings[];
}

export class PendlePtToAssetAdapterDeployConfig implements IPendlePtToAssetAdapterDeployConfig {
  public readonly dexId: number;
  public readonly settings: IPendlePtToAssetAdapterPairSettings[];

  constructor(jsonParsed: IPendlePtToAssetAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        ptToken: new Erc20Config(settings.ptToken),
        asset: new Erc20Config(settings.asset),
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
      await Promise.all([settings.ptToken.validate(provider), settings.asset.validate(provider)]);
    }
  }
}
