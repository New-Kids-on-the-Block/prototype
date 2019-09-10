import * as db from "./db";
import * as common from "./common";
import axios from "axios";

interface SyncResult {
    total: number,
    initiatedTransactions: any[],
    requestedTransactions: any[],
    confirmedTransactions: any[],
    failedTransactions: any[]
}

export default class Block {
    private static readonly Limit = 1000;
    private static instance: Block;

    private readonly transactionsQueue: any[] = [];
    private queue: any[] = [];

    public static close() {
        db.close();
    }

    public static async getBlockAsync(): Promise<Block> {
        if (!this.instance) {
            console.log(`Creating new instance...`);
            this.instance = new Block();
            // download ledger from the gateway or
            await db.setupDatabaseAsync();
        }

        return this.instance;
    }

    public queueTransactions(transactions: any[]) {
        for (const t of transactions) {
            const idx = this.transactionsQueue.findIndex(qt => qt.id === t.id);
            if (idx >= 0) this.transactionsQueue.splice(idx, 1);
            this.transactionsQueue.push(t);
        }
    }

    public async waitConfirmTransactionsAsync(transactions: any[], timeout: number): Promise<{ error?: any }> {
        let elapsedTime = 0;
        const confirmedTransactions = [];
        const pendingTransactions = [...transactions];

        while (elapsedTime < timeout || confirmedTransactions.length === transactions.length) {
            await common.waitAsync(500);
            elapsedTime += 500;

            let t: any;
            while (t = pendingTransactions.pop()) {
                const found = await db.getTransactionAsync(t.id);
                if (!found) confirmedTransactions.push(t);
                else pendingTransactions.push(t);
            }
        }

        if (elapsedTime > timeout) {
            return { error: true };
        } else {
            return { error: false };
        }
    }

    /**
     * Loops queued transactions, if exists already check, log, and skip or report.
     * For pending transactions, group them and send for confirmations.
     */
    public async syncLedgerAsync(): Promise<SyncResult> {
        const queuedCount = this.transactionsQueue.length;
        const initiatedTransactions: any[] = [];
        const confirmRequested: any[] = [];
        const confirmed: any[] = [];
        const failed: any[] = [];

        let t: any;
        while (t = this.transactionsQueue.pop()) {
            if (!!t.initiateTime && !t.requestTime && !t.confirmTime) {
                initiatedTransactions.push(t);

            } else if (!!t.initiateTime && !!t.requestTime && !t.confirmTime) {
                confirmRequested.push(t);

            } else if (!!t.initiateTime && !!t.requestTime && !!t.confirmTime) {
                let existingTransaction = await db.getTransactionAsync(t.id);
                if (!!existingTransaction) {
                    console.log(`Transaction ${t.id} already exists. Checking...`);
                    failed.push(t);
                    continue;
                }

                console.log(`Posting confirmed transactions to the ledger... ${t.id}`);
                const result = await db.postTransactionAsync(t);
                if (!!result) confirmed.push(t);
                else failed.push(t);
            } else failed.push(t);
        }

        await this.requestConfirmationsAsync(initiatedTransactions);
        this.queueTransactions(confirmRequested);
        this.queueTransactions(initiatedTransactions);
        this.queueTransactions(failed);

        return {
            total: queuedCount,
            initiatedTransactions: initiatedTransactions,
            requestedTransactions: confirmRequested,
            confirmedTransactions: confirmed,
            failedTransactions: failed
        };
    }

    private async requestConfirmationsAsync(initiatedTransactions: any[]): Promise<void> {
        if (!initiatedTransactions || initiatedTransactions.length === 0) {
            return;
        }

        console.log(`${initiatedTransactions.length} transactions initiated, requesting for confirmation...`);
        const gatewayUri = common.appContext.config.app.gatewayUri;
        const response = await axios.get<any>(`${gatewayUri}/nodes`);
        const activeNodes = response.data.activeNodes;

        const confirmCheckPromises = [];
        const confirmationsMap: { [transactionId: string]: any } = {};
        initiatedTransactions.forEach(pt => {
            pt.requestTime = new Date().toISOString();
            confirmationsMap[pt.id] = {
                transaction: pt,
                confirmations: []
            };
        });

        for (const node of activeNodes) {
            const promise = axios.post(`http://${node.ip}:${node.port}/transactions/confirm/request`, initiatedTransactions);
            confirmCheckPromises.push(promise);
        }

        const confirmCheckResponses = await Promise.all(confirmCheckPromises);
        console.log(`Checking confirmation result...`);

        const confirmedTransactions = [];
        for (const response of confirmCheckResponses) {
            const confirmUri = response.config.url;
            const queueds: any[] = response.data.queueds;
            const invalids: any[] = response.data.invalids;
            for (const ct of queueds) {
                const confirmDetails = confirmationsMap[ct.id];
                const it = !confirmDetails ? undefined : confirmDetails.transaction;
                if (!it) {
                    console.error(`Cannot find confirmed transaction in the initiated transaction map: ${ct.id}`);
                }

                if (it.from === ct.from && it.to === ct.to && it.amount === ct.amount &&
                    it.initiateTime === ct.initiateTime && it.requestTime === ct.requestTime) {

                    confirmDetails.confirmations.push(confirmUri);
                    if (confirmDetails.confirmations.length >= activeNodes.length) {
                        ct.confirmTime = new Date().toISOString();
                        confirmedTransactions.push(ct);
                    }
                } else {
                    console.error(`Incorrect transactions received - investigate.`);
                }
            }
        }

        const confirmPromises = [];
        for (const node of activeNodes) {
            const promise = axios.post(`http://${node.ip}:${node.port}/transactions/confirm`, confirmedTransactions);
            confirmPromises.push(promise);
        }

        const confirmResponses = await confirmPromises;
        if (confirmResponses.every(async c => (await c).status === 200)) {
            console.log(`Confirmation verified in all requested nodes, ${confirmResponses.length}. Storing details...`);

            for (const tid in confirmationsMap) {
                const confirmedTransaction = confirmationsMap.transaction;
                const queuedTransaction = this.queue.find(t => t.id === tid);
                queuedTransaction.confirmTime = confirmedTransaction.confirmTime;

                const confirmations = confirmationsMap[tid].confirmations;
                console.log(confirmationsMap[tid]);
                // await db.postConfirmationsAsync(tid, confirmations);
            }
        }
    }
}