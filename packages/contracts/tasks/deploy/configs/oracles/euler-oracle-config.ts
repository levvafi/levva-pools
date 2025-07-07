import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../erc20-config';
import { validateAddress } from '../../base/utils';

export interface IEulerOraclePairSettings {
  eulerOracleAddress: string;
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
}

export interface IEulerOracleDeployConfig {
  settings?: IEulerOraclePairSettings[];
}

export class EulerOracleDeployConfig implements IEulerOracleDeployConfig {
  public readonly settings: IEulerOraclePairSettings[];

  constructor(jsonParsed: IEulerOracleDeployConfig) {
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        eulerOracleAddress: settings.eulerOracleAddress,
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    for (const [_, settings] of this.settings.entries()) {
      validateAddress(settings.eulerOracleAddress);

      await Promise.all([settings.quoteToken.validate(provider), settings.baseToken.validate(provider)]);
    }
  }
}
