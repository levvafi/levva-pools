import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IAavePriceOraclePairSettings {
  quoteToken: IErc20Config;
  aToken: IErc20Config;
}

export interface IAavePriceOracleDeployConfig {
  aavePoolProviderAddress: string;
  settings?: IAavePriceOraclePairSettings[];
}

export class AavePriceOracleDeployConfig implements IAavePriceOracleDeployConfig {
  public readonly aavePoolProviderAddress: string;
  public readonly settings: IAavePriceOraclePairSettings[];

  constructor(jsonParsed: IAavePriceOracleDeployConfig) {
    this.aavePoolProviderAddress = jsonParsed.aavePoolProviderAddress;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        aToken: new Erc20Config(settings.aToken),
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.aavePoolProviderAddress);

    for (const [_, settings] of this.settings.entries()) {
      await Promise.all([settings.quoteToken.validate(provider), settings.aToken.validate(provider)]);
    }
  }
}
