import { Signer } from 'ethers';
import { CurveOracle__factory } from '../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { ICurveOracleDeployConfig } from '../../configs/oracles';

export class CurveOracleDeployer extends Deployer<CurveOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      CurveOracle__factory.name.replace('__factory', ''),
      new CurveOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: ICurveOracleDeployConfig): Promise<string> {
    return super.performDeploymentRaw();
  }

  public async setup(config: ICurveOracleDeployConfig): Promise<void> {
    const address = this.getDeployedAddressSafe();
    const oracle = CurveOracle__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.addPool(
        oracleSettings.poolAddress,
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        true // TODO: where from?
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
