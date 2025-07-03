import { Signer } from 'ethers';
import { PriceOracleProxy__factory } from '../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IPriceOracleProxyDeployConfig } from '../../configs/oracles';

export class PriceOracleProxyDeployer extends Deployer<PriceOracleProxy__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PriceOracleProxy__factory.name.replace('__factory', ''),
      new PriceOracleProxy__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPriceOracleProxyDeployConfig): Promise<string> {
    return super.performDeploymentRaw();
  }

  public async setup(config: IPriceOracleProxyDeployConfig): Promise<void> {
    const address = this.getDeployedAddressSafe();
    const oracle = PriceOracleProxy__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
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
