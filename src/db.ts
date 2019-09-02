import sqlite3 from "sqlite3";
import uuid from "uuid/v4";

const ledger = new sqlite3.Database("./ledger.db", (error) => {
    if (!!error) console.error(error);
});

const data = new sqlite3.Database("./data.db", (error) => {
    if (!!error) console.error(error);
});

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

export async function getTransactionsAsync(accountId: string, limit: number, fromTime?: Date, toTime?: Date): Promise<any[]> {
    accountId = accountId.toLowerCase();

    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        data.each(`SELECT * from transactions WHERE "from" = "${accountId}" or "to" = "${accountId}"
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

        data.run(`INSERT INTO "pendingTransactions" VALUES (
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

export async function postTransactionAsync(pendingTransaction: any, requestTime: Date): Promise<any> {
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

        ledger.run(
            `INSERT INTO "transactions" VALUES (
            "${pendingTransaction.id}",
            "${pendingTransaction.initiateTime}",
            "${pendingTransaction.from}",
            "${pendingTransaction.to}",
            ${pendingTransaction.amount},
            "${requestTime.toISOString()}",
            "${new Date().toISOString()}");`, async (error) => {
                if (!!error) {
                    reject(error);
                }

                const transaction = await getTransactionsAsync(pendingTransaction.from, 1);
                resolve(transaction[0]);
            });
    });
}