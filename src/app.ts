import Block from "./block";
import * as node from "./node";
import * as common from "./common";

/**
 * The node gets general information from the gateway node. Any node can be the gateway node after gaining enough respect.
 * On sync request from child nodes, the node queue up the changes to be applied on the sync interval.
 * On the sync interval, process the queued up changes, drop the conflicts, process local changes, drop the conflicts.
 * Then requested to every active peer nodes - double round process, then complete the sync.
 * Authentication will be delegated/maintained in gateway nodes - common nodes only keep ledger.
 */
(async () => {
    console.log(`Getting current block from the gateway node or create new ledger...`);
    const block = await Block.getBlockAsync();
    node.listen();

    // main block sync loop
    while (common.appContext.isRunning) {
        const syncPromise = block.syncLedgerAsync();
        const promises = await Promise.all([
            common.waitAsync(common.appContext.syncThrottleTime),
            syncPromise
        ]);

        const node = common.appContext.config.node;    
        const syncResult = await syncPromise;

        const queuedCount = (!syncResult) ? `NA` : syncResult.total;
        const initCount = (!syncResult) ? `NA` : syncResult.initiatedTransactions.length;
        const requestedCount = (!syncResult) ? `NA` : syncResult.requestedTransactions.length;
        const confirmedCount = (!syncResult) ? `NA` : syncResult.confirmedTransactions.length;
        const failedCount = (!syncResult) ? `NA` : syncResult.failedTransactions.length;
        
        console.log(`Node: '${node.id}', Total: ${queuedCount}, Init: ${initCount}, Req: ${requestedCount}, Confirmed: ${confirmedCount}. Failed: ${failedCount}.`);
    }

    console.log(`Closing app...`);
    Block.close();
    node.close();
})();