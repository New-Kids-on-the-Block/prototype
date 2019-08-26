import Net from "net";
import uuid from "uuid/v4";

let port = 60001;

if (process.argv.length >= 3) {
    port = Number(process.argv[2]);
}

function waitAsync(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface Node {
    id: string;
    socket: Net.Socket;
}

interface Transaction {
    id: string,
    time: Date,
    from: string,
    to: string,
    amount: number
}

interface BlockData {
    id: string,
    prevId?: string;
    transactions: Transaction[];
}

class Block {
    private static readonly Limit = 1000;

    private _block: BlockData = {
        id: uuid(),
        transactions: []
    };

    constructor(prevId?: string) {
        this._block.prevId = prevId;
    }

    public isFull(): boolean {
        return this._block.transactions.length >= Block.Limit;
    }

    public addTransaction(from: string, to: string, amount: number): Transaction {
        let transaction: Transaction;
        if (this.isFull()) {
            return undefined;
        }

        transaction = {
            id: uuid(),
            time: new Date(),
            from: from,
            to: to,
            amount: amount
        };

        this._block.transactions.push(transaction);
        return transaction;
    }

    public toJSON(): string {
        return JSON.stringify(this._block);
    }
}

enum MessageType {
    Heartbeat = "heartbeat"
}

interface Message {
    type: MessageType,
    time: Date,
    dest: string
}

const nodes: Node[] = [];
const server = Net.createServer((serverSocket) => {
    const node = {
        id: `${serverSocket.remoteAddress}:${serverSocket.remotePort}`,
        socket: serverSocket
    };

    nodes.push(node);
    console.log(`Connection established with ${node.id}.`);

    serverSocket.on("end", () => {
        console.log(`${node.id} left the connection.`);
        nodes.splice(nodes.indexOf(node), 1);
    });

    serverSocket.on("data", async (data) => {
        const message: Message = JSON.parse(data.toString());
        console.log(`Server Received: ${message.type} at ${message.time} from ${node.id}.`);

        if (message.type === MessageType.Heartbeat) {
            const message: Message = {
                type: MessageType.Heartbeat,
                time: new Date(),
                dest: node.id
            };

            serverSocket.write(Buffer.from(JSON.stringify(message)));
        }

        // while (true) {
        //     const message: Message = {
        //         type: MessageType.Heartbeat,
        //         time: new Date(),
        //         dest: node.id
        //     };

        //     serverSocket.write(Buffer.from(JSON.stringify(message)));
        //     await waitAsync(5000);

        //     if (serverSocket.destroyed) {
        //         break;
        //     }
        // }
    });

    serverSocket.on("error", (error) => {
        console.log(error);
        serverSocket.destroy();
    });
});

server.on("error", (error) => {
    console.log(error);
});

server.listen(port, "127.0.0.1");

const peerNodes = [
    { ip: "127.0.0.1", port: 60001 },
    { ip: "127.0.0.1", port: 60002 },
    { ip: "127.0.0.1", port: 60003 },
    { ip: "127.0.0.1", port: 60004 }];

// clients on receive broadcast, update/merge the data and send confirmation
// connect to peer nodes
peerNodes.forEach((node) => {
    if (node.port === port) {
        return;
    }

    const clientSocket = new Net.Socket();
    clientSocket.on("connect", async () => {
        console.log(`Connected to ${node.ip}:${node.port}.`);

        while (!clientSocket.destroyed) {
            const message: Message = {
                type: MessageType.Heartbeat,
                time: new Date(),
                dest: `${node.ip}:${node.port}`,
            };

            clientSocket.write(Buffer.from(JSON.stringify(message)));
            await waitAsync(5000);
        }
    });

    clientSocket.on("error", async (error) => {
        console.log(`Error with connection ${node.ip}:${node.port}. Connecting again in 10s...`);
        await waitAsync(10000);
        clientSocket.connect(node.port, node.ip);
    });

    clientSocket.on("data", (data) => {
        const message = JSON.parse(data.toString());
        console.log(`Client Received: ${message.type} at ${message.time} from ${node.ip}:${node.port}.`);
    });

    clientSocket.on("close", () => {
        console.log(`Connection closed from ${node.ip}:${node.port}.`);
    });

    clientSocket.connect(node.port, node.ip);
});