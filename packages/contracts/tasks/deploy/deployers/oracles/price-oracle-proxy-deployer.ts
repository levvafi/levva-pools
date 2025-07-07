import { Signer } from 'ethers';
import { PriceOracleProxy__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IProxyPriceOracleDeployConfig } from '../../configs/oracles';

export class ProxyPriceOracleDeployer extends Deployer<PriceOracleProxy__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PriceOracleProxy__factory.name.replace('__factory', ''),
      new PriceOracleProxy__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IProxyPriceOracleDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw();
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IProxyPriceOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = PriceOracleProxy__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    for (const oracleSettings of config.settings) {
      const currentOptions = await oracle.getParams(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address
      );

      const isSet =
        currentOptions.quoteToken === oracleSettings.quoteToken.address &&
        currentOptions.baseToken === oracleSettings.baseToken.address &&
        currentOptions.priceOracle === oracleSettings.priceOracleAddress;

      if (isSet) {
        console.log(
          `${this.name} oracle ${oracleSettings.quoteToken.address}/${oracleSettings.baseToken.address} pair is set. Skipping`
        );
        continue;
      }

      const tx = await oracle.setPair(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.underlyingQuoteToken.address,
        oracleSettings.underlyingBaseToken.address,
        oracleSettings.priceOracleAddress
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
