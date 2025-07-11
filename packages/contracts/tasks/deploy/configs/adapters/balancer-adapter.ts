import { Provider } from 'ethers';
import { validateAddress } from '../../base/utils';
import { GeneralAdapterDeployConfig, IGeneralAdapterDeployConfig } from './general-adapter';

export interface IBalancerAdapterDeployConfig extends IGeneralAdapterDeployConfig {
  vault: string;
}

export class BalancerAdapterDeployConfig extends GeneralAdapterDeployConfig implements IBalancerAdapterDeployConfig {
  public readonly vault: string;

  constructor(jsonParsed: IBalancerAdapterDeployConfig) {
    super(jsonParsed);
    this.vault = jsonParsed.vault;
  }

  async validate(provider: Provider): Promise<void> {
    validateAddress(this.vault);
    super.validate(provider);
  }
}
