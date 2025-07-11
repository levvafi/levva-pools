import { Provider } from 'ethers';
import { Erc20Config, IErc20Config } from '../../erc20-config';
import { validateAddress } from '../../../base/utils';

export interface IUniswapV3TickOraclePairSettings {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  secondsAgo: number;
  secondsAgoLiquidation: number;
  uniswapFee: number;
}

export interface IUniswapV3TickOracleDeployConfig {
  factoryAddress: string;
  settings?: IUniswapV3TickOraclePairSettings[];
}

export class UniswapV3TickOracleDeployConfig implements IUniswapV3TickOracleDeployConfig {
  public readonly factoryAddress: string;
  public readonly settings: IUniswapV3TickOraclePairSettings[];

  private readonly UNISWAP_FEES = new Set<number>([100, 500, 3000, 10_000]);

  constructor(jsonParsed: IUniswapV3TickOracleDeployConfig) {
    this.factoryAddress = jsonParsed.factoryAddress;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        quoteToken: new Erc20Config(settings.quoteToken),
        baseToken: new Erc20Config(settings.baseToken),
        secondsAgo: settings.secondsAgo,
        secondsAgoLiquidation: settings.secondsAgoLiquidation,
        uniswapFee: settings.uniswapFee,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.factoryAddress);

    for (const [index, settings] of this.settings.entries()) {
      if (!this.UNISWAP_FEES.has(settings.uniswapFee)) {
        throw new Error(
          `Wrong IUniswapV3TickOraclePairSettings.uniswapFee value ${settings.uniswapFee} (index ${index})`
        );
      }

      if (settings.secondsAgo == 0) {
        throw new Error(`IUniswapV3TickDoubleOraclePairSettings.secondsAgo can't be zero (index ${index})`);
      }

      if (settings.secondsAgoLiquidation == 0) {
        throw new Error(`IUniswapV3TickDoubleOraclePairSettings.secondsAgoLiquidation can't be zero (index ${index})`);
      }

      await Promise.all([settings.quoteToken.validate(provider), settings.baseToken.validate(provider)]);
    }
  }
}
