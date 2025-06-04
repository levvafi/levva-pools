import { Contract, Signer } from 'ethers';
import { EthOptions } from '../config';
import { Logger } from '../logger';
import { EthAddress } from '@marginly/common';
import { BigNumber } from '@ethersproject/bignumber';
import * as ethers from 'ethers';
import { MarginlyConfigToken, StateStore } from '../common';
import { DeployResult, ITokenRepository, LimitedDeployResult } from '../common/interfaces';
import { MarginlyConfigMarginlyPool, MarginlyConfigSwapPool, PriceProviderMock } from './configs';
import {
  createMarginlyContractReader,
  createMarginlyPeripheryContractReader,
  createMarginlyPeripheryMockContract,
  createTimelockWhitelistContract,
} from './contract-reader';
import { BaseDeployer } from './BaseDeployer';

export class MarginlyDeployer extends BaseDeployer {
  private readonly readMarginlyContract;
  private readonly readMarginlyPeripheryContract;
  private readonly readMarginlyPeripheryMockContract;
  private readonly readTimeLockContract;

  public constructor(signer: Signer, ethArgs: EthOptions, stateStore: StateStore, logger: Logger) {
    super(signer, ethArgs, stateStore, logger);
    this.readMarginlyContract = createMarginlyContractReader();
    this.readMarginlyPeripheryContract = createMarginlyPeripheryContractReader();
    this.readMarginlyPeripheryMockContract = createMarginlyPeripheryMockContract();
    this.readTimeLockContract = createTimelockWhitelistContract();
  }

  public deployMarginlyPoolImplementation(): Promise<DeployResult> {
    return this.deploy('MarginlyPool', [], 'marginlyPoolImplementation', this.readMarginlyContract);
  }

  public deployMarginlyFactory(
    marginlyPoolImplementation: EthAddress,
    swapRouter: EthAddress,
    feeHolder: EthAddress,
    weth9: MarginlyConfigToken,
    tokenRepository: ITokenRepository,
    techPositionOwner: EthAddress
  ): Promise<DeployResult> {
    const { address: weth9Address } = tokenRepository.getTokenInfo(weth9.id);
    return this.deploy(
      'MarginlyFactory',
      [
        marginlyPoolImplementation.toString(),
        swapRouter.toString(),
        feeHolder.toString(),
        weth9Address.toString(),
        techPositionOwner.toString(),
      ],
      'marginlyFactory',
      this.readMarginlyContract
    );
  }

  private async getCreatedMarginlyPoolAddress(
    marginlyFactoryContract: ethers.Contract,
    txHash: string,
    quoteToken: EthAddress,
    baseToken: EthAddress,
    priceOracle: EthAddress
  ): Promise<EthAddress> {
    const txReceipt = await this.provider.getTransactionReceipt(txHash);
    const eventFilter = marginlyFactoryContract.filters.PoolCreated(
      quoteToken.toString(),
      baseToken.toString(),
      priceOracle.toString()
    );
    const events = await marginlyFactoryContract.queryFilter(eventFilter, txReceipt.blockHash);

    if (events.length === 0) {
      throw new Error('PoolCreated event not found');
    }
    if (events.length > 1) {
      throw new Error('Multiple PoolCreated events found');
    }
    const event = events[0];
    if (event.args === undefined) {
      throw new Error('PoolCreated event args are undefined');
    }

    const poolAddress = event.args[4];

    return EthAddress.parse(poolAddress);
  }

