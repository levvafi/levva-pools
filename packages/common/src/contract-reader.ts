import * as ethers from 'ethers';

export interface ContractDescription {
  abi: ethers.Interface;
  bytecode: string;
}

export type ContractReader = (name: string) => ContractDescription;
