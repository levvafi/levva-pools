import { BaseContract, ContractTransactionResponse } from 'ethers';
import { ContractState, Storage } from '../deployment-states';

export type DeployMethod = (...args: any[]) => Promise<ContractTransactionResponse>;
export type DeployEventParser = (txReceipt: ContractTransactionResponse) => Promise<string>;

export class FactoryDeployer {
  protected readonly name: string;
  protected blocksToConfirm: number;
  protected readonly factoryDeployMethod: DeployMethod;
  protected readonly deployEventParser: DeployEventParser;
  protected storage: Storage<ContractState>;

  constructor(
    name: string,
    factoryDeployMethod: DeployMethod,
    deployEventParser: DeployEventParser,
    storage: Storage<ContractState>,
    blocksToConfirm: number = 1
  ) {
    this.name = name;
    this.factoryDeployMethod = factoryDeployMethod;
    this.deployEventParser = deployEventParser;
    this.storage = storage;
    this.blocksToConfirm = blocksToConfirm;
  }

  protected async performDeploymentRaw(args: any[] = [], tag: string): Promise<string> {
    const inStorage = this.storage.getById(tag);
    if (inStorage !== undefined) {
      console.log(`Already deployed '${tag}', address: ${inStorage.address}. Skipping`);
      return inStorage.address;
    }

    console.log(`${this.name}-deployer starts deployment`);
    const deploymentTx = await this.deploy(args);
    await deploymentTx?.wait(this.blocksToConfirm);

    const address = await this.deployEventParser(deploymentTx);
    const txHash = deploymentTx?.hash;

    console.log(`${tag}-deployer successfully deployed ${address} contract. Tx hash: ${txHash}`);

    const contractState: ContractState = { address, txHash };
    this.storage.setById(tag, contractState);
    this.storage.save();

    return address;
  }

  protected getDeployedAddressSafe(name: string): string {
    const inStorage = this.storage.getById(name);
    if (inStorage === undefined) {
      throw new Error(`No deployed address with '${name}' name`);
    }
    return inStorage.address;
  }

  private async deploy(args: any[]): Promise<ContractTransactionResponse> {
    return this.factoryDeployMethod(...args);
  }
}
