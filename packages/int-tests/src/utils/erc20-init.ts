import { INITIAL_USDC, INITIAL_ETH } from './const';
import assert from 'assert';
import { Provider } from 'ethers';
import { usdcContract, wethContract } from './known-contracts';
import { IWETH9, IUSDC } from '../../../contracts/typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { setBalance } from '@nomicfoundation/hardhat-network-helpers';
import { Logger } from 'pino';

export async function initWeth(signer: SignerWithAddress, provider: Provider, logger: Logger): Promise<IWETH9> {
  const weth = wethContract(provider);
  logger.info(`weth erc20 address: ${await weth.getAddress()}`);
  await setBalance(signer.address, 2n * INITIAL_ETH);

  const currentBalance = await weth.balanceOf(signer);
  if (currentBalance < INITIAL_ETH) {
    const depositTx = await weth.connect(signer).deposit({ value: INITIAL_ETH - currentBalance });
    await depositTx.wait();
  }

  assert.equal(await weth.balanceOf(signer), INITIAL_ETH);
  return weth;
}

export async function initUsdc(signer: SignerWithAddress, provider: Provider, logger: Logger): Promise<IUSDC> {
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

  assert.equal(await usdc.balanceOf(address), INITIAL_USDC);
  return usdc;
}
