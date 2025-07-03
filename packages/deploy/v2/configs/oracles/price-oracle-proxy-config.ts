import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IPriceOracleProxyPairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  underlyingQuoteToken: IErc20Config;
  underlyingBaseToken: IErc20Config;
  priceOracleAddress: string;
}

export interface IPriceOracleProxyDeployConfig {
  settings: IPriceOracleProxyPairSettings[];
}

export class PriceOracleProxyDeployConfig implements IPriceOracleProxyDeployConfig {
  public readonly settings: IPriceOracleProxyPairSettings[];

  constructor(jsonParsed: IPriceOracleProxyDeployConfig) {
    this.settings = [];
    jsonParsed.settings.forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        underlyingQuoteToken: new Erc20Config(settings.underlyingQuoteToken),
        underlyingBaseToken: new Erc20Config(settings.underlyingBaseToken),
        priceOracleAddress: settings.priceOracleAddress,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    for (const [_, settings] of this.settings.entries()) {
      validateAddress(settings.priceOracleAddress);

      await Promise.all([
        settings.quoteToken.validate(provider),
        settings.baseToken.validate(provider),
        settings.underlyingQuoteToken.validate(provider),
        settings.underlyingBaseToken.validate(provider),
      ]);
    }
  }
}
