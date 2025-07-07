import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { validateAddress } from '../../base/utils';
import { Erc20Config, IErc20Config } from '../erc20-config';

export interface IPendleUniswapAdapterPairSettings {
  tokenA: IErc20Config;
  tokenB: IErc20Config;
  ibToken: IErc20Config;
  pendleMarket: string;
  poolAddress: string;
  slippage: number;
}

export interface IPendleUniswapAdapterDeployConfig extends IConfigBase {
  dexId: number;
  settings?: IPendleUniswapAdapterPairSettings[];
}

export class PendleUniswapAdapterDeployConfig implements IPendleUniswapAdapterDeployConfig {
  public readonly dexId: number;
  public readonly settings: IPendleUniswapAdapterPairSettings[];

  constructor(jsonParsed: IPendleUniswapAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        tokenA: new Erc20Config(settings.tokenA),
        tokenB: new Erc20Config(settings.tokenB),
        ibToken: new Erc20Config(settings.ibToken),
        pendleMarket: settings.pendleMarket,
        poolAddress: settings.poolAddress,
        slippage: settings.slippage,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    if (this.dexId === undefined) {
      throw new Error('Undefined dexId');
    }

    for (const [_, settings] of this.settings.entries()) {
      // TODO: validate slippage
      validateAddress(settings.poolAddress);
      validateAddress(settings.pendleMarket);
      await Promise.all([
        settings.tokenA.validate(provider),
        settings.tokenB.validate(provider),
        settings.ibToken.validate(provider),
      ]);
    }
  }
}
