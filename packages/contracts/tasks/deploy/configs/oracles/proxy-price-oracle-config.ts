import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IProxyPriceOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  underlyingQuoteToken: IErc20Config;
  underlyingBaseToken: IErc20Config;
  priceOracleAddress: string;
}

export interface IProxyPriceOracleDeployConfig {
  settings?: IProxyPriceOraclePairSettings[];
}

export class ProxyPriceOracleDeployConfig implements IProxyPriceOracleDeployConfig {
  public readonly settings: IProxyPriceOraclePairSettings[];

  constructor(jsonParsed: IProxyPriceOracleDeployConfig) {
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
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
