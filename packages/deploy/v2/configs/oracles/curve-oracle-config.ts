import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface ICurveOraclePairSettings {
  poolAddress: string;
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
}

export interface ICurveOracleDeployConfig {
  settings: ICurveOraclePairSettings[];
}

export class CurveOracleDeployConfig implements ICurveOracleDeployConfig {
  public readonly settings: ICurveOraclePairSettings[];

  constructor(jsonParsed: ICurveOracleDeployConfig) {
    this.settings = [];
    jsonParsed.settings.forEach((settings) => {
      this.settings.push({
        poolAddress: settings.poolAddress,
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    for (const [_, settings] of this.settings.entries()) {
      validateAddress(settings.poolAddress);

      await Promise.all([settings.quoteToken.validate(provider), settings.baseToken.validate(provider)]);
    }
  }
}
