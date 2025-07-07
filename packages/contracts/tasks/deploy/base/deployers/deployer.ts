import { ContractFactory, BaseContract } from 'ethers';
import { ContractState, Storage } from '../deployment-states';
export class Deployer<TFactory extends ContractFactory> {
  protected readonly name: string;
  protected blocksToConfirm: number;
  protected readonly factory: TFactory;
  protected storage: Storage<ContractState>;

  constructor(name: string, factory: TFactory, storage: Storage<ContractState>, blocksToConfirm: number = 1) {
    this.name = name;
    this.factory = factory;
    this.storage = storage;
    this.blocksToConfirm = blocksToConfirm;
  }

  protected async performDeploymentRaw(args: any[] = [], nameOverload?: string): Promise<string> {
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
}
