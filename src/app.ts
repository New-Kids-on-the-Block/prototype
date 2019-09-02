import Net from "net";
import uuid from "uuid/v4";
import sqlite3 from "sqlite3";
import config from "config";
import crypto from "crypto";
import Block from "./block";
import * as server from "./server";
import * as helper from "./helper";

const appContext = {
    isRunning: true,
    syncThrottleTime: 2000,
    config: {
        app: config.get<any>("app"),
        node: config.get<any>("node")
    }
};

(async () => {
    console.log(`Getting current block from the gateway server or create new ledger...`);
    const block = await Block.getCurrentBlockAsync(appContext);
    server.listen(appContext);

    // main block sync loop
    while (appContext.isRunning) {
        const syncPromise = block.syncAsync();
        
        const promises = await Promise.all([
            helper.waitAsync(appContext.syncThrottleTime),
            syncPromise
        ]);

        const blockInfo = await syncPromise;
        if (!!blockInfo)
            console.log(`node ID: '${appContext.config.node.id}', transactions: ${blockInfo.totalTransactions}, last TID: ${blockInfo.lastTransactionId}.`);
    }
})();