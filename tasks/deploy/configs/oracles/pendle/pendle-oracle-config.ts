import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../../erc20-config';
import { validateAddress } from '../../../base/utils';

export interface IPendleOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  ibToken: IErc20Config;
  secondaryPoolOracleAddress: string;
  pendleMarketAddress: string;
  secondsAgo: number;
  secondsAgoLiquidation: number;
}

export interface IPendleOracleDeployConfig {
  pendlePtLpOracleAddress: string;
  settings?: IPendleOraclePairSettings[];
}

export class PendleOracleDeployConfig implements IPendleOracleDeployConfig {
  public readonly pendlePtLpOracleAddress: string;
  public readonly settings: IPendleOraclePairSettings[];

  constructor(jsonParsed: IPendleOracleDeployConfig) {
    this.pendlePtLpOracleAddress = jsonParsed.pendlePtLpOracleAddress;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        ibToken: new Erc20Config(settings.ibToken),
        secondaryPoolOracleAddress: settings.secondaryPoolOracleAddress,
        pendleMarketAddress: settings.pendleMarketAddress,
        secondsAgo: settings.secondsAgo,
        secondsAgoLiquidation: settings.secondsAgoLiquidation,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    for (const [index, settings] of this.settings.entries()) {
      validateAddress(settings.pendleMarketAddress);
      validateAddress(settings.secondaryPoolOracleAddress);

      if (settings.secondsAgo == 0) {
        throw new Error(`IPendleOraclePairSettings.secondsAgo can't be zero (index ${index})`);
      }

      if (settings.secondsAgoLiquidation == 0) {
        throw new Error(`IPendleOraclePairSettings.secondsAgoLiquidation can't be zero (index ${index})`);
      }

      await Promise.all([
        settings.quoteToken.validate(provider),
        settings.baseToken.validate(provider),
        settings.ibToken.validate(provider),
      ]);
    }
  }
}