  public async getOrCreateMarginlyPool(
    marginlyPoolFactoryContract: Contract,
    config: MarginlyConfigMarginlyPool,
    tokenRepository: ITokenRepository,
    priceOracle: EthAddress,
    timelockOwner?: EthAddress
  ): Promise<LimitedDeployResult> {
    const stateFileId = `marginlyPool_${config.id}`;
    const marginlyPoolContractDescription = this.readMarginlyContract('MarginlyPool');
    const timelockDescription = this.readTimeLockContract('TimelockWhitelist');

    const stateFromFile = this.stateStore.getById(stateFileId);
    if (stateFromFile !== undefined) {
      this.logger.log(`Import MarginlyPool from state file`);
      const marginlyPoolContract = new ethers.Contract(
        stateFromFile.address,
        marginlyPoolContractDescription.abi,
        this.provider
      );
      return {
        address: stateFromFile.address,
        txHash: stateFromFile.txHash,
        contract: marginlyPoolContract,
      };
    }

    const quoteTokenInfo = tokenRepository.getTokenInfo(config.quoteToken.id);
    const baseTokenInfo = tokenRepository.getTokenInfo(config.baseToken.id);

    this.logger.log('Marginly pool not found in state file. Creating new one');

    const one = BigNumber.from(1e6);
    const baseOne = BigNumber.from(10).pow(baseTokenInfo.decimals);
    const quoteOne = BigNumber.from(10).pow(quoteTokenInfo.decimals);
    const params = {
      interestRate: config.params.interestRate*(one).toInteger(),
      fee: config.params.fee*(one).toInteger(),
      maxLeverage: config.params.maxLeverage.toInteger(),
      swapFee: config.params.swapFee*(one).toInteger(),
      mcSlippage: config.params.mcSlippage*(one).toInteger(),
      positionMinAmount: config.params.positionMinAmount*(baseOne).toInteger(),
      quoteLimit: config.params.quoteLimit*(quoteOne).toInteger(),
    };

    let createPoolTx: ethers.ContractTransaction;
    if (timelockOwner) {
      // create new pool through timelock
      const createPoolCallData = marginlyPoolFactoryContract.interface.encodeFunctionData('createPool', [
        quoteTokenInfo.address.toString(),
        baseTokenInfo.address.toString(),
        priceOracle.toString(),
        config.defaultSwapCallData,
        params,
      ]);

      const timelockContract = new ethers.Contract(timelockOwner.toString(), timelockDescription.abi, this.signer);

      createPoolTx = await timelockContract.execute(
        marginlyPoolFactoryContract.address, //target
        0, //value
        createPoolCallData, //calldata
        ethers.constants.HashZero, //predecessor
        ethers.constants.HashZero, //salt
        this.ethArgs //overrides
      );
      await createPoolTx.wait();

      this.logger.log(`Marginly pool created with timelock ${timelockContract.address}`);
    } else {
      // create new pool from factory owner
      createPoolTx = await marginlyPoolFactoryContract.createPool(
        quoteTokenInfo.address.toString(),
        baseTokenInfo.address.toString(),
        priceOracle.toString(),
        config.defaultSwapCallData,
        params,
        this.ethArgs
      );
    }

    const marginlyPoolAddress = await this.getCreatedMarginlyPoolAddress(
      marginlyPoolFactoryContract,
      createPoolTx.hash,
      quoteTokenInfo.address,
      baseTokenInfo.address,
      priceOracle
    );

    this.stateStore.setById(stateFileId, {
      address: marginlyPoolAddress.toString(),
      txHash: createPoolTx.hash,
    });

    const marginlyPoolContract = new ethers.Contract(
      marginlyPoolAddress.toString(),
      marginlyPoolContractDescription.abi,
      this.signer
    );

    // add marginlyPool.setParameters to whitelist timelock
    if (timelockOwner) {
      const timelockContract = new ethers.Contract(timelockOwner.toString(), timelockDescription.abi, this.signer);
      await this.whitelistSetParameters(timelockContract, marginlyPoolContract, params);
    }

    return {
      address: marginlyPoolAddress.toString(),
      txHash: createPoolTx.hash,
      contract: marginlyPoolContract,
    };
  }

