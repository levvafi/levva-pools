import { Provider } from 'ethers';
import { IERC20Metadata, IERC20Metadata__factory } from '../../../contracts/typechain-types';
import { IConfigBase } from '../base/base-config';
import { validateAddress } from '../base/utils';

export interface IErc20Config extends IConfigBase {
  address: string;
  decimals?: number;
  symbol?: string;
}

export class Erc20Config implements IErc20Config {
  public readonly address: string;
  public readonly decimals?: number;
  public readonly symbol?: string;

  constructor(jsonParsed: IErc20Config) {
    this.address = jsonParsed.address;
    this.decimals = jsonParsed.decimals;
    this.symbol = jsonParsed.symbol;
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.address);

    const token = IERC20Metadata__factory.connect(this.address, provider);
    await Promise.all([this.validateSymbol(token), this.validateDecimals(token)]);
  }

  private async validateSymbol(token: IERC20Metadata) {
    if (this.symbol === undefined) {
      return;
    }

    const actual = await token.symbol();
    if (this.symbol !== actual) {
      throw new Error(`Expected ${this.symbol} for token ${this.address}, got ${actual}`);
    }
  }

  private async validateDecimals(token: IERC20Metadata) {
    if (this.decimals === undefined) {
      return;
    }

    const actual = await token.decimals();
    if (this.decimals !== Number(actual)) {
      throw new Error(`Expected ${this.decimals} for token ${this.address}, got ${actual}`);
    }
  }
}
