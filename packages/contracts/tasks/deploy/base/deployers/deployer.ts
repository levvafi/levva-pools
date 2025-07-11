import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ContractFactory, BaseContract } from 'ethers';
import { ContractState, Storage } from '../deployment-states';
import { isDryRun } from '../utils';

export class Deployer<TFactory extends ContractFactory> {
  protected readonly name: string;
  protected blocksToConfirm: number;
  protected readonly factory: TFactory;
  protected storage: Storage<ContractState>;

  private static readonly VERIFICATION_MAX_TRIES = 10;
  private static readonly VERIFICATION_RETRY_PAUSE_MS = 10_000;
  private static readonly VERIFICATION_RESPONSE_AWAIT_TIME_MS = 30_000;

  constructor(name: string, factory: TFactory, storage: Storage<ContractState>, blocksToConfirm: number = 1) {
    this.name = name;
    this.factory = factory;
    this.storage = storage;
    this.blocksToConfirm = blocksToConfirm;
  }

  protected async performDeploymentRaw(
    hre: HardhatRuntimeEnvironment,
    args: any[] = [],
    nameOverload?: string
  ): Promise<string> {
    const name = nameOverload ?? this.name;
    const inStorage = this.storage.getById(name);
    if (inStorage !== undefined) {
      console.log(`Already deployed '${name}', address: ${inStorage.address}. Skipping`);
      return inStorage.address;
    }

    console.log(`${name}-deployer starts deployment`);
    const deployedContract = await this.deploy(args);
    const deploymentTx = deployedContract.deploymentTransaction();
    await deploymentTx?.wait(this.blocksToConfirm);

    const address = deployedContract.target.toString();
    const txHash = deploymentTx?.hash;

    console.log(`${name}-deployer successfully deployed ${address} contract. Tx hash: ${txHash}`);

    const contractState: ContractState = { address, txHash };
    this.storage.setById(name, contractState);
    this.storage.save();

    await this.verifyContract(hre, address, args);

    return address;
  }

  protected getDeployedAddressSafe(): string {
    const inStorage = this.storage.getById(this.name);
    if (inStorage === undefined) {
      throw new Error(`No deployed address with '${this.name}' name`);
    }
    return inStorage.address;
  }

  private async deploy(args: any[]): Promise<BaseContract> {
    return this.factory.deploy(...args);
  }

  private async verifyContract(
    hre: HardhatRuntimeEnvironment,
    address: string,
    constructorArguments: any[]
  ): Promise<void> {
    if (isDryRun(hre)) {
      console.log('Dry run. Skipping contract verification');
      return;
    }

    console.log(`Verifying contract ${address} with constructor arguments: ${constructorArguments}`);

    for (let i = 0; i < Deployer.VERIFICATION_MAX_TRIES; ++i) {
      try {
        await Promise.race([
          hre.run('verify:verify', {
            address,
            constructorArguments,
          }),
          this.delay(Deployer.VERIFICATION_RESPONSE_AWAIT_TIME_MS),
        ]);
        break;
      } catch (e) {
        console.log(`Contract verification ${address} failed (attempt ${i + 1}): ${e}`);

        if (i + 1 === Deployer.VERIFICATION_MAX_TRIES) {
          throw new Error(`${this.name}-deployer failed contract verification`);
        }

        console.log(`Waiting for ${Deployer.VERIFICATION_RETRY_PAUSE_MS} ms before retrying`);
        await this.delay(Deployer.VERIFICATION_RETRY_PAUSE_MS);
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    new Promise((resolve) => setTimeout(resolve, ms));
  }
}
