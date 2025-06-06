import { logger } from './logger';
import { INITIAL_BALANCE, INITIAL_ETH, INITIAL_USDC, USDC_OWNER_ADDR } from './const';
import assert = require('assert');
import { BrowserProvider, formatEther, formatUnits, Provider } from 'ethers';
import { Signer } from 'ethers';
import { usdcContract, wethContract } from './known-contracts';
import { IWETH9, IUSDC } from '../../../contracts/typechain-types';

export async function initWeth(signer: Signer, provider: Provider): Promise<IWETH9> {
  const weth = wethContract(provider);
  const address = await signer.getAddress();
  logger.info(`weth erc20 address: ${await weth.getAddress()}`);

  const depositTx = await weth
    .connect(signer)
    .deposit({ value: INITIAL_ETH, gasPrice: 200000000000, gasLimit: 300000 });
  await depositTx.wait();

  assert.equal(formatEther(await weth.balanceOf(address)), INITIAL_BALANCE);
  return weth;
}

export async function initUsdc(signer: Signer, provider: BrowserProvider): Promise<IUSDC> {
  const usdc = usdcContract(provider);
  const address = await signer.getAddress();
  logger.info(`usdc erc20 address: ${await usdc.getAddress()}`);

  const usdcOwnerSigner = await provider.getSigner(USDC_OWNER_ADDR);

  const transferOwnershipTx = await usdc.connect(usdcOwnerSigner).transferOwnership(address);

  await transferOwnershipTx.wait();

  const updateMasterMinterTx = await usdc.connect(signer).updateMasterMinter(address);
  await updateMasterMinterTx.wait();

  const configureMinterTx = await usdc.connect(signer).configureMinter(address, INITIAL_USDC * 10n);
  await configureMinterTx.wait();

  const mintTx = await usdc.connect(signer).mint(address, INITIAL_USDC);
  await mintTx.wait();

  assert.equal(formatUnits(await usdc.balanceOf(address), 6), INITIAL_BALANCE);
  return usdc;
}
