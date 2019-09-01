import Net from "net";
import uuid from "uuid/v4";
import sqlite3 from "sqlite3";
import express from "express";
import bodyParser from "body-parser";

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
    console.log(`Creating users table if not already exists...`);
    appDb.run(`CREATE TABLE IF NOT EXISTS "users" (
        "id"	        TEXT,
        "username"	    TEXT UNIQUE,
        "password"	    TEXT,
        "createTime"	TEXT NOT NULL,
        PRIMARY KEY("id"));`);
    appDb.run(`CREATE UNIQUE INDEX IF NOT EXISTS "usernamePassword" ON "users" ("username", "password");`);

    console.log(`Creating nodes tables if not already exists...`);
    appDb.run(`CREATE TABLE IF NOT EXISTS "nodes" (
        "id"	        TEXT,
        "nodename"	    TEXT UNIQUE,
        "createTime"	TEXT NOT NULL,
        "ownerId"	    TEXT NOT NULL,
        "ip"	        TEXT NOT NULL,
        "port"	        NUMERIC NOT NULL,
        "status"	    INTEGER NOT NULL,
        "lastPulseTime"	TEXT NOT NULL,
        PRIMARY KEY("id"),
        FOREIGN KEY("ownerId") REFERENCES "users"("id"));`);
    appDb.run(`CREATE INDEX IF NOT EXISTS "ownerStatusPulse" ON "nodes" ("owner", "status", "lastPulseTime");`);
});

ledgerDb.serialize(() => {
    console.log(`Creating transactions tables if not already exists...`);
    ledgerDb.run(`CREATE TABLE IF NOT EXISTS "pendingTransactions" (
        "id"	        TEXT,
        "initiateTime"	TEXT NOT NULL,
        "from"	        TEXT NOT NULL,
        "to"	        TEXT NOT NULL,
        "amount"	    NUMERIC NOT NULL,
        PRIMARY KEY("id"));`);
    ledgerDb.run(`CREATE UNIQUE INDEX IF NOT EXISTS "timeFromTo" ON "pendingTransactions" ("time", "from", "to" );`);

    ledgerDb.run(`CREATE TABLE IF NOT EXISTS "transactions" (
        "id"	        TEXT,
        "initiateTime"  TEXT NOT NULL,
        "from"	        TEXT,
        "to"	        TEXT NOT NULL,
        "amount"	    NUMERIC NOT NULL,
        "requestTime"   TEXT NOT NULL,
        "confirmTime"   TEXT NOT NULL,
        PRIMARY KEY("id"));`);
    ledgerDb.run(`CREATE UNIQUE INDEX IF NOT EXISTS "timeFromTo" ON "transactions" ("time", "from", "to" );`);

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

async function getBalanceAsync(username: string): Promise<{ amount: number }> {
    username = username.toLowerCase();

    return new Promise((resolve, reject) => {
        let receiveAmount = 0;
        let sendAmount = 0;

        ledgerDb.each(
            `SELECT sum(t1.amount) as "receiveAmount",
            (SELECT sum(t2.amount) from transactions t2 WHERE "from" = "${username}") as "sendAmount"
            from transactions t1 WHERE "to" = "${username}";`,
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

async function getTransactionsAsync(username: string, limit: number, fromTime?: Date, toTime?: Date): Promise<any[]> {
    username = username.toLowerCase();

    return new Promise<any[]>((resolve, reject) => {
        const rows: any[] = [];
        // console.log(query);
        ledgerDb.each(`SELECT * from transactions WHERE "from" = "${username}" or "to" = "${username}"
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

async function postTrasactionAsync(from: string, to: string, amount: number): Promise<any> {
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

        ledgerDb.run(`INSERT INTO transactions VALUES (
            "${uuid()}",
            "${new Date().toISOString()}",
            "${from}",
            "${to}",
            ${amount},
            "${new Date().toISOString()}",
            "${new Date().toISOString()}");`,
            async (error) => {
                if (!!error) {
                    reject(error);
                }

                const transactions = await getTransactionsAsync(from, 1);
                resolve(transactions[0]);
            });
    });
}

app.get("/nodes", async (req, res) => {
    res.json({
        total: 10,
        activeNodes: []
    });
});

app.get("/users/:username", async (req, res) => {
    const username = !req.params.username ? "system" : req.params.username;
    const balance = await getBalanceAsync(username);
    const transactions = await getTransactionsAsync(username, 100);

    res.json({
        username: username,
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
    const transaction = await postTrasactionAsync(from, req.body.to, req.body.amount);
    res.json(transaction);
});

function onLedgerInitialized(app: any): void {
    console.log(`Server listing at port: 60000... Try 'localhost:60000/balance'.`);
    app.listen(60000);
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