import { Provider } from 'ethers';
import { IConfigBase } from '../base/base-config';
import { validateAddress } from '../base/utils';
import { Erc20Config, IErc20Config } from './erc20-config';

export interface LevvaParams {
  maxLeverage: number;
  interestRate: number;
  fee: number;
  swapFee: number;
  mcSlippage: number;
  positionMinAmount: bigint;
  quoteLimit: bigint;
}

export interface ILevvaPoolConfig extends IConfigBase {
  quoteToken: IErc20Config;
  baseToken: IErc20Config;
  priceOracle: string;
  defaultSwapCallData: number;
  params: LevvaParams;
}

export class LevvaPoolConfig implements ILevvaPoolConfig {
  public readonly quoteToken: IErc20Config;
  public readonly baseToken: IErc20Config;
  public readonly priceOracle: string;
  public readonly defaultSwapCallData: number;
  public readonly params: LevvaParams;

  constructor(jsonParsed: ILevvaPoolConfig) {
    this.quoteToken = new Erc20Config(jsonParsed.quoteToken);
    this.baseToken = new Erc20Config(jsonParsed.baseToken);
    this.priceOracle = jsonParsed.priceOracle;
    this.defaultSwapCallData = jsonParsed.defaultSwapCallData;
    this.params = jsonParsed.params;
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.priceOracle);

    // TODO: decode to validate?
    if (this.defaultSwapCallData >= 2 ** 32) {
      throw new Error(`defaultSwapCallData ${this.defaultSwapCallData} is greater than u32::MAX`);
    }

    this.validateParams();

    await Promise.all([this.quoteToken.validate(provider), this.baseToken.validate(provider)]);
  }

  private validateParams(): void {
    if (this.params.maxLeverage == 0 || this.params.maxLeverage >= 256) {
      throw new Error(`Wrong maxLeverage value: ${this.params.maxLeverage}`);
    }

    if (this.params.interestRate >= 1e6) {
      throw new Error(`Wrong interestRate value: ${this.params.interestRate}`);
    }

    if (this.params.fee >= 1e6) {
      throw new Error(`Wrong fee value: ${this.params.fee}`);
    }

    if (this.params.swapFee >= 1e6) {
      throw new Error(`Wrong swapFee value: ${this.params.swapFee}`);
    }

    if (this.params.mcSlippage >= 1e6) {
      throw new Error(`Wrong mcSlippage value: ${this.params.mcSlippage}`);
    }

    if (this.params.positionMinAmount >= 2n ** 184n) {
      throw new Error(`Wrong positionMinAmount value: ${this.params.positionMinAmount}`);
    }

    if (this.params.quoteLimit >= 2n ** 184n) {
      throw new Error(`Wrong quoteLimit value: ${this.params.quoteLimit}`);
    }
  }
}
