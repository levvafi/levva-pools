import { Signer, ZeroAddress } from 'ethers';
import { CurveOracle__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { ICurveOracleDeployConfig } from '../../configs/oracles';
import { isSameAddress } from '../../base/utils';

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
    const address = await super.performDeploymentRaw();
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: ICurveOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = CurveOracle__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    for (const oracleSettings of config.settings) {
      const currentOptions = await oracle.getParams(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address
      );

      if (!isSameAddress(currentOptions.pool, ZeroAddress)) {
        console.log(
          `${this.name} oracle ${oracleSettings.quoteToken.address}/${oracleSettings.baseToken.address} pair is set. Skipping`
        );
        continue;
      }

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
