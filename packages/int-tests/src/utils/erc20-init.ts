import { logger } from './logger';
import { INITIAL_BALANCE, INITIAL_USDC, USDC_OWNER_ADDR } from './const';
import assert = require('assert');
import { formatUnits, Provider } from 'ethers';
import { usdcContract, wethContract } from './known-contracts';
import { IWETH9, IUSDC } from '../../../contracts/typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';

export async function initWeth(signer: SignerWithAddress, provider: Provider): Promise<IWETH9> {
  const weth = wethContract(provider);
  const address = await signer.getAddress();
  logger.info(`weth erc20 address: ${await weth.getAddress()}`);

  const wethBalance = (await signer.provider.getBalance(signer)) / 2n;
  const currentBalance = await weth.balanceOf(signer);
  if (currentBalance < wethBalance) {
    const depositTx = await weth.connect(signer).deposit({ value: wethBalance - currentBalance });
    await depositTx.wait();
  }

  // assert.equal(await weth.balanceOf(address), wethBalance);
  return weth;
}

export async function initUsdc(signer: SignerWithAddress, provider: Provider): Promise<IUSDC> {
  const usdc = usdcContract(provider);
  const address = await signer.getAddress();
  logger.info(`usdc erc20 address: ${await usdc.getAddress()}`);

  const usdcOwnerSigner = await ethers.getImpersonatedSigner(await usdc.owner());

  const transferOwnershipTx = await usdc.connect(usdcOwnerSigner).transferOwnership(address);

  await transferOwnershipTx.wait();

  const updateMasterMinterTx = await usdc.connect(signer).updateMasterMinter(address);
  await updateMasterMinterTx.wait();

  const configureMinterTx = await usdc.connect(signer).configureMinter(address, INITIAL_USDC * 10n);
  await configureMinterTx.wait();

  const currentBalance = await usdc.balanceOf(signer);
  if (currentBalance < INITIAL_USDC) {
    const mintTx = await usdc.connect(signer).mint(address, INITIAL_USDC - currentBalance);
    await mintTx.wait();
  }

  // assert.equal(formatUnits(await usdc.balanceOf(address), 6), INITIAL_BALANCE);
  return usdc;
}
