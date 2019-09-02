import uuid from "uuid/v4";
import sqlite3 from "sqlite3";
import * as db from "./db";
import * as common from "./common";

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

// const appConfig: any = config.get("app");
// const nodeConfig: any = config.get("node");

// const app = express();
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

export default class Block {
    private static readonly Limit = 1000;

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

    public async syncAsync(): Promise<BlockInfo> {
        const blockInfo = {
            totalTransactions: 100,
            lastTransactionId: uuid()
        };

        return undefined;
    }

    private constructor() {
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