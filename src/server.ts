import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import * as db from "./db";

let appContext: any;
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/nodes", async (req, res) => {
    res.json({
        total: 10,
        activeNodes: []
    });
});

app.get("/accounts/:id", async (req, res) => {
    const id = !req.params.id ? "system" : req.params.id;
    const balance = await db.getBalanceAsync(id);
    const transactions = await db.getTransactionsAsync(id, 100);

    res.json({
        id: id,
        amount: balance.amount,
        recentTransactions: transactions,
    });
});

app.get("/balance", async (req, res) => {
    const username = "system";
    const balance = await db.getBalanceAsync(username);
    const transactions = await db.getTransactionsAsync(username, 100);

    res.json({
        username: username,
        amount: balance.amount,
        recentTransactions: transactions,
    });
});

app.get("/transactions", async (req, res) => {
    const transactions = await db.getTransactionsAsync("system", 10000);
    res.json(transactions);
});

app.post("/transactions", async (req, res) => {
    const from = "system";
    const transaction = await db.initiateTransactionAsync(from, req.body.to, req.body.amount);

    res.json(transaction);
});

const pendingTransactions: any[][] = [];
app.post("/transactions/sync", async (req, res) => {
    const transactions = req.body;
    pendingTransactions.push(transactions);

    res.json(transactions);
});

app.get("/accounts", async (req, res) => {
    const accounts = await db.getAccountsAsync(10000);
    res.json(accounts);
})

app.post("/accounts", async (req, res) => {
    if (!req.body.id) res.status(400).send({ error: `required property, 'id' is undefined.` });
    if (!req.body.password) res.status(400).send({ error: `required property, 'password' is undefined.` });
    else if (req.body.password.length < 6) res.status(400).send({ error: `'password' must be at least 6 characters.` });

    const id = req.body.id;
    const password = req.body.password;
    const encryptedPassword = crypto.createHmac('sha256', appContext.config.app.secret).digest("hex");

    const account = await db.postAccountAsync(id, encryptedPassword);
    res.json(account);
});

export function listen(appContext: any) {
    appContext = appContext;
    app.listen(appContext.config.node.port);
}