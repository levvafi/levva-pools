import { task } from 'hardhat/config';
import { ethers } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  Ownable2Step__factory,
  TimelockWhitelist,
  TimelockWhitelist__factory,
  MockMarginlyPool__factory,
  MockMarginlyFactory__factory,
} from '../typechain-types';

import { saveDeploymentData, verifyContract, SignerArgs, getSigner, taskWithSigner } from './utils';
import { MarginlyParamsStruct } from '../typechain-types/contracts/test/MockMarginlyFactory.sol/MockMarginlyFactory';
import { MARGINLY_ROUTER_ABI } from './abi';

//npx hardhat --network holesky --config hardhat.config.ts deploy-timelock --signer <private-key>
taskWithSigner('deploy-timelock', 'Deploy timelock contract and transfer ownership from router').setAction(
  async (taskArgs: SignerArgs, hre: HardhatRuntimeEnvironment) => {
    //@ts-ignore
    const signer = await getSigner(taskArgs, hre.ethers.provider);

    const configDir = `../deployment/${hre.network.name}`;

    const initialMinDelay = 0;
    const proposers = ['0x0562F16415fCf6fb5ACAF433e4796f8f328b7C7d', '0x29e3749A862D8eC96d5C055736117D2148A0004a'];
    const executors = ['0x0562F16415fCf6fb5ACAF433e4796f8f328b7C7d', '0x29e3749A862D8eC96d5C055736117D2148A0004a'];
    const admin = ethers.ZeroAddress;

    const marginlyFactoryInterface = MockMarginlyFactory__factory.createInterface();
    const marginlyPoolInterface = MockMarginlyPool__factory.createInterface();

    const createPoolSignature = marginlyFactoryInterface.getFunction('createPool').selector;
    const setParametersSignature = marginlyPoolInterface.getFunction('setParameters').selector;

    const whitelistedTargets = [];
    const whitelistedMethods = [];

    const timelock = (await new TimelockWhitelist__factory(signer).deploy(
      initialMinDelay,
      proposers,
      executors,
      admin,
      whitelistedTargets,
      whitelistedMethods
    )) as any as TimelockWhitelist;
    const timelockAddress = await timelock.getAddress();
    await timelock.waitForDeployment();
    const deploymentTx = timelock.deploymentTransaction()!;
    const txReceipt = await deploymentTx.wait();
    const txHash = txReceipt!.hash;

    const deploymentData = {
      TimelockController: {
        address: timelockAddress,
        txHash: txHash,
        blockNumber: txReceipt?.blockNumber,
      },
    };

    await saveDeploymentData('TimelockWhitelist', deploymentData, configDir);

    await verifyContract(hre, timelockAddress, [initialMinDelay, proposers, executors, admin]);
  }
);

//npx hardhat --network holesky --config hardhat.config.ts factory-transfer-ownership --private-key <private-key>
taskWithSigner('factory-transfer-ownership', 'Change factory owner to timelock').setAction(
  async (taskArgs: SignerArgs, hre: HardhatRuntimeEnvironment) => {
    //@ts-ignore
    const signer = await getSigner(taskArgs, hre.ethers.provider);

    const timelockAddress = '';
    const factoryAddress = '';
    31;
    const minDelay = 259_200; //3 days, 3 * 24 * 60 * 60

    const router = Ownable2Step__factory.connect(factoryAddress, signer);
    const timelock = TimelockWhitelist__factory.connect(timelockAddress, signer);

    await (await router.connect(signer).transferOwnership(timelockAddress)).wait();
    console.log('\nTransfer ownership from factory to timelock');

    // Timelock accept ownership
    const acceptOwnershipCallData = router.interface.encodeFunctionData('acceptOwnership');
    await (
      await timelock
        .connect(signer)
        .schedule(factoryAddress, 0n, acceptOwnershipCallData, ethers.ZeroHash, ethers.ZeroHash, 0)
    ).wait();
    console.log('Scheduled accept ownership from factory to timelock');

    await (
      await timelock
        .connect(signer)
        .execute(factoryAddress, 0n, acceptOwnershipCallData, ethers.ZeroHash, ethers.ZeroHash)
    ).wait();
    console.log('Executed accept ownership from factory to timelock');

    // Timelock update minDelay
    const updateMinDelay = timelock.interface.encodeFunctionData('updateDelay', [minDelay]);
    await (
      await timelock.connect(signer).schedule(timelock, 0n, updateMinDelay, ethers.ZeroHash, ethers.ZeroHash, 0)
    ).wait();
    console.log('Scheduled update minDelay from 0 to 3 days');

    await (
      await timelock.connect(signer).execute(timelock, 0n, updateMinDelay, ethers.ZeroHash, ethers.ZeroHash)
    ).wait();
    console.log('Executed update minDelay from 0 to 3 days');
  }
);

