import sqlite3 from "sqlite3";
import uuid from "uuid/v4";
import * as common from "./common";
import { Db } from "mongodb";
import assert = require("assert");

const ledger = new sqlite3.Database("./ledger.db", (error) => {
    if (!!error) console.error(error);
});

const data = new sqlite3.Database("./data.db", (error) => {
    if (!!error) console.error(error);
});

export async function setupDatabaseAsync(): Promise<void> {
    const nodeConfig = common.appContext.config.node;
    const dbPromise = new Promise((resolve, reject) => {
        data.serialize(() => {
            console.log(`Creating accounts table if not already exists...`);
            data.run(`CREATE TABLE IF NOT EXISTS "accounts" (
                            "id"	        TEXT,
                            "password"	    TEXT,
                            "createTime"	TEXT NOT NULL,
                            PRIMARY KEY("id"));`);
            data.run(`CREATE UNIQUE INDEX IF NOT EXISTS "idPassword" ON "accounts" ("id", "password");`);

            console.log(`Adding the system account if the accounts is empty.`);
            data.each(`SELECT COUNT(*) as count FROM "accounts";`, (error, row) => {
                const accountsCount = row["count"];
                if (accountsCount > 0) {
                    console.log(`Accounts is not empty, system account not needed.`);
                    return;
                }

                data.run(`INSERT INTO "accounts" VALUES ("system", NULL, "${new Date().toISOString()}");`);
            });

            console.log(`Creating nodes tables if not already exists...`);
            data.run(`CREATE TABLE IF NOT EXISTS "nodes" (
                            "id"	        TEXT,
                            "createTime"	TEXT NOT NULL,
                            "accountId"	    TEXT NOT NULL,
                            "ip"	        TEXT NOT NULL,
                            "port"	        NUMERIC NOT NULL,
                            "status"	    TEXT NOT NULL,
                            "lastPulseTime"	TEXT,
                            PRIMARY KEY("id"),
                            FOREIGN KEY("accountId") REFERENCES "accounts"("id"));`);
            data.run(`CREATE INDEX IF NOT EXISTS "accountStatusPulse" ON "nodes" ("accountId", "status", "lastPulseTime");`);

            console.log(`Creating transactions tables if not already exists...`);
            data.run(`CREATE TABLE IF NOT EXISTS "pendingTransactions" (
                            "id"	        TEXT,
                            "initiateTime"	TEXT NOT NULL,
                            "from"          TEXT NOT NULL,
                            "to"	        TEXT NOT NULL,
                            "amount"	    NUMERIC NOT NULL,
                            PRIMARY KEY("id"));`);
            data.run(`CREATE INDEX IF NOT EXISTS "timeFrom" ON "pendingTransactions" ("initiatedTime", "from");`);

            console.log(`Adding as new a new node if the node ip, port doesn't exist.`);
            data.each(
                `SELECT COUNT(*) as count FROM "nodes" WHERE "id" = "${nodeConfig.id}" AND
                "ip" = "${nodeConfig.ip}" AND "port" = "${nodeConfig.port}";`,
                (error, row) => {
                    const nodesCount = row["count"];
                    if (nodesCount > 0) {
                        console.log(`Node: ${nodeConfig.id}:${nodeConfig.ip}:${nodeConfig.port} already exists.`);
                        resolve();
                        return;
                    }

                    data.run(
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
        ledger.serialize(() => {
            ledger.run(`CREATE TABLE IF NOT EXISTS "transactions" (
                                "id"	        TEXT,
                                "initiateTime"  TEXT NOT NULL,
                                "from"	        TEXT,
                                "to"	        TEXT NOT NULL,
                                "amount"	    NUMERIC NOT NULL,
                                "requestTime"   TEXT NOT NULL,
                                "confirmTime"   TEXT NOT NULL,
                                PRIMARY KEY("id"));`);
            ledger.run(`CREATE INDEX IF NOT EXISTS "timeFrom" ON "transactions" ("initiatedTime", "from");`);
            ledger.run(`CREATE INDEX IF NOT EXISTS "timeTo" ON "transactions" ("initiatedTime", "to");`);

            ledger.run(`CREATE TABLE IF NOT EXISTS "confirmationDetails" (
                                "confirmTime"   TEXT NOT NULL,
                                "transactionId" TEXT NOT NULL,
                                "requestNodeId" TEXT NOT NULL,
                                "confirmNodeId"	TEXT NOT NULL,
                                PRIMARY KEY("confirmTime", "transactionId", "requestNodeId", "confirmNodeId"));`);

            console.log(`Adding the first transaction if the ledger is empty.`);
            ledger.each(`SELECT COUNT(*) FROM transactions;`, (error, row) => {
                const totalTransactions = row["COUNT(*)"];
                if (totalTransactions > 0) {
                    console.log(`Transaction not empty, first transaction not needed.`);
                    resolve();
                    return;
                }

                ledger.run(
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

export async function getBalanceAsync(id: string): Promise<{ amount: number }> {
    id = id.toLowerCase();

    return new Promise((resolve, reject) => {
        let receiveAmount = 0;
        let sendAmount = 0;

        ledger.each(
            `SELECT sum(t1.amount) as "receiveAmount",
            (SELECT sum(t2.amount) from transactions t2 WHERE "from" = "${id}") as "sendAmount"
            from transactions t1 WHERE "to" = "${id}";`,
            (error, row) => {
                if (!!row["receiveAmount"]) receiveAmount = row["receiveAmount"];
                if (!!row["sendAmount"]) sendAmount = row["sendAmount"];
            }, (error) => {
                if (!!error) {
                    reject(error);
                    return;
                }

                resolve({
                    amount: receiveAmount - sendAmount
                });
            });
    });
}

export async function getAccountsAsync(limit: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        data.each(
            `SELECT id, createTime from accounts ORDER BY createTime DESC LIMIT ${limit};`,
            (error, row) => {
                rows.push(row);
            }, (error) => {
                if (!!error) {
                    console.error(error);
                    reject(error);
                }

                resolve(rows);
            });
    });
}

export async function postAccountAsync(id: string, encryptedPwd: string): Promise<any> {
    id = id.toLowerCase();

    return new Promise((resolve, reject) => {
        data.run(`INSERT INTO "accounts" VALUES ("${id}", "${encryptedPwd}", "${new Date().toISOString()}");`,
            async (error) => {
                if (!!error) {
                    reject(error);
                }

                const accounts = await getAccountsAsync(1);
                resolve(accounts[0]);
            });
    });
}

export async function getTransactionAsync(id: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        ledger.each(`SELECT * from transactions WHERE "id" = "${id}"`, (error, row) => {
            rows.push(row);
        }, (error) => {
            if (!!error) {
                console.error(error);
                reject(error);
            }

            const transaction: any = rows.length === 1 ? rows[0] : undefined;
            // if (!transaction) console.warn(`Transaction with id ${id}, not found.`);

            resolve(transaction);
        });
    });
}
export async function getTransactionsAsync(accountId: string, limit: number, fromTime?: Date, toTime?: Date): Promise<any[]> {
    accountId = accountId.toLowerCase();

    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        ledger.each(`SELECT * from transactions WHERE "from" = "${accountId}" or "to" = "${accountId}"
                ORDER BY confirmTime DESC LIMIT ${limit};`,
            (error, row) => {
                rows.push(row);
            }, (error) => {
                if (!!error) {
                    console.error(error);
                    reject(error);
                }

                resolve(rows);
            });
    });
}

export async function getPendingTransactionsAsync(): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        data.each(
            `SELECT * from "pendingTransactions" ORDER BY initiateTime DESC;`,
            (error, row) => {
                rows.push(row);
            }, (error) => {
                if (!!error) {
                    console.error(error);
                    reject(error);
                }

                resolve(rows);
            });
    });
}

export async function initiateTransactionAsync(from: string, to: string, amount: number): Promise<any> {
    from = from.toLowerCase();
    to = to.toLowerCase();

    return new Promise(async (resolve, reject) => {
        const balance = await getBalanceAsync(from);
        if (balance.amount < amount) {
            reject({
                error: {
                    code: "notEnoughBalance",
                    message: `Not enough balance, amount requested: ${amount} > balance: ${balance.amount}.`
                }
            });
            return;
        }

        ledger.run(`INSERT INTO "pendingTransactions" VALUES (
            "${uuid()}",
            "${new Date().toISOString()}",
            "${from}",
            "${to}",
            ${amount});`,
            async (error) => {
                if (!!error) {
                    reject(error);
                }

                const pendingTransactions = await getPendingTransactionsAsync();
                resolve(pendingTransactions[0]);
            });
    });
}

export async function postTransactionAsync(confirmedTransaction: any): Promise<any> {
    return new Promise(async (resolve, reject) => {
        const balance = await getBalanceAsync(confirmedTransaction.from);
        if (balance.amount < confirmedTransaction.amount) {
            console.error(`Transaction cannot be posted due to not enough balance.`);
            reject({
                error: {
                    code: "notEnoughBalance",
                    message: `Not enough balance, amount requested: ${confirmedTransaction.from} > balance: ${balance.amount}.`
                }
            });

            return;
        }

        ledger.run(
            `INSERT INTO "transactions" VALUES (
            "${confirmedTransaction.id}",
            "${confirmedTransaction.initiateTime}",
            "${confirmedTransaction.from}",
            "${confirmedTransaction.to}",
            ${confirmedTransaction.amount},
            "${confirmedTransaction.requestTime}",
            "${confirmedTransaction.confirmTime}");`, async (error) => {
                if (!!error) {
                    reject(error);
                    return;
                }
                
                const transaction = await getTransactionAsync(confirmedTransaction.id);
                resolve(transaction);
            });
    });
}

export async function getNodesAsync(limit: number = 10000): Promise<any[]> {
    return new Promise(async (resolve, reject) => {
        const nodes: any[] = [];
        data.each(`SELECT * FROM "nodes" ORDER BY createTime DESC LIMIT ${limit};`, (error, row) => {
            nodes.push(row);
        }, (error) => {
            resolve(nodes);
        });
    });
}

export async function postNodeAsync(
    id: string, accountId: string, ip: string, port: number): Promise<any> {
    return new Promise(async (resolve, reject) => {
        data.run(
            `INSERT INTO "nodes" VALUES (
            "${id}",
            "${new Date().toISOString()}",
            "${accountId}",
            "${ip}",
            "${port}",
            "active",
            "${new Date().toISOString()}"
        );`, async (error) => {
                if (!!error) {
                    console.error(error);
                }

                const nodes = await getNodesAsync(1);
                assert(nodes[0].id === id);
                resolve(nodes[0]);
            });
    });
}

// let pending: {
//     [nodeId: string]: {
//         transactions: any[],
//         accounts: any[],
//         nodes: any[]
//     }
// } = {};

// export async function syncAsync(nodeId: string, syncData: any): Promise<any> {
//     return new Promise(async (resolve, reject) => {
//         pending[nodeId] = syncData;

//         let elapsedTime = 0;
//         const nodes = await getNodesAsync();
//         while (Object.keys(pending).length < nodes.length && elapsedTime < 5000) {
//             console.log(`Waiting for more sync requests... ${Object.keys(pending).length}/${nodes.length}...`);
//             await common.waitAsync(500);
//             elapsedTime += 500;
//         }

//         for (nodeId in pending) {
//             const syncData = pending[nodeId];
//         }

//         pending = {};
//         resolve(pending);
//     });
// }

export function close(): void {
    ledger.close((error) => {
        if (!!error) console.error(error);
    });

    data.close((error) => {
        if (!!error) console.error(error);
    });
}