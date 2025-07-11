import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer, ZeroAddress } from 'ethers';
import { MarginlyCompositeOracle__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IMarginlyCompositeOracleDeployConfig } from '../../configs/oracles';
import { isSameAddress } from '../../base/utils';

export class MarginlyCompositeOracleDeployer extends Deployer<MarginlyCompositeOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      MarginlyCompositeOracleDeployer.name.replace('__factory', ''),
      new MarginlyCompositeOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(
    hre: HardhatRuntimeEnvironment,
    config: IMarginlyCompositeOracleDeployConfig
  ): Promise<string> {
    const address = await super.performDeploymentRaw(hre);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IMarginlyCompositeOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = MarginlyCompositeOracle__factory.connect(
      address ?? this.getDeployedAddressSafe(),
      this.factory.runner
    );

    for (const oracleSettings of config.settings) {
      const currentOptions = await oracle.getParams(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address
      );

      if (!isSameAddress(currentOptions.intermediateToken, ZeroAddress)) {
        console.log(
          `${this.name} oracle ${oracleSettings.quoteToken.address}/${oracleSettings.baseToken.address} pair is set. Skipping`
        );
        continue;
      }

      const tx = await oracle.setPair(
        oracleSettings.quoteToken.address,
        oracleSettings.intermediateToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.quoteIntermediateOracleAddress,
        oracleSettings.intermediateBaseOracleAddress
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
