import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";
import * as db from "./db";
import * as common from "./common";
import { Server } from "http";
import Block from "./block";
import uuid = require("uuid");
import assert = require("assert");
import { blockStatement } from "@babel/types";

const app = express();
let server: Server;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

export function listen() {
    const node = common.appContext.config.node;

    console.log(`Node, '${node.id}', started listening at ${node.ip}:${node.port}...`);
    server = app.listen(node.port, node.ip);
}

export function close() {
    server.close((error) => {
        if (!!error) console.error(error);
    });
}

app.post("/terminate", async (req, res) => {
    common.appContext.isRunning = false;
    res.status(200).send();
});

app.get("/nodes", async (req, res) => {
    const nodes = await db.getNodesAsync();
    res.json({
        total: nodes.length,
        activeNodes: nodes
    });
});

app.post("/nodes", async (req, res) => {
    const node = req.body;
    const result = await db.postNodeAsync(node.id, node.accountId, node.ip, node.port);
    res.json(result);
});

app.get("/transactions", async (req, res) => {
    const transactions = await db.getTransactionsAsync("system", 10000);
    res.json(transactions);
});

app.post("/transactions", async (req, res) => {
    const from = "system";
    const to = !req.body.to ? res.status(400).send(`'to' should be specificed.`) : req.body.to;
    const amount = !req.body.amount ? res.status(400).send(`'amount' should be specificed.`) : req.body.amount;

    const block = await Block.getBlockAsync();
    const transaction = {
        id: uuid(),
        from: from,
        to: to,
        amount: amount,
        initiateTime: new Date().toISOString()
    };

    const balance = await db.getBalanceAsync(transaction.from);
    if (balance.amount >= transaction.amount) {
        block.queueTransactions([transaction]);
        res.json(transaction);
        return;
    }
        
    res.status(400).send(`'amount', ${amount}, must be smaller or equal to the blanace: ${balance.amount}.`);
});

/**
 * Transactions confirm request set, loop through all and apply without 'confirmTime' set.
 * Respond to the client where it can set 'confirmTime', and make 2nd /confirm request.
 */
app.post("/transactions/confirm", async (req, res) => {
    // /confirm should go through some extra authorization and validation
    const block = await Block.getBlockAsync();
    const pendingTransactions: any[] = req.body;
    const validTransactions: any[] = [];
    const invalidTransactions: any[] = [];

    for (const transaction of pendingTransactions) {
        const balance = await db.getBalanceAsync(transaction.from);
        if (balance.amount >= transaction.amount) {
            validTransactions.push(transaction);
        } else {
            invalidTransactions.push(transaction);
        }
    }

    block.queueTransactions(validTransactions);
    res.json({
        queueds: validTransactions,
        invalids: invalidTransactions
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

app.get("/accounts", async (req, res) => {
    const accounts = await db.getAccountsAsync(10000);
    res.json(accounts);
})

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

app.post("/accounts", async (req, res) => {
    if (!req.body.id) res.status(400).send({ error: `required property, 'id' is undefined.` });
    if (!req.body.password) res.status(400).send({ error: `required property, 'password' is undefined.` });
    else if (req.body.password.length < 6) res.status(400).send({ error: `'password' must be at least 6 characters.` });

    const id = req.body.id;
    const password = req.body.password;
    const encryptedPassword = crypto.createHmac('sha256', common.appContext.config.app.secret).digest("hex");

    const account = await db.postAccountAsync(id, encryptedPassword);
    res.json(account);
});