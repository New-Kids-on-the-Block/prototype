import uuid from "uuid/v4";
import * as db from "./db";
import * as common from "./common";
import axios from "axios";

interface Node {
    id: string;
}

interface TransactionConfirmation {
    nodeId: string,
    requestedTime: Date,
    confirmedTime?: Date
}

interface Transaction {
    id: string,
    time: Date,
    from: string,
    to: string,
    amount: number,
    confirmations?: TransactionConfirmation[]
}

interface BlockData {
    nodeId: string,
    prevId?: string;
    transactions: Transaction[];
}

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

    private constructor() {
    }

    private foo = 0;

    public queueTransactions(transactions: any[]) {
        for (const t of transactions) {
            const idx = this.transactionsQueue.findIndex(qt => qt.id === t.id);
            if (idx >= 0) this.transactionsQueue.splice(idx, 1);
            this.transactionsQueue.push(t);
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

        // console.log(this.transactionsQueue);

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

    private async requestConfirmationsAsync(pendingTransactions: any[]): Promise<void> {
        if (!pendingTransactions || pendingTransactions.length === 0) {
            return;
        }

        console.log(`${pendingTransactions.length} pending transactions found, requesting for confirmation...`);
        const gatewayUri = common.appContext.config.app.gatewayUri;
        const response = await axios.get<any>(`${gatewayUri}/nodes`);
        const activeNodes = response.data.activeNodes;

        const confirmCheckPromises = [];
        const confirmationsMap: { [transactionId: string]: any } = {};
        pendingTransactions.forEach(pt => {
            pt.requestTime = new Date().toISOString();
            confirmationsMap[pt.id] = {
                transaction: pt,
                confirmations: []
            };
        });

        for (const node of activeNodes) {
            const promise = axios.post(`http://${node.ip}:${node.port}/transactions/confirm`, pendingTransactions);
            confirmCheckPromises.push(promise);
        }

        const confirmResponses = await Promise.all(confirmCheckPromises);
        console.log(`Checking confirmation result...`);

        const confirmedTransactions = [];
        for (const response of confirmResponses) {
            const nodeUri = response.headers;
            const queueds: any[] = response.data.queueds;
            const invalids: any[] = response.data.invalids;
            for (const ct of queueds) {
                const confirmDetails = confirmationsMap[ct.id];
                const pt = !confirmDetails ? undefined : confirmDetails.transaction;
                if (!pt) {
                    console.error(`Cannot find confirmed transaction in the pending transaction map: ${ct.id}`);
                }

                if (pt.from === ct.from && pt.to === ct.to && pt.amount === ct.amount &&
                    pt.initiateTime === ct.initiateTime && pt.requestTime === ct.requestTime) {

                    confirmDetails.confirmations.push(nodeUri);
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

        await confirmPromises;
    }

    // public isFull(): boolean {
    //     return this._block.transactions.length >= Block.Limit;
    // }

    // public getTransactionCount() {
    //     return this._block.transactions.length;
    // }

    // public addTransaction(from: string, to: string, amount: number): Transaction {
    //     let transaction: Transaction;
    //     if (this.isFull()) {
    //         return undefined;
    //     }

    //     transaction = {
    //         id: uuid(),
    //         time: new Date(),
    //         from: from,
    //         to: to,
    //         amount: amount
    //     };

    //     this._block.transactions.push(transaction);
    //     return transaction;
    // }

    // public addAndConfirmTransactions(transactions: Transaction[]): void {
    //     transactions.map(transaction => {
    //         const pendingConfirmation = transaction.confirmations.find(c => c.nodeId === this._block.nodeId);
    //         // pendingConfirmation.confirmedTime = new Date();
    //     });

    //     this._block.transactions.concat(transactions);
    // }

    // public getUnfonfirmedTransactions(): Transaction[] {
    //     return this._block.transactions.filter(t =>
    //         !t.confirmations || t.confirmations.every(c => !c.confirmedTime));
    // }

    // public getPendingTransactions(): Transaction[] {
    //     return this._block.transactions.filter(t =>
    //         !!t.confirmations && t.confirmations.every(c => !c.confirmedTime));
    // }

    // public toJSON(): string {
    //     return JSON.stringify(this._block);
    // }
}