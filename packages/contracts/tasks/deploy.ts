import { task } from 'hardhat/config';
import { HardhatNetworkConfig, HardhatRuntimeEnvironment } from 'hardhat/types';
import { runLevvaDeployment } from './deploy/deploy-levva-ecosystem';

interface DeployArgs {
  tag?: string;
  forceSave: boolean;
}

task('task:deploy', 'Full system deployment')
  .addOptionalParam<string>('tag', 'Tag for deployment data savings')
  .addFlag('forceSave', 'Forces storage saves on dry runs')
  .setAction(async (taskArgs: DeployArgs, hre: HardhatRuntimeEnvironment) => {
    const network = hre.network.name.toLowerCase();
    const dryRun = hre.config.networks.hardhat.forking?.enabled ?? false;

    const networkConfig = hre.config.networks[network] as HardhatNetworkConfig | undefined;
    if (networkConfig === undefined) {
      throw new Error(`Failed to find config for a network with a name ${network}`);
    }
    const [signer] = await hre.ethers.getSigners();

    const balanceBefore = await signer.provider!.getBalance(signer.address);
    console.log(`Balance before: ${hre.ethers.formatEther(balanceBefore)} Eth`);

    const saveFlag = taskArgs.forceSave || !dryRun;
    await runLevvaDeployment(hre, signer, network, saveFlag, taskArgs.tag);

    const balanceAfter = await signer.provider!.getBalance(signer.address);
    console.log(`Balance after: ${hre.ethers.formatEther(balanceAfter)} Eth`);

    console.log(`Spent: ${hre.ethers.formatEther(balanceBefore - balanceAfter)} Eth`);
    console.log(`Done!`);
  });
