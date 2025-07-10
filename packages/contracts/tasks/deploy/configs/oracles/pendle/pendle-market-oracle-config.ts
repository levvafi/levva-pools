import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../../erc20-config';
import { validateAddress } from '../../../base/utils';

export interface IPendleMarketOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  pendleMarketAddress: string;
  secondsAgo: number;
  secondsAgoLiquidation: number;
}

export interface IPendleMarketOracleDeployConfig {
  pendlePtLpOracleAddress: string;
  settings?: IPendleMarketOraclePairSettings[];
}

export class PendleMarketOracleDeployConfig implements IPendleMarketOracleDeployConfig {
  public readonly pendlePtLpOracleAddress: string;
  public readonly settings: IPendleMarketOraclePairSettings[];

  constructor(jsonParsed: IPendleMarketOracleDeployConfig) {
    this.pendlePtLpOracleAddress = jsonParsed.pendlePtLpOracleAddress;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        pendleMarketAddress: settings.pendleMarketAddress,
        secondsAgo: settings.secondsAgo,
        secondsAgoLiquidation: settings.secondsAgoLiquidation,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.pendlePtLpOracleAddress);
    for (const [index, settings] of this.settings.entries()) {
      validateAddress(settings.pendleMarketAddress);

      if (settings.secondsAgo == 0) {
        throw new Error(`IPendleMarketOraclePairSettings.secondsAgo can't be zero (index ${index})`);
      }

      if (settings.secondsAgoLiquidation == 0) {
        throw new Error(`IPendleMarketOraclePairSettings.secondsAgoLiquidation can't be zero (index ${index})`);
      }

      await Promise.all([settings.quoteToken.validate(provider), settings.baseToken.validate(provider)]);
    }
  }
}
