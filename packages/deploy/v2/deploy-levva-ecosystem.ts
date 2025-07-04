import { ethers } from 'ethers';
import { getConfigParsed } from './base/base-config';
import { ILevvaEcosystemConfig, LevvaEcosystemConfig } from './levva-ecosystem-config';

export async function runLevvaDeployment() {
  const jsonParsed = getConfigParsed<ILevvaEcosystemConfig>('./v2', 'test-config');
  const config = new LevvaEcosystemConfig(jsonParsed);
  console.log(config);
  await config.validate(new ethers.JsonRpcProvider('https://ethereum-rpc.publicnode.com'));
}
