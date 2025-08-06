import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IMarginlyCompositeOraclePairSettings {
  quoteToken: IErc20Config;
  intermediateToken: IErc20Config;
  baseToken: IErc20Config;
  quoteIntermediateOracleAddress: string;
  intermediateBaseOracleAddress: string;
}

export interface IMarginlyCompositeOracleDeployConfig {
  settings?: IMarginlyCompositeOraclePairSettings[];
}

export class MarginlyCompositeOracleDeployConfig implements IMarginlyCompositeOracleDeployConfig {
  public readonly settings: IMarginlyCompositeOraclePairSettings[];

  constructor(jsonParsed: IMarginlyCompositeOracleDeployConfig) {
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        intermediateToken: new Erc20Config(settings.intermediateToken),
        baseToken: new Erc20Config(settings.baseToken),
        quoteIntermediateOracleAddress: settings.quoteIntermediateOracleAddress,
        intermediateBaseOracleAddress: settings.intermediateBaseOracleAddress,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    for (const [_, settings] of this.settings.entries()) {
      validateAddress(settings.quoteIntermediateOracleAddress);
      validateAddress(settings.intermediateBaseOracleAddress);

      await Promise.all([
        settings.quoteToken.validate(provider),
        settings.intermediateToken.validate(provider),
        settings.baseToken.validate(provider),
      ]);
    }
  }
}
