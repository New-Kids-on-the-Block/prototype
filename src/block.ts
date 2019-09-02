import uuid from "uuid/v4";
import sqlite3 from "sqlite3";

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
    
    private static readonly ledger = new sqlite3.Database("./ledger.db", (error) => {
        if (!!error) throw error;
    });

    private static readonly db = new sqlite3.Database("./app.db", (error) => {
        if (!!error) throw error;
    });

    private readonly appContext: any;

    public static async getCurrentBlockAsync(appContext: any): Promise<Block> {
        const block = new Block(appContext);
        const blockInfo = await block.syncAsync();
        if (!blockInfo) {
            await Block.setupDatabaseAsync(appContext.config.node);
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

    private constructor(appContext: any) {
        this.appContext = appContext;
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

    private static async setupDatabaseAsync(nodeConfig: any): Promise<void> {
        const dbPromise = new Promise((resolve, reject) => {
            Block.db.serialize(() => {
                console.log(`Creating accounts table if not already exists...`);
                Block.db.run(`CREATE TABLE IF NOT EXISTS "accounts" (
                                "id"	        TEXT,
                                "password"	    TEXT,
                                "createTime"	TEXT NOT NULL,
                                PRIMARY KEY("id"));`);
                Block.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "idPassword" ON "accounts" ("id", "password");`);
    
                console.log(`Adding the system account if the accounts is empty.`);
                Block.db.each(`SELECT COUNT(*) as count FROM "accounts";`, (error, row) => {
                    const accountsCount = row["count"];
                    if (accountsCount > 0) {
                        console.log(`Accounts is not empty, system account not needed.`);
                        return;
                    }
    
                    Block.db.run(`INSERT INTO "accounts" VALUES ("system", NULL, "${new Date().toISOString()}");`);
                });
    
                console.log(`Creating nodes tables if not already exists...`);
                Block.db.run(`CREATE TABLE IF NOT EXISTS "nodes" (
                                "id"	        TEXT,
                                "createTime"	TEXT NOT NULL,
                                "accountId"	    TEXT NOT NULL,
                                "ip"	        TEXT NOT NULL,
                                "port"	        NUMERIC NOT NULL,
                                "status"	    TEXT NOT NULL,
                                "lastPulseTime"	TEXT,
                                PRIMARY KEY("id"),
                                FOREIGN KEY("accountId") REFERENCES "accounts"("id"));`);
                Block.db.run(`CREATE INDEX IF NOT EXISTS "accountStatusPulse" ON "nodes" ("accountId", "status", "lastPulseTime");`);
    
                console.log(`Creating transactions tables if not already exists...`);
                Block.db.run(`CREATE TABLE IF NOT EXISTS "pendingTransactions" (
                                "id"	        TEXT,
                                "initiateTime"	TEXT NOT NULL,
                                "from"          TEXT NOT NULL,
                                "to"	        TEXT NOT NULL,
                                "amount"	    NUMERIC NOT NULL,
                                PRIMARY KEY("id"));`);
                    Block.db.run(`CREATE INDEX IF NOT EXISTS "timeFrom" ON "pendingTransactions" ("initiatedTime", "from");`);
    
                console.log(`Adding as new a new node if the node ip, port doesn't exist.`);
                Block.db.each(
                    `SELECT COUNT(*) as count FROM "nodes" WHERE "id" = "${nodeConfig.id}" AND
                    "ip" = "${nodeConfig.ip}" AND "port" = "${nodeConfig.port}";`,
                    (error, row) => {
                        const nodesCount = row["count"];
                        if (nodesCount > 0) {
                            console.log(`Node: ${nodeConfig.id}:${nodeConfig.ip}:${nodeConfig.port} already exists.`);
                            resolve();
                            return;
                        }
    
                        Block.db.run(
                            `INSERT INTO "nodes" VALUES (
                            "${nodeConfig.id}", "${new Date().toISOString()}",
                            "${nodeConfig.ownerId}", "${nodeConfig.ip}", ${nodeConfig.port},
                            "inactive", NULL);`, (error) => {
                                if (!!error) {
                                    throw error;
                                }

                                resolve();
                            });
                    });
            });
        });

        const ledgerPromise = new Promise((resolve, reject) => {
            Block.ledger.serialize(() => {
                Block.ledger.run(`CREATE TABLE IF NOT EXISTS "transactions" (
                                    "id"	        TEXT,
                                    "initiateTime"  TEXT NOT NULL,
                                    "from"	        TEXT,
                                    "to"	        TEXT NOT NULL,
                                    "amount"	    NUMERIC NOT NULL,
                                    "requestTime"   TEXT NOT NULL,
                                    "confirmTime"   TEXT NOT NULL,
                                    PRIMARY KEY("id"));`);
                Block.ledger.run(`CREATE INDEX IF NOT EXISTS "timeFrom" ON "transactions" ("initiatedTime", "from");`);
                Block.ledger.run(`CREATE INDEX IF NOT EXISTS "timeTo" ON "transactions" ("initiatedTime", "to");`);
    
                Block.ledger.run(`CREATE TABLE IF NOT EXISTS "confirmationDetails" (
                                    "confirmTime"   TEXT NOT NULL,
                                    "transactionId" TEXT NOT NULL,
                                    "requestNodeId" TEXT NOT NULL,
                                    "confirmNodeId"	TEXT NOT NULL,
                                    PRIMARY KEY("confirmTime", "transactionId", "requestNodeId", "confirmNodeId"));`);
    
                console.log(`Adding the first transaction if the ledger is empty.`);
                Block.ledger.each(`SELECT COUNT(*) FROM transactions;`, (error, row) => {
                    const totalTransactions = row["COUNT(*)"];
                    if (totalTransactions > 0) {
                        console.log(`Transaction not empty, first transaction not needed.`);
                        resolve();
                        return;
                    }
    
                    Block.ledger.run(
                        `INSERT INTO transactions VALUES (
                        "${uuid()}",
                        "${new Date().toISOString()}",
                        NULL,
                        "system",
                        1000000000,
                        "${new Date().toISOString()}",
                        "${new Date().toISOString()}");`, (error) => {
                            if (!!error) {
                                throw error;
                            }

                            resolve();
                        });
                });
            });
        });

        await Promise.all([dbPromise, ledgerPromise]);
    }
}