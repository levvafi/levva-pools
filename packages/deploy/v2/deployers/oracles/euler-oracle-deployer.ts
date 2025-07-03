import { Signer } from 'ethers';
import { EulerPriceOracle__factory } from '../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IEulerOracleDeployConfig } from '../../configs/oracles';

export class EulerOracleDeployer extends Deployer<EulerPriceOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      EulerPriceOracle__factory.name.replace('__factory', ''),
      new EulerPriceOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IEulerOracleDeployConfig): Promise<string> {
    return super.performDeploymentRaw();
  }

  public async setup(config: IEulerOracleDeployConfig): Promise<void> {
    const address = this.getDeployedAddressSafe();
    const oracle = EulerPriceOracle__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.addPair(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.eulerOracleAddress
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
