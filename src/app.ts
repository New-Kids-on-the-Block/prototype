import Net from "net";
import uuid from "uuid/v4";
import sqlite3 from "sqlite3";
import express from "express";
import bodyParser from "body-parser";
import config from "config";
import crypto from "crypto";

const appConfig: any = config.get("app");
const nodeConfig: any = config.get("node");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const ledgerDb = new sqlite3.Database("./ledger.db", (error) => {
    if (!!error) console.error(error);
});

const appDb = new sqlite3.Database("./app.db", (error) => {
    if (!!error) console.error(error);
})

appDb.serialize(() => {
    console.log(`Creating accounts table if not already exists...`);
    appDb.run(`CREATE TABLE IF NOT EXISTS "accounts" (
        "id"	        TEXT,
        "password"	    TEXT,
        "createTime"	TEXT NOT NULL,
        PRIMARY KEY("id"));`);
    appDb.run(`CREATE UNIQUE INDEX IF NOT EXISTS "idPassword" ON "accounts" ("id", "password");`);

    console.log(`Adding the system account if the accounts is empty.`);
    appDb.each(`SELECT COUNT(*) as count FROM "accounts";`, (error, row) => {
        const accountsCount = row["count"];
        if (accountsCount > 0) {
            console.log(`Accounts is not empty, system account not needed.`);
            return;
        }

        appDb.run(`INSERT INTO "accounts" VALUES ("system", NULL, "${new Date().toISOString()}");`);
    });

    console.log(`Creating nodes tables if not already exists...`);
    appDb.run(`CREATE TABLE IF NOT EXISTS "nodes" (
        "id"	        TEXT,
        "createTime"	TEXT NOT NULL,
        "accountId"	    TEXT NOT NULL,
        "ip"	        TEXT NOT NULL,
        "port"	        NUMERIC NOT NULL,
        "status"	    TEXT NOT NULL,
        "lastPulseTime"	TEXT,
        PRIMARY KEY("id"),
        FOREIGN KEY("accountId") REFERENCES "accounts"("id"));`);
    appDb.run(`CREATE INDEX IF NOT EXISTS "accountStatusPulse" ON "nodes" ("accountId", "status", "lastPulseTime");`);

    console.log(`Adding as new a new node if the node ip, port doesn't exist.`);
    appDb.each(`SELECT COUNT(*) as count FROM "nodes" WHERE "id" = "${nodeConfig.id}" AND
                "ip" = "${nodeConfig.ip}" AND "port" = "${nodeConfig.port}";`, (error, row) => {
            const nodesCount = row["count"];
            if (nodesCount > 0) {
                console.log(`Node: ${nodeConfig.id}:${nodeConfig.ip}:${nodeConfig.port} already exists.`);
                return;
            }

            appDb.run(`INSERT INTO "nodes" VALUES (
            "${nodeConfig.id}", "${new Date().toISOString()}",
            "${nodeConfig.ownerId}", "${nodeConfig.ip}", ${nodeConfig.port},
            "inactive", NULL);`);
        });
});

ledgerDb.serialize(() => {
    console.log(`Creating transactions tables if not already exists...`);
    ledgerDb.run(`CREATE TABLE IF NOT EXISTS "pendingTransactions" (
        "id"	        TEXT,
        "initiateTime"	TEXT NOT NULL,
        "from"          TEXT NOT NULL,
        "to"	        TEXT NOT NULL,
        "amount"	    NUMERIC NOT NULL,
        PRIMARY KEY("id"));`);
    ledgerDb.run(`CREATE INDEX IF NOT EXISTS "timeFrom" ON "pendingTransactions" ("initiatedTime", "from");`);

    ledgerDb.run(`CREATE TABLE IF NOT EXISTS "transactions" (
        "id"	        TEXT,
        "initiateTime"  TEXT NOT NULL,
        "from"	        TEXT,
        "to"	        TEXT NOT NULL,
        "amount"	    NUMERIC NOT NULL,
        "requestTime"   TEXT NOT NULL,
        "confirmTime"   TEXT NOT NULL,
        PRIMARY KEY("id"));`);
    ledgerDb.run(`CREATE INDEX IF NOT EXISTS "timeFrom" ON "transactions" ("initiatedTime", "from");`);
    ledgerDb.run(`CREATE INDEX IF NOT EXISTS "timeTo" ON "transactions" ("initiatedTime", "to");`);

    ledgerDb.run(`CREATE TABLE IF NOT EXISTS "confirmationDetails" (
        "confirmTime"   TEXT NOT NULL,
        "transactionId" TEXT NOT NULL,
        "requestNodeId" TEXT NOT NULL,
        "confirmNodeId"	TEXT NOT NULL,
        PRIMARY KEY("confirmTime", "transactionId", "requestNodeId", "confirmNodeId"));`);

    console.log(`Adding the first transaction if the ledger is empty.`);
    ledgerDb.each(`SELECT COUNT(*) FROM transactions;`, (error, row) => {
        const totalTransactions = row["COUNT(*)"];
        if (totalTransactions > 0) {
            console.log(`Transaction not empty, first transaction not needed.`);
            return;
        }

        ledgerDb.run(`INSERT INTO transactions VALUES (
            "${uuid()}",
            "${new Date().toISOString()}",
            NULL,
            "system",
            1000000000,
            "${new Date().toISOString()}",
            "${new Date().toISOString()}"
        );`);
    });

    onLedgerInitialized(app);
});

