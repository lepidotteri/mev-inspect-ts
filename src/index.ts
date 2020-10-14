import { providers } from 'ethers'
import { ConnectionInfo } from "@ethersproject/web";

import { BlockData } from "./BlockData";
import { InspectorAave } from "./InspectorAave";
import { InspectorUniswap } from "./InspectorUniswap";
import { InspectorGeneric } from "./InspectorGeneric";
import { ConsumerAsciiReport } from "./ConsumerReport";
import { ConsumerInfluxdb } from "./ConsumerInfluxdb";
import { Processor } from "./Processor";

const ETHEREUM_URL = process.env.ETHEREUM_URL || "http://127.0.0.1:8545";
const INFLUX_DB = process.env.INFLUX_DB || 'mev';
const INFLUX_HOST = process.env.INFLUX_HOST || 'localhost';
const MEASUREMENT = process.env.MEASUREMENT || 'gasUsed';

const BLOCK_START = parseInt(process.env.BLOCK_START || '11000000');
const BLOCK_END = process.env.BLOCK_END;


const connection: ConnectionInfo = {url: ETHEREUM_URL}

const provider = new providers.JsonRpcProvider(connection, {chainId: 1, ensAddress: '', name: 'mainnet'})

async function doStuff() {
  const processor = new Processor(
    [
      await InspectorAave.create(provider),
      await InspectorUniswap.create(provider),
      await InspectorGeneric.create(provider)
    ],
    [
      new ConsumerAsciiReport(),
      new ConsumerInfluxdb(INFLUX_HOST, INFLUX_DB, MEASUREMENT)
    ]
  );

  const blockEnd = (BLOCK_END === undefined) ?
    await provider.getBlockNumber() :
    parseInt(BLOCK_END)



  for (let blockNumber = BLOCK_START; blockNumber < blockEnd; blockNumber++) {
    const blockData = await BlockData.createFromBlockNumber(provider, blockNumber, false);
    await processor.process(blockData)
  }
}

doStuff().then( () => {
  console.log("Finished")
  process.exit(0)
}).catch( (e) => {
  console.error("Error", e)
  process.exit(1)
})

