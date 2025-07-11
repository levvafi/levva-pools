import { ContractFactory, BaseContract } from 'ethers';
import { ContractState, Storage } from '../deployment-states';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

export class UUPSDeployer<T extends ContractFactory> {
  private readonly name: string;
  private readonly factory: T;
  private readonly hre: HardhatRuntimeEnvironment;
  private storage: Storage<ContractState>;
  private blocksToConfirm: number;

  constructor(
    name: string,
    factory: T,
    storage: Storage<ContractState>,
    hre: HardhatRuntimeEnvironment,
    blocksToConfirm: number = 1
  ) {
    this.name = name;
    this.factory = factory;
    this.hre = hre;
    this.storage = storage;
    this.blocksToConfirm = blocksToConfirm;
  }

  public async performDeployment(args: any[] = []) {
    const inStorage = this.storage.getById(this.name);
    if (inStorage != undefined) {
      console.log(`Already deployed ${this.name}, address: ${inStorage.address}. Skipping`);
      return;
    }

    console.log(`${this.name}-deployer starts deployment`);
    const deployedContract = await this.deploy(args);
    const deploymentTx = deployedContract.deploymentTransaction();
    await deploymentTx?.wait(this.blocksToConfirm);

    const address = deployedContract.target.toString();
    const txHash = deploymentTx?.hash;
    console.log(`${this.name}-deployer successfully deployed ${address} contract. Tx hash: ${txHash}`);

    const contractState: ContractState = { address, txHash };
    this.storage.setById(this.name, contractState);
    this.storage.save();
  }

  private async deploy(args: any[]): Promise<BaseContract> {
    throw new Error('UUPS deployer is not implemented');
    // return this.hre.upgrades.deployProxy(this.factory, args, { kind: 'uups' });
  }
}