function waitAsync(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getBalanceAsync(id: string): Promise<{ amount: number }> {
    id = id.toLowerCase();

    return new Promise((resolve, reject) => {
        let receiveAmount = 0;
        let sendAmount = 0;

        ledgerDb.each(
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

async function getAccountsAsync(limit: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        appDb.each(
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

async function postAccountAsync(id: string, encryptedPwd: string): Promise<any> {
    id = id.toLowerCase();

    return new Promise((resolve, reject) => {
        appDb.run(`INSERT INTO "accounts" VALUES ("${id}", "${encryptedPwd}", "${new Date().toISOString()}");`,
            async (error) => {
                if (!!error) {
                    reject(error);
                }

                const accounts = await getAccountsAsync(1);
                resolve(accounts[0]);
            });
    });
}

async function getTransactionsAsync(accountId: string, limit: number, fromTime?: Date, toTime?: Date): Promise<any[]> {
    accountId = accountId.toLowerCase();

    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        ledgerDb.each(`SELECT * from transactions WHERE "from" = "${accountId}" or "to" = "${accountId}"
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

async function getPendingTransactionsAsync(): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        ledgerDb.each(`SELECT * from "pendingTransactions" ORDER BY initiateTime DESC;`,
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

async function initiateTransactionAsync(from: string, to: string, amount: number): Promise<any> {
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

        ledgerDb.run(`INSERT INTO "pendingTransactions" VALUES (
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

async function postTransactionAsync(pendingTransaction: any, requestTime: Date): Promise<any> {
    return new Promise(async (resolve, reject) => {
        const balance = await getBalanceAsync(pendingTransaction.from);
        if (balance.amount < pendingTransaction.amount) {
            reject({
                error: {
                    code: "notEnoughBalance",
                    message: `Not enough balance, amount requested: ${pendingTransaction.from} > balance: ${balance.amount}.`
                }
            });
            return;
        }

        ledgerDb.run(`INSERT INTO "transactions" VALUES (
            "${pendingTransaction.id}",
            "${pendingTransaction.initiateTime}",
            "${pendingTransaction.from}",
            "${pendingTransaction.to}",
            ${pendingTransaction.amount},
            "${requestTime.toISOString()}",
            "${new Date().toISOString()}");`,
            async (error) => {
                if (!!error) {
                    reject(error);
                }

                const transaction = await getTransactionsAsync(pendingTransaction.from, 1);
                resolve(transaction[0]);
            });
    });
}

app.get("/nodes", async (req, res) => {
    res.json({
        total: 10,
        activeNodes: []
    });
});

app.get("/accounts/:id", async (req, res) => {
    const id = !req.params.id ? "system" : req.params.id;
    const balance = await getBalanceAsync(id);
    const transactions = await getTransactionsAsync(id, 100);

    res.json({
        id: id,
        amount: balance.amount,
        recentTransactions: transactions,
    });
});

app.get("/balance", async (req, res) => {
    const username = "system";
    const balance = await getBalanceAsync(username);
    const transactions = await getTransactionsAsync(username, 100);

    res.json({
        username: username,
        amount: balance.amount,
        recentTransactions: transactions,
    });
});

app.get("/transactions", async (req, res) => {
    const transactions = await getTransactionsAsync("system", 10000);
    res.json(transactions);
});

app.post("/transactions", async (req, res) => {
    const from = "system";
    const transaction = await initiateTransactionAsync(from, req.body.to, req.body.amount);

    await waitAsync(2000);

    res.json(transaction);
});

const pendingTransactions: any[][] = [];
app.post("/transactions/sync", async (req, res) => {
    const transactions = req.body;
    pendingTransactions.push(transactions);

    res.json(transactions);
});

app.get("/accounts", async (req, res) => {
    const accounts = await getAccountsAsync(10000);
    res.json(accounts);
})

app.post("/accounts", async (req, res) => {
    if (!req.body.id) res.status(400).send({ error: `required property, 'id' is undefined.` });
    if (!req.body.password) res.status(400).send({ error: `required property, 'password' is undefined.` });
    else if (req.body.password.length < 6) res.status(400).send({ error: `'password' must be at least 6 characters.` });

    const id = req.body.id;
    const password = req.body.password;
    const encryptedPassword = crypto.createHmac('sha256', appConfig.secret).digest("hex");

    const account = await postAccountAsync(id, encryptedPassword);
    res.json(account);
});

function onLedgerInitialized(app: any): void {
    console.log(`Server listing at port: ${appConfig.port}...`);
    console.log(`Try '${nodeConfig.ip}:${appConfig.port}/balance'.`);
    app.listen(appConfig.port);
}

// let port = 60001;

// if (process.argv.length >= 3) {
//     port = Number(process.argv[2]);
// }

// function waitAsync(ms: number): Promise<void> {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }

// interface Node {
//     id: string;
//     socket: Net.Socket;
// }

// interface TransactionConfirmation {
//     nodeId: string,
//     requestedTime: Date,
//     confirmedTime?: Date
// }

// interface Transaction {
//     id: string,
//     time: Date,
//     from: string,
//     to: string,
//     amount: number,
//     confirmations?: TransactionConfirmation[]
// }

// interface BlockData {
//     nodeId: string,
//     prevId?: string;
//     transactions: Transaction[];
// }

// class Block {
//     private static readonly Limit = 1000;

//     private _block: BlockData;

//     constructor(nodeId: string, prevId?: string) {
//         this._block = {
//             nodeId: nodeId,
//             prevId: prevId,
//             transactions: []
//         };
//     }

//     public isFull(): boolean {
//         return this._block.transactions.length >= Block.Limit;
//     }

//     public getTransactionCount() {
//         return this._block.transactions.length;
//     }

//     public addTransaction(from: string, to: string, amount: number): Transaction {
//         let transaction: Transaction;
//         if (this.isFull()) {
//             return undefined;
//         }

//         transaction = {
//             id: uuid(),
//             time: new Date(),
//             from: from,
//             to: to,
//             amount: amount
//         };

//         this._block.transactions.push(transaction);
//         return transaction;
//     }

//     public addAndConfirmTransactions(transactions: Transaction[]): void {
//         transactions.map(transaction => {
//             const pendingConfirmation = transaction.confirmations.find(c => c.nodeId === this._block.nodeId);
//             // pendingConfirmation.confirmedTime = new Date();
//         });

//         this._block.transactions.concat(transactions);
//     }

//     public getUnfonfirmedTransactions(): Transaction[] {
//         return this._block.transactions.filter(t =>
//             !t.confirmations || t.confirmations.every(c => !c.confirmedTime));
//     }

//     public getPendingTransactions(): Transaction[] {
//         return this._block.transactions.filter(t =>
//             !!t.confirmations && t.confirmations.every(c => !c.confirmedTime));
//     }

//     public toJSON(): string {
//         return JSON.stringify(this._block);
//     }
// }

// enum MessageType {
//     Heartbeat = "heartbeat",
//     Transactions = "transactions",
// }

// interface Message {
//     type: MessageType,
//     time: Date,
//     sourceNodeId: string,
//     transactions?: Transaction[]
// }

// const block = new Block(`127.0.0.1:${port}`);
// const nodes: Node[] = [];
// const server = Net.createServer((serverSocket) => {
//     const node = {
//         id: `${serverSocket.remoteAddress}:${serverSocket.remotePort}`,
//         socket: serverSocket
//     };

//     nodes.push(node);
//     console.log(`Connection established with ${node.id}.`);

//     serverSocket.on("end", () => {
//         console.log(`${node.id} left the connection.`);
//         nodes.splice(nodes.indexOf(node), 1);
//     });

//     serverSocket.on("data", async (data) => {
//         const message: Message = JSON.parse(data.toString());
//         if (message.type !== MessageType.Heartbeat) {
//             console.log(`Server Received: ${message.type} at ${message.time} from ${node.id}.`);
//         }

//         let returnMessageType: MessageType;
//         switch (message.type) {
//             case MessageType.Heartbeat:
//                 returnMessageType = MessageType.Heartbeat;
//                 break;
//             case MessageType.Transactions:
//                 returnMessageType = MessageType.Transactions;
//                 console.log(`Syncing ${message.transactions.length} transactions...`);
//                 const transactions = message.transactions;
//                 // block.addAndConfirmTransactions(transactions);
//                 console.log(`Sync complete.`);
//                 break;
//             default:
//                 break;
//         }

//         serverSocket.write(Buffer.from(JSON.stringify({
//             type: returnMessageType,
//             time: new Date(),
//             sourceNodeId: `127.0.0.1:${port}`
//         })));
//     });

//     serverSocket.on("error", (error) => {
//         console.log(error);
//         serverSocket.destroy();
//     });
// });

// server.on("error", (error) => {
//     console.log(error);
// });

// server.listen(port, "127.0.0.1");

// const peerNodes = [
//     { ip: "127.0.0.1", port: 60001 },
//     { ip: "127.0.0.1", port: 60002 },
//     { ip: "127.0.0.1", port: 60003 },
//     { ip: "127.0.0.1", port: 60004 }];

// const clientSockets: Net.Socket[] = [];

// // clients on receive broadcast, update/merge the data and send confirmation
// // connect to peer nodes
// peerNodes.forEach((node) => {
//     if (node.port === port) {
//         return;
//     }

//     const clientSocket = new Net.Socket();
//     clientSocket.on("connect", async () => {
//         console.log(`Connected to ${node.ip}:${node.port}.`);
//         clientSockets.push(clientSocket);

//         const message: Message = {
//             type: MessageType.Heartbeat,
//             time: new Date(),
//             sourceNodeId: `127.0.0.1:${port}`,
//         };

//         clientSocket.write(Buffer.from(JSON.stringify(message)));
//     });

//     clientSocket.on("error", async (error) => {
//         // console.log(`Error with connection ${node.ip}:${node.port}. Connecting again in 10s...`);
//         await waitAsync(10000);
//         clientSocket.connect(node.port, node.ip);
//     });

//     clientSocket.on("data", async (data) => {
//         const message = JSON.parse(data.toString());
//         if (message.type !== MessageType.Heartbeat) {
//             console.log(`Client Received: ${message.type} at ${message.time} from ${node.ip}:${node.port}.`);
//         }

//         switch (message.type) {
//             case MessageType.Heartbeat:
//                 await waitAsync(10000);
//                 const returnMessage: Message = {
//                     type: MessageType.Heartbeat,
//                     time: new Date(),
//                     sourceNodeId: `127.0.0.1:${port}`,
//                 };

//                 clientSocket.write(Buffer.from(JSON.stringify(returnMessage)));
//                 break;
//             case MessageType.Transactions:
//                 const pendingTransactions = block.getPendingTransactions();
//                 pendingTransactions.forEach(t => {
//                     const pendingConfirmation = t.confirmations.find(c => c.nodeId === message.sourceNodeId);
//                     pendingConfirmation.confirmedTime = message.time;
//                 });
//                 break;
//             default:
//                 break;
//         }
//     });

//     clientSocket.on("close", () => {
//         // console.log(`Connection closed from ${node.ip}:${node.port}.`);
//         clientSockets.splice(clientSockets.indexOf(clientSocket), 1);
//     });

//     clientSocket.connect(node.port, node.ip);
// });

// (async () => {
//     block.addTransaction("avalopas", "aval501", 100);

//     while (true) {
//         await waitAsync(10000);
//         console.log(`Transaction counts in the block: ${block.getTransactionCount()}.`);

//         const unconfirmedTransactions = block.getUnfonfirmedTransactions();
//         if (unconfirmedTransactions.length === 0 ||
//             (unconfirmedTransactions.length > 0 && block.getPendingTransactions().length > 0) ||
//             clientSockets.length === 0) {
//             continue;
//         }

//         console.log(`Sending ${unconfirmedTransactions.length} transactions confirmation request...`);
//         clientSockets.forEach((clientSocket) => {
//             if (clientSocket.destroyed) {
//                 console.log(`Connection not established with ${clientSocket.remoteAddress}:${clientSocket.remotePort}.`);
//                 return;
//             }

//             const message: Message = {
//                 type: MessageType.Transactions,
//                 time: new Date(),
//                 sourceNodeId: `127.0.0.1:${port}`,
//                 transactions: unconfirmedTransactions
//             };

//             clientSocket.write(Buffer.from(JSON.stringify(message)));
//             unconfirmedTransactions.forEach(t => {
//                 if (!t.confirmations) {
//                     t.confirmations = [{
//                         nodeId: `${clientSocket.remoteAddress}:${clientSocket.remotePort}`,
//                         requestedTime: new Date()
//                     }];
//                 } else {
//                     t.confirmations.push({
//                         nodeId: `${clientSocket.remoteAddress}:${clientSocket.remotePort}`,
//                         requestedTime: new Date()
//                     });
//                 }
//             });
//         });
//     }
// })();

(async () => {
    while (true) {
        await waitAsync(2000);
        const pendingTransactions = await getPendingTransactionsAsync();
        console.log(`node ID: '${nodeConfig.id}', pending transactions: ${pendingTransactions.length}.`);
    }
})();