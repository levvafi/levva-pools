import { ContractFactory, BaseContract } from 'ethers';
import { ContractState, Storage } from '../deployment-states';

export class Deployer<T extends ContractFactory> {
  private readonly name: string;
  private blocksToConfirm: number;
  private readonly factory: T;
  private storage: Storage<ContractState>;

  constructor(name: string, factory: T, storage: Storage<ContractState>, blocksToConfirm: number = 1) {
    this.name = name;
    this.factory = factory;
    this.storage = storage;
    this.blocksToConfirm = blocksToConfirm;
  }

  public async performDeployment(args: any[] = []): Promise<string> {
    const inStorage = this.storage.getById(this.name);
    if (inStorage !== undefined) {
      console.log(`Already deployed ${this.name}, address: ${inStorage.address}. Skipping`);
      return inStorage.address;
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

    return address;
  }

  private async deploy(args: any[]): Promise<BaseContract> {
    return this.factory.deploy(...args);
  }
}
