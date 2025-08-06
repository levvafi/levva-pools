import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { parseUnits, ZeroAddress } from 'ethers';
import { IERC20__factory, LevvaPendleBundler, LevvaPendleBundler__factory } from '../../../typechain-types';
import { LevvaFarmingPool, LevvaFarmingPool__factory } from '../../../typechain-types';
import { MarginlyParamsStruct } from '../../../typechain-types/contracts/LevvaFarmingPool';
import { MarginlyFactory__factory } from '../../../typechain-types';
import { MarginlyRouter__factory } from '../../../typechain-types';
import { PendleMarketAdapter__factory } from '../../../typechain-types';
import { PendleMarketOracle__factory } from '../../../typechain-types';
import { PENDLE_ROUTER, WETH9, PENDLE_ORACLE, WSTETH } from './registry';
import { PENDLE_PT_WSTETH_30_12_27, PENDLE_MARKET_WSTETH_30_12_27 } from './registry';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from './tokens';
import { CallType } from '../../pool/utils/chain-ops';

export async function deployPendleBundlerWithPool(): Promise<{ bundler: LevvaPendleBundler; pool: LevvaFarmingPool }> {
  const [signer] = await ethers.getSigners();
  const pool = await deployPool(signer);
  const bundler = await deployPendleBundler(signer);
  return { pool, bundler };
}

async function deployPendleBundler(owner: SignerWithAddress): Promise<LevvaPendleBundler> {
  return new LevvaPendleBundler__factory(owner).deploy(PENDLE_ROUTER);
}

async function deployPool(owner: SignerWithAddress): Promise<LevvaFarmingPool> {
  const poolImplementation = await new LevvaFarmingPool__factory(owner).deploy();

  const pendleAdapter = await new PendleMarketAdapter__factory(owner).deploy([
    {
      pendleMarket: PENDLE_MARKET_WSTETH_30_12_27,
      slippage: 5,
      ptToken: PENDLE_PT_WSTETH_30_12_27,
      ibToken: WSTETH,
    },
  ]);
  const router = await new MarginlyRouter__factory(owner).deploy([
    { dexIndex: 0, adapter: await pendleAdapter.getAddress() },
  ]);

  const oracle = await new PendleMarketOracle__factory(owner).deploy(PENDLE_ORACLE);
  await oracle.setPair(WSTETH, PENDLE_PT_WSTETH_30_12_27, PENDLE_MARKET_WSTETH_30_12_27, 600, 10);

  const factory = await new MarginlyFactory__factory(owner).deploy(poolImplementation, router, owner, WETH9, owner);
  const poolAddress = await factory.createPool.staticCall(
    WSTETH,
    PENDLE_PT_WSTETH_30_12_27,
    oracle,
    0,
    defaultParams()
  );
  await factory.createPool(WSTETH, PENDLE_PT_WSTETH_30_12_27, oracle, 0, defaultParams());

  const pool = LevvaFarmingPool__factory.connect(poolAddress, owner.provider);

  const deposit = parseUnits('50', 18);
  await setTokenBalance(WSTETH, EthereumMainnetERC20BalanceOfSlot.WSTETH, owner.address, deposit);
  await IERC20__factory.connect(WSTETH, owner).approve(pool, deposit);
  await pool.connect(owner).execute(CallType.DepositQuote, deposit, 0, 0, false, ZeroAddress, 0);

  return pool;
}

function defaultParams(): MarginlyParamsStruct {
  return {
    interestRate: 0,
    fee: 0,
    maxLeverage: 20,
    swapFee: 0,
    mcSlippage: 10000,
    positionMinAmount: 1,
    quoteLimit: parseUnits('200', 18),
  };
}
