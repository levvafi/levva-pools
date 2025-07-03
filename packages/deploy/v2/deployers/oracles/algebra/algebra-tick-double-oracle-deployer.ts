import { Signer } from 'ethers';
import { AlgebraTickOracleDouble__factory } from '../../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../../base/deployment-states';
import { Deployer } from '../../../base/deployers/deployer';
import { IAlgebraTickDoubleOracleDeployConfig } from '../../../configs/oracles';

export class AlgebraTickDoubleOracleDeployer extends Deployer<AlgebraTickOracleDouble__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      AlgebraTickOracleDouble__factory.name.replace('__factory', ''),
      new AlgebraTickOracleDouble__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IAlgebraTickDoubleOracleDeployConfig): Promise<string> {
    return super.performDeploymentRaw([config.factoryAddress]);
  }

  public async setup(config: IAlgebraTickDoubleOracleDeployConfig): Promise<void> {
    const address = this.getDeployedAddressSafe();
    const oracle = AlgebraTickOracleDouble__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setOptions(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.secondsAgo,
        oracleSettings.secondsAgoLiquidation,
        oracleSettings.intermediateToken.address
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
