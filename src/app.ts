import Net from "net";
import uuid from "uuid/v4";

import sqlite3 from "sqlite3";

const db = new sqlite3.Database("./ledger.db", (error) => {
    if (!!error) console.error(error);
});

db.serialize(() => {
    console.log(`Creating transaction tables if not already exists...`);
    db.run(`CREATE TABLE IF NOT EXISTS "pendingTransactions" (
        "id"	        TEXT,
        "initiateTime"	TEXT NOT NULL,
        "from"	        TEXT NOT NULL,
        "to"	        TEXT NOT NULL,
        "amount"	    NUMERIC NOT NULL,
        PRIMARY KEY("id"));`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "timeFromTo" ON "pendingTransactions" ("time", "from", "to" );`);

    db.run(`CREATE TABLE IF NOT EXISTS "transactions" (
        "id"	        TEXT,
        "initiateTime"  TEXT NOT NULL,
        "from"	        TEXT NOT NULL,
        "to"	        TEXT NOT NULL,
        "amount"	    NUMERIC NOT NULL,
        "requestTime"   TEXT NOT NULL,
        "confirmTime"   TEXT NOT NULL,
        PRIMARY KEY("id"));`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "timeFromTo" ON "transactions" ("time", "from", "to" );`);

    db.run(`CREATE TABLE IF NOT EXISTS "confirmationDetails" (
        "confirmTime"   TEXT NOT NULL,
        "transactionId" TEXT NOT NULL,
        "requestNodeId" TEXT NOT NULL,
        "confirmNodeId"	TEXT NOT NULL,
        PRIMARY KEY("confirmTime", "transactionId", "requestNodeId", "confirmNodeId"));`);

    console.log(`Adding the first transaction if the ledger is empty.`);
    db.each(`SELECT COUNT(*) FROM transactions`, (error, row) => {
        const totalTransactions = row["COUNT(*)"];
        if (totalTransactions > 0) {
            console.log(`Transaction not empty, first transaction not needed.`);
            return;
        }
    
        db.run(`INSERT INTO transactions VALUES (
            "${uuid()}",
            "${new Date().toISOString()}",
            "system",
            "system",
            1000000000,
            "${new Date().toISOString()}",
            "${new Date().toISOString()}"
        )`);
    });
})

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