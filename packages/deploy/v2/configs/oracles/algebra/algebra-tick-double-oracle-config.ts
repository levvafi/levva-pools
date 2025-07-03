import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../../erc20-config';
import { validateAddress } from '../../../base/utils';

export interface IAlgebraTickDoubleOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  intermediateToken: IErc20Config;
  secondsAgo: number;
  secondsAgoLiquidation: number;
}

export interface IAlgebraTickDoubleOracleDeployConfig {
  factoryAddress: string;
  settings: IAlgebraTickDoubleOraclePairSettings[];
}

export class AlgebraTickDoubleOracleDeployConfig implements IAlgebraTickDoubleOracleDeployConfig {
  public readonly factoryAddress: string;
  public readonly settings: IAlgebraTickDoubleOraclePairSettings[];

  constructor(jsonParsed: IAlgebraTickDoubleOracleDeployConfig) {
    this.factoryAddress = jsonParsed.factoryAddress;
    this.settings = [];
    jsonParsed.settings.forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        intermediateToken: new Erc20Config(settings.intermediateToken),
        secondsAgo: settings.secondsAgo,
        secondsAgoLiquidation: settings.secondsAgoLiquidation,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.factoryAddress);

    for (const [index, settings] of this.settings.entries()) {
      if (settings.secondsAgo == 0) {
        throw new Error(`IAlgebraTickDoubleOraclePairSettings.secondsAgo can't be zero (index ${index})`);
      }

      if (settings.secondsAgoLiquidation == 0) {
        throw new Error(`IAlgebraTickDoubleOraclePairSettings.secondsAgoLiquidation can't be zero (index ${index})`);
      }

      await Promise.all([
        settings.quoteToken.validate(provider),
        settings.baseToken.validate(provider),
        settings.intermediateToken.validate(provider),
      ]);
    }
  }
}
