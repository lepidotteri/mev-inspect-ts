import * as _ from "lodash";
import { FieldType, InfluxDB, IPoint } from "influx";
import { BigNumber } from "ethers";

import { Consumer } from "./Consumer";
import { BlockData } from "./BlockData";
import { bigNumberToDecimal } from "./utils";
import { txTypeWithStatus, TransactionEvaluation, TRANSACTION_TYPE } from "./types";

export class ConsumerInfluxdb extends Consumer {
  private influx: InfluxDB;
  private measurement: string;

  constructor(host: string, database: string, measurement: string) {
    super();
    this.measurement = measurement;

    this.influx = new InfluxDB({
      host: host,
      database: database,
      schema: [
        {
          measurement: measurement,
          fields: {
            gasUsed: FieldType.INTEGER,
            ethSpent: FieldType.FLOAT,
            blockNumberField: FieldType.INTEGER,
          },
          tags: [
            'txType',
            'blockNumber',
            'txSuccess'
          ]
        },
      ]
    });
  }

  async dropDatabase(databaseName: string): Promise<void> {
    await this.influx.dropDatabase(databaseName)
    await this.influx.createDatabase(databaseName)
  }

  async consume(blockData: BlockData, transactionEvaluations: Array<TransactionEvaluation>): Promise<void> {
    const txData = new Array<{
      txType: txTypeWithStatus,
      gasUsed: BigNumber,
      gasPrice: BigNumber,
    }>();

    for (const transactionEvaluation of transactionEvaluations) {
      txData.push({
        gasUsed: transactionEvaluation.transactionReceipt.gasUsed,
        gasPrice: transactionEvaluation.transaction.gasPrice,
        txType: transactionEvaluation.inferredType,
      })
    }
    const transactionsByType = _.groupBy(transactionEvaluations,
        transactionEvaluation => JSON.stringify(transactionEvaluation.inferredType));


    const points: Array<IPoint> = _.map(transactionsByType, transactionByType => {
      const txType = transactionByType[0].inferredType
      const gasUsed = _.reduce(transactionByType, (cum, cur) => {
        return cum.add(cur.transactionReceipt.gasUsed)
      }, BigNumber.from(0))
      const ethSpent = _.reduce(transactionByType, (cum, cur) => {
        return cum.add(cur.transaction.gasPrice.mul(cur.transactionReceipt.gasUsed))
      }, BigNumber.from(0))
      return {
        timestamp: blockData.block.timestamp,
        measurement: this.measurement,
        tags: {
          txType: TRANSACTION_TYPE[txType.type],
          txSuccess: `${txType.success}`,
          blockNumber: `${blockData.block.number}`
        },
        fields: {
          blockNumberField: blockData.block.number,
          gasUsed: gasUsed.toNumber(),
          ethSpent: bigNumberToDecimal(ethSpent),
        },
      };
    })
    const zeroPoints = this.generateZeroPoints(blockData);
    const mergedPoints = [...zeroPoints, ...points]
    await this.wipeBlockData(blockData);
    await this.influx.writePoints(mergedPoints, {precision: 's'});
  }

  // The display of Influx is awkward if you don't provide 0 points for missing data, the fill keeps going
  private generateZeroPoints(blockData: BlockData) {
    const zeroPoints = new Array<IPoint>()
    for (const type in [TRANSACTION_TYPE.ARBITRAGE, TRANSACTION_TYPE.UKNOWN, TRANSACTION_TYPE.LIQUIDATION]) {
      for (const txSuccess of ['true', 'false']) {
        zeroPoints.push({
          timestamp: blockData.block.timestamp,
          measurement: this.measurement,
          tags: {txType: TRANSACTION_TYPE[type], txSuccess, blockNumber: blockData.block.number.toString()},
          fields: {blockNumberField: blockData.block.number, gasUsed: 0, ethSpent: 0.0}
        })
      }
    }
    return zeroPoints;
  }

  private async wipeBlockData(blockData: BlockData) {
    await this.influx.dropSeries({
      where: e => e.tag("blockNumber").equals.value(`${blockData.block.number}`)
    })
  }
}