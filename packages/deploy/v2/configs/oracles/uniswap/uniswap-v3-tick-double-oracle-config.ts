import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../../erc20-config';
import { validateAddress } from '../../../base/utils';

export interface IUniswapV3TickDoubleOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  intermediateToken: IErc20Config;
  secondsAgo: number;
  secondsAgoLiquidation: number;
  baseTokenPairFee: number;
  quoteTokenPairFee: number;
}

export interface IUniswapV3TickDoubleOracleDeployConfig {
  factoryAddress: string;
  settings: IUniswapV3TickDoubleOraclePairSettings[];
}

export class UniswapV3TickDoubleOracleDeployConfig implements IUniswapV3TickDoubleOracleDeployConfig {
  public readonly factoryAddress: string;
  public readonly settings: IUniswapV3TickDoubleOraclePairSettings[];

  private readonly UNISWAP_FEES = new Set<number>([100, 500, 3000, 10_000]);

  constructor(jsonParsed: IUniswapV3TickDoubleOracleDeployConfig) {
    this.factoryAddress = jsonParsed.factoryAddress;
    this.settings = [];
    jsonParsed.settings.forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        intermediateToken: new Erc20Config(settings.intermediateToken),
        secondsAgo: settings.secondsAgo,
        secondsAgoLiquidation: settings.secondsAgoLiquidation,
        baseTokenPairFee: settings.baseTokenPairFee,
        quoteTokenPairFee: settings.quoteTokenPairFee,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.factoryAddress);

    for (const [index, settings] of this.settings.entries()) {
      if (!this.UNISWAP_FEES.has(settings.baseTokenPairFee)) {
        throw new Error(
          `Wrong IUniswapV3TickDoubleOraclePairSettings.basTokenPairFee value ${settings.baseTokenPairFee} (index ${index})`
        );
      }

      if (!this.UNISWAP_FEES.has(settings.quoteTokenPairFee)) {
        throw new Error(
          `Wrong IUniswapV3TickDoubleOraclePairSettings.quoteTokenPairFee value ${settings.quoteTokenPairFee} (index ${index})`
        );
      }

      if (settings.secondsAgo == 0) {
        throw new Error(`IUniswapV3TickDoubleOraclePairSettings.secondsAgo can't be zero (index ${index})`);
      }

      if (settings.secondsAgoLiquidation == 0) {
        throw new Error(`IUniswapV3TickDoubleOraclePairSettings.secondsAgoLiquidation can't be zero (index ${index})`);
      }

      await Promise.all([
        settings.quoteToken.validate(provider),
        settings.baseToken.validate(provider),
        settings.intermediateToken.validate(provider),
      ]);
    }
  }
}