  private async whitelistSetParameters(
    timelockContract: ethers.Contract,
    marginlyPoolContract: ethers.Contract,
    params: any
  ): Promise<void> {
    const setParametersMethod = marginlyPoolContract.interface
      .encodeFunctionData('setParameters', [params])
      .slice(0, 10);

    const whitelistMethodCallData = timelockContract.interface.encodeFunctionData('whitelistMethods', [
      [marginlyPoolContract.address],
      [setParametersMethod],
      [true],
    ]);

    const operationId = await timelockContract.hashOperation(
      timelockContract.address, //target
      0,
      whitelistMethodCallData, //calldata
      ethers.constants.HashZero, //predecessor
      ethers.constants.HashZero //salt
    );

    const minDelay = await timelockContract.getMinDelay();

    const target = timelockContract.address;
    const callData = whitelistMethodCallData;
    const predecessor = ethers.constants.HashZero;
    const salt = ethers.constants.HashZero;

    if (await timelockContract.isWhitelisted(marginlyPoolContract.address, setParametersMethod)) {
      this.logger.log('Whitelisted method. Execute operation immediately');

      await (await timelockContract.execute(target, 0n, callData, predecessor, salt)).wait();
    } else if (!(await timelockContract.isOperation(operationId))) {
      this.logger.log('Operation not existed. Schedule operation');

      await (await timelockContract.schedule(target, 0n, callData, predecessor, salt, minDelay)).wait();

      this.logger.log(
        `Scheduled whitelist setParameters of MarginlyPool ${marginlyPoolContract.address} in Timelock ${timelockContract.address}`
      );
    } else if (await timelockContract.isOperationDone(operationId)) {
      this.logger.log('Operation done.');
    } else if (await timelockContract.isOperationReady(operationId)) {
      this.logger.log('Operation ready for execution. Execute operation');

      await (await timelockContract.execute(target, 0n, callData, predecessor, salt)).wait();
    } else if (await timelockContract.isOperationPending(operationId)) {
      const readyTimestamp = await timelockContract.getTimestamp(operationId);
      this.logger.log('Operation pending. Ready at ' + new Date(Number(readyTimestamp) * 1000));
    }
  }

  public deployMarginlyPoolAdmin(marginlyFactoryAddress: EthAddress): Promise<DeployResult> {
    return this.deploy(
      'MarginlyPoolAdmin',
      [marginlyFactoryAddress.toString()],
      'marginlyPoolAdmin',
      this.readMarginlyPeripheryContract
    );
  }

  public async deploySwapPoolRegistry(
    tokenRepository: ITokenRepository,
    uniswapFactory: EthAddress,
    pools: MarginlyConfigSwapPool[],
    priceAdapters: EthAddress[]
  ): Promise<DeployResult> {
    type SwapPool = {
      pool: `0x${string}`;
      tokenA: `0x${string}`;
      tokenB: `0x${string}`;
      fee: BigNumber;
    };

    const swapPools: SwapPool[] = pools.map((p, i) => ({
      tokenA: tokenRepository.getTokenInfo(p.tokenA.id).address.toString(),
      tokenB: tokenRepository.getTokenInfo(p.tokenB.id).address.toString(),
      fee: this.toUniswapFee(p.fee),
      pool: priceAdapters[i].toString(),
    }));

    var deployResult = await this.deploy(
      'SwapPoolRegistry',
      [uniswapFactory.toString(), swapPools],
      'swapPoolRegistry',
      this.readMarginlyPeripheryContract
    );

    var poolsToAdd: SwapPool[] = [];
    var swapPoolRegistry = deployResult.contract;
    for (let i = 0; i < swapPools.length; i++) {
      const swapPoolAddress = await swapPoolRegistry.swapPools(
        swapPools[i].tokenA,
        swapPools[i].tokenB,
        swapPools[i].fee
      );
      if (EthAddress.parse(swapPoolAddress).isZero()) {
        poolsToAdd.push(swapPools[i]);
      }
    }

    if (poolsToAdd.length > 0) {
      const tx = await swapPoolRegistry.addSwapPool(poolsToAdd);
      await tx.wait();
    }

    return deployResult;
  }

  public async deployMarginlyPriceAdapter(
    basePriceProvider: EthAddress,
    quotePriceProvider: EthAddress,
    poolId: string
  ): Promise<DeployResult> {
    return this.deploy(
      'PriceAdapter',
      [basePriceProvider.toString(), quotePriceProvider.toString()],
      `priceAdapter_${poolId}`,
      this.readMarginlyPeripheryContract
    );
  }

  public async deployPriceProviderMock(priceProviderMock: PriceProviderMock, id: string): Promise<DeployResult> {
    return this.deploy(
      'ChainlinkAggregatorV3Mock',
      [
        priceProviderMock.answer*(BigNumber.from(10).pow(priceProviderMock.decimals)).toInteger(),
        priceProviderMock.decimals,
      ],
      `priceProviderMock_${id}`,
      this.readMarginlyPeripheryMockContract
    );
  }
}
