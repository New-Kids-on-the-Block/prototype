import Net from "net";
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

// node should have 1 server broadcasting to n, 5, clients about any update.

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
        console.log(`Data received: ${data}`);
        while (true) {
            serverSocket.write(`ping from ${port}`);
            await waitAsync(5000);

            if (serverSocket.destroyed) {
                break;
            }
        }
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
    clientSocket.on("connect", () => {
        console.log(`Connected.`);
        clientSocket.write(`Hello, server! Love, Client.`);
    });

    clientSocket.on("error", async (error) => {
        console.log(`Error with connection ${node.ip}:${node.port}. Connecting again in 10s...`);
        await waitAsync(10000);
        clientSocket.connect(node.port, node.ip);
    });

    clientSocket.on("data", (data) => {
        console.log(`Received: ${data}`);
        // client.destroy();
    });

    clientSocket.on("close", () => {
        console.log(`Connection closed from ${node.ip}:${node.port}.`);
    });

    clientSocket.connect(node.port, node.ip);
});