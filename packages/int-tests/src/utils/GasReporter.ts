import { ContractTransaction, ContractTransactionReceipt, ContractTransactionResponse } from 'ethers';
import { logger } from './logger';
import { promises as fsPromises, existsSync } from 'fs';
import { join } from 'path';

type GasUsage = {
  max: bigint;
  min: bigint;
  avg: bigint;
  count: bigint;
};

export class GasReporter {
  private gasUsageStatistics: { [key: string]: GasUsage } = {};
  private gasUsage: { [key: string]: [number, bigint][] } = {};

  constructor(private suiteName: string) {}

  public async saveGasUsage(
    txName: string,
    x: ContractTransactionResponse | Promise<ContractTransactionResponse>
  ): Promise<ContractTransactionReceipt> {
    const resolved = await x;
    let txReceipt = await resolved.wait();

    if (txReceipt === null) {
      throw new Error('Failed to obtain tx receipt');
    }

    const gasUsed = txReceipt.gasUsed;
    const blockNumber = txReceipt.blockNumber;

    logger.debug(`⛽ Gas used: ${txName}    ${gasUsed}`);

    const existedStatistic = this.gasUsageStatistics[txName];
    if (existedStatistic) {
      existedStatistic.max = existedStatistic.max < gasUsed ? gasUsed : existedStatistic.max;
      existedStatistic.min = existedStatistic.min > gasUsed ? gasUsed : existedStatistic.min;
      existedStatistic.avg = (existedStatistic.avg * existedStatistic.count + gasUsed) / (existedStatistic.count + 1n);
      existedStatistic.count++;
    } else {
      this.gasUsageStatistics[txName] = {
        max: gasUsed,
        min: gasUsed,
        avg: gasUsed,
        count: 1n,
      };
    }

    if (!this.gasUsage[txName]) {
      this.gasUsage[txName] = [[blockNumber, gasUsed]];
    } else {
      this.gasUsage[txName].push([blockNumber, gasUsed]);
    }

    return txReceipt;
  }

  public reportToConsole() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const gasUsageStatistics = this.gasUsageStatistics;
    if (Object.keys(gasUsageStatistics).length > 0) {
      setTimeout(function () {
        logger.info('Gas usage statistics');
        console.table(gasUsageStatistics);
      }, 10);
    }
  }

  async saveToFile() {
    const dir = join(__dirname, '../../', '__gas-usage__');

    if (!existsSync(dir)) {
      await fsPromises.mkdir(dir, { recursive: true });
    }

    for (const txName of Object.keys(this.gasUsage)) {
      const data = [`blockNumber,gasUsed\n`];
      for (const [blockNumber, gasUsed] of this.gasUsage[txName]) {
        data.push(`${blockNumber},${gasUsed}\n`);
      }
      const filename = `${this.suiteName}.${txName}.gas.csv`;

      await fsPromises.writeFile(join(dir, filename), data, {
        flag: 'w',
      });
    }
  }
}
