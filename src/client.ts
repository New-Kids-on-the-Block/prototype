import Net from "net";

const client = new Net.Socket();

client.connect(60001, "127.0.0.1", () => {
    console.log(`Connected.`);
    client.write(`Hello, server! Love, Client.`);
});

client.on("data", (data) => {
    console.log(`Received: ${data}`);
    client.destroy();
});

client.on("close", () => {
    console.log(`Connection closed.`);
});