//npx hardhat --network ethereum --config hardhat.config.ts timelock-execute --keystore path-to-keystore-file
taskWithSigner('timelock-execute', 'Timelock schedule and execute operation').setAction(
  async (taskArgs: SignerArgs, hre: HardhatRuntimeEnvironment) => {
    //@ts-ignore
    const signer = await getSigner(taskArgs, hre.ethers.provider);

    const timelockAddress = '0x8cDAf202eBe2f38488074DcFCa08c0B0cB7B8Aa5';
    const timelock = TimelockWhitelist__factory.connect(timelockAddress, signer);

    const predecessor = ethers.ZeroHash;
    const salt = ethers.ZeroHash;

    // Timelock execute
    const target = ''; // target address
    const parameters: MarginlyParamsStruct = {
      maxLeverage: 0n,
      interestRate: 0n,
      fee: 0n,
      swapFee: 0n,
      mcSlippage: 0n,
      positionMinAmount: 0n,
      quoteLimit: 0n,
    };

    const callData = new MockMarginlyPool__factory(signer).interface.encodeFunctionData('setParameters', [parameters]);
    const method = callData.slice(0, 10);
    const delay = await timelock.getMinDelay();

    const operationId = await timelock.hashOperation(target, 0n, callData, predecessor, salt);

    if (await timelock.isWhitelisted(target, method)) {
      console.log('Whitelisted method. Execute operation immediately');

      await (await timelock.execute(target, 0n, callData, predecessor, salt)).wait();
    } else if (!(await timelock.isOperation(operationId))) {
      console.log('Operation not existed. Schedule operation');

      await (await timelock.schedule(target, 0n, callData, predecessor, salt, delay)).wait();
    } else if (await timelock.isOperationDone(operationId)) {
      console.log('Operation done.');
    } else if (await timelock.isOperationReady(operationId)) {
      console.log('Operation ready for execution. Execute operation');

      await (await timelock.execute(target, 0n, callData, predecessor, salt)).wait();
    } else if (await timelock.isOperationPending(operationId)) {
      const readyTimestamp = await timelock.getTimestamp(operationId);
      console.log('Operation pending. Ready at ', new Date(Number(readyTimestamp) * 1000));
    }
  }
);

//npx hardhat --network holesky --config hardhat.config.ts timelock-router-add-adapter --signer <private-key>
taskWithSigner('timelock-router-add-adapter', 'Timelock schedule and execute operation').setAction(
  async (taskArgs: SignerArgs, hre: HardhatRuntimeEnvironment) => {
    //@ts-ignore
    const signer = await getSigner(taskArgs, hre.ethers.provider);

    const timelockAddress = '0xc71968f413bF7EDa0d11629e0Cedca0831967cD3';
    const timelock = TimelockWhitelist__factory.connect(timelockAddress, signer);

    const predecessor = ethers.ZeroHash;
    const salt = ethers.ZeroHash;

    // Marginly router address
    const target = '0x6eC48569A33E9465c5325ff205Afa81209C33F31'; // target address
    const marginlyRouter = new ethers.Contract(target, MARGINLY_ROUTER_ABI);
    const adapterAddress = '0xBdf6114EE6466B4c52f4A85C587d28DB5f3eFF5f'; // new adapter to add

    const dexAdapter = {
      dexIndex: 30,
      adapter: adapterAddress,
    };

    const callData = marginlyRouter.interface.encodeFunctionData('addDexAdapters', [[dexAdapter]]);
    const method = callData.slice(0, 10);
    const delay = await timelock.getMinDelay();

    console.log(`Generated calldata`);
    console.log(callData);

    const operationId = await timelock.hashOperation(target, 0n, callData, predecessor, salt);

    if (await timelock.isWhitelisted(target, method)) {
      console.log('Whitelisted method. Execute operation immediately');

      await (await timelock.execute(target, 0n, callData, predecessor, salt)).wait();
    } else if (!(await timelock.isOperation(operationId))) {
      console.log('Operation not existed. Schedule operation');

      await (await timelock.schedule(target, 0n, callData, predecessor, salt, delay)).wait();
    } else if (await timelock.isOperationDone(operationId)) {
      console.log('Operation done.');
    } else if (await timelock.isOperationReady(operationId)) {
      console.log('Operation ready for execution. Execute operation');

      await (await timelock.execute(target, 0n, callData, predecessor, salt)).wait();
    } else if (await timelock.isOperationPending(operationId)) {
      const readyTimestamp = await timelock.getTimestamp(operationId);
      console.log('Operation pending. Ready at ', new Date(Number(readyTimestamp) * 1000));
    }
  }
);
