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

interface BlockInfo {
    totalTransactions: number;
    lastTransactionId: string;
}

export default class Block {
    private static readonly Limit = 1000;

    private readonly queue: {
        transactions: any[],
        accounts: any[],
        nodes: any[]
    } = {
            transactions: [],
            accounts: [],
            nodes: []
        };

    public static close() {
        db.close();
    }

    public static async getCurrentBlockAsync(): Promise<Block> {
        const block = new Block();
        const blockInfo = await block.syncAsync();
        if (!blockInfo) {
            await db.setupDatabaseAsync();
        }

        return block;
    }

    private constructor() {
    }

    /**
     * Loops queued transactions, if exists already check, log, and skip or report.
     * For pending transactions, group them and send for confirmations.
     */
    public async syncAsync(): Promise<BlockInfo> {
        const pendingTransactions = [];
        for (const queuedTransaction of this.queue.transactions) {
            let transaction = await db.getTransactionAsync(queuedTransaction.id);
            if (!!transaction) {
                console.log(`Transaction ${queuedTransaction.id} already exists. Checking...`);
                return;
            }

            if (!queuedTransaction.requestTime && !queuedTransaction.confirmTime) {
                pendingTransactions.push(queuedTransaction);
            } else if (!!queuedTransaction.requestTime && !!queuedTransaction.confirmTime) {
                await db.postTransactionAsync(queuedTransaction);
            } else {
                console.error(`Impossible - ${queuedTransaction}.`);
            }
        }

        console.log(`${pendingTransactions.length} pending transactions found, requesting for confirmation...`);
        await this.requestConfirmationsAsync(pendingTransactions);

        const blockInfo = {
            totalTransactions: 100,
            lastTransactionId: uuid()
        };

        return undefined;
    }

    private async requestConfirmationsAsync(pendingTransactions: any[]): Promise<void> {
        const gatewayUri = common.appContext.config.app.gatewayUri;
        const response = await axios.get<any>(`${gatewayUri}/nodes`);
        console.log(response.data);

        const confirmCheckPromises = [];
        pendingTransactions.forEach(pt => {
            pt.requestTime = new Date();
        });

        const nodes = response.data.nodes;
        for (const node of nodes) {
            const promise = axios.post(`http://${node.ip}:${node.port}/transactions/confirm`, pendingTransactions);
            confirmCheckPromises.push(promise);
        }

        const confirmResponses = await Promise.all(confirmCheckPromises);
        console.log(`Checking confirmation result...`);
        const confirmationsMap: { [transactionId: string]: any } = {};
        for (const transaction of pendingTransactions) {
            confirmationsMap[transaction.id] = {
                transaction: transaction,
                confirmations: []
            };
        }

        const confirmedTransactions = [];
        for (const response of confirmResponses) {
            const nodeUri = response.headers;
            const transactions: any[] = response.data;
            for (const ct of transactions) {
                const confirmDetails = confirmationsMap[ct.id];
                const pt = confirmationsMap.transaction;

                if (pt.from === ct.from && pt.to === ct.to === pt.amount === ct.amount &&
                    pt.initiateTime === ct.initiateTime && pt.requestTime === ct.requestTime) {
                    
                    confirmDetails.confirmations.push(nodeUri);
                    if (confirmDetails.confirmations.length >= nodes.length) {
                        ct.confirmTime = new Date();
                        confirmedTransactions.push(ct);
                    }
                } else {
                    console.error(`In correct transactions received - investigate.`);
                }
            }
        }

        const confirmPromises = [];
        for (const node of nodes) {
            const promise = axios.patch(`http://${node.ip}:${node.port}/transactions/confirm`, pendingTransactions);
            confirmPromises.push(promise);
        }
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