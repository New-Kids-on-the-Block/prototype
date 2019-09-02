import Block from "./block";
import * as server from "./server";
import * as common from "./common";
import { Db } from "mongodb";

(async () => {
    console.log(`Getting current block from the gateway server or create new ledger...`);
    const block = await Block.getCurrentBlockAsync();
    server.listen();

    // main block sync loop
    while (common.appContext.isRunning) {
        const syncPromise = block.syncAsync();
        
        const promises = await Promise.all([
            common.waitAsync(common.appContext.syncThrottleTime),
            syncPromise
        ]);

        const node = common.appContext.config.node;    
        const blockInfo = await syncPromise;

        let transCount = (!blockInfo) ? `NA` : blockInfo.totalTransactions;
        let lastTransactionId = (!blockInfo) ? `NA` : blockInfo.lastTransactionId;
        
        console.log(`node ID: '${node.id}', transactions: ${transCount}, last TID: ${lastTransactionId}.`);
    }

    console.log(`Closing app...`);
    Block.close();
    server.close();
})();