import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../../erc20-config';
import { validateAddress } from '../../../base/utils';

export interface IAlgebraTickOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  secondsAgo: number;
  secondsAgoLiquidation: number;
}

export interface IAlgebraTickOracleDeployConfig {
  factoryAddress: string;
  settings: IAlgebraTickOraclePairSettings[];
}

export class AlgebraTickOracleDeployConfig implements IAlgebraTickOracleDeployConfig {
  public readonly factoryAddress: string;
  public readonly settings: IAlgebraTickOraclePairSettings[];

  constructor(jsonParsed: IAlgebraTickOracleDeployConfig) {
    this.factoryAddress = jsonParsed.factoryAddress;
    this.settings = [];
    jsonParsed.settings.forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        secondsAgo: settings.secondsAgo,
        secondsAgoLiquidation: settings.secondsAgoLiquidation,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.factoryAddress);

    for (const [index, settings] of this.settings.entries()) {
      if (settings.secondsAgo == 0) {
        throw new Error(`IAlgebraTickOraclePairSettings.secondsAgo can't be zero (index ${index})`);
      }

      if (settings.secondsAgoLiquidation == 0) {
        throw new Error(`IAlgebraTickOraclePairSettings.secondsAgoLiquidation can't be zero (index ${index})`);
      }

      await Promise.all([settings.quoteToken.validate(provider), settings.baseToken.validate(provider)]);
    }
  }
}
