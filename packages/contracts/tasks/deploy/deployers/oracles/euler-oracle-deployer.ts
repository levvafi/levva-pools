import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer } from 'ethers';
import { EulerPriceOracle__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IEulerOracleDeployConfig } from '../../configs/oracles';
import { isSameAddress } from '../../base/utils';

export class EulerOracleDeployer extends Deployer<EulerPriceOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      EulerPriceOracle__factory.name.replace('__factory', ''),
      new EulerPriceOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(hre: HardhatRuntimeEnvironment, config: IEulerOracleDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw(hre);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IEulerOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = EulerPriceOracle__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    for (const oracleSettings of config.settings) {
      const currentOptions = await oracle.getParams(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address
      );

      if (isSameAddress(currentOptions, oracleSettings.eulerOracleAddress)) {
        console.log(
          `${this.name} oracle ${oracleSettings.quoteToken.address}/${oracleSettings.baseToken.address} pair is set. Skipping`
        );
        continue;
      }

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
