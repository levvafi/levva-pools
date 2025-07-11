import { Provider } from 'ethers';
import { IConfigBase } from '../../base/base-config';
import { validateAddress } from '../../base/utils';
import { Erc20Config, IErc20Config } from '../erc20-config';

export interface IPendleCurveRouterAdapterPairSettings {
  tokenA: IErc20Config;
  tokenB: IErc20Config;
  pendleMarket: string;
  slippage: number;
  curveRoute: string[];
  curveSwapParams: number[][];
  curvePools: string[];
  curveDxAdjustPtToToken: number;
  curveDxAdjustTokenToPt: number;
}

export interface IPendleCurveRouterAdapterDeployConfig extends IConfigBase {
  dexId: number;
  router: string;
  settings?: IPendleCurveRouterAdapterPairSettings[];
}

export class PendleCurveRouterAdapterDeployConfig implements IPendleCurveRouterAdapterDeployConfig {
  public readonly dexId: number;
  public readonly router: string;
  public readonly settings: IPendleCurveRouterAdapterPairSettings[];

  constructor(jsonParsed: IPendleCurveRouterAdapterDeployConfig) {
    this.dexId = jsonParsed.dexId;
    this.router = jsonParsed.router;
    this.settings = [];
    (jsonParsed.settings ?? []).forEach((settings) => {
      this.settings.push({
        tokenA: new Erc20Config(settings.tokenA),
        tokenB: new Erc20Config(settings.tokenB),
        pendleMarket: settings.pendleMarket,
        slippage: settings.slippage,
        curveRoute: settings.curveRoute,
        curveSwapParams: settings.curveSwapParams,
        curvePools: settings.curvePools,
        curveDxAdjustPtToToken: settings.curveDxAdjustPtToToken,
        curveDxAdjustTokenToPt: settings.curveDxAdjustTokenToPt,
      });
    });
  }

  async validate(provider: Provider): Promise<void> {
    if (this.dexId === undefined) {
      throw new Error('Undefined dexId');
    }

    validateAddress(this.router);

    for (const [_, settings] of this.settings.entries()) {
      // TODO: validate the rest of parameters
      validateAddress(settings.pendleMarket);
      await Promise.all([settings.tokenA.validate(provider), settings.tokenB.validate(provider)]);
    }
  }
}
