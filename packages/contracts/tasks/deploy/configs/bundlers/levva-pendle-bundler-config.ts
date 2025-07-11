import { Provider } from 'ethers';
import { validateAddress } from '../../base/utils';

export interface ILevvaPendleBundlerDeployConfig {
  pendleRouterAddress: string;
}

export class LevvaPendleBundlerDeployConfig implements ILevvaPendleBundlerDeployConfig {
  public readonly pendleRouterAddress: string;

  constructor(jsonParsed: ILevvaPendleBundlerDeployConfig) {
    this.pendleRouterAddress = jsonParsed.pendleRouterAddress;
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.pendleRouterAddress);
  }
}
