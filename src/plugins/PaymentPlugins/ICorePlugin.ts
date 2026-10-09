import { createHmac } from "crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { depositsTable, TransactionsTable, WalletTable, withdrawsTable } from "../../db/schema.ts";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { completeUserTransaction, TransactionStatus } from "../../api/TransactionRoutesPlugin.ts";

const base_url = process.env.ICORE_BASE_URL || 'https://icoredev.tech:8835';
const service_id = process.env.ICORE_SERVICE_ID || 'merchant_test';
const passwork = process.env.ICORE_PASSWORK || '$Z13_}=Iq£V.xv6';
const secretKey = process.env.ICORE_SECRET_KEY || 'xKAjtVAr*3m2I8i7M+vf%|PSwq,X0L';
const callback_url = process.env.ICORE_BASE_CALLBACK_URL || 'http://127.0.0.1:8001';

const depositCallbackUrl = `${callback_url}/api/payments/icore/callbackDeposit`;
const depositReturnUrl = `${callback_url}`;
const withdrawCallbackUrl = `${callback_url}/api/payments/icore/callbackWithdraw`;
const withdrawReturnUrl = `${callback_url}`;

async function sendRequest(route:string, payload:Record<string,any>) {
  payload["service_id"] = service_id
  payload["passwork"] = passwork

  let signature = "";
  for (var param in payload) {
    if (payload[param] == null || payload[param] == "") payload[param] = "-";
    if (typeof(payload[param]) == "object")
      for (var p in payload[param]){
        if (payload[param][p] == null || payload[param][p] == "") payload[param][p] = "-";
        signature += payload[param][p];
      }
    else signature += payload[param];
  }

  const hmac = createHmac('sha256', secretKey);
  hmac.update(signature);
  payload["signature"] = hmac.digest('hex');

  const response = await fetch(`${base_url}/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })

  return await response.json();
}

export async function icoreBalance(request: FastifyRequest, reply: FastifyReply) {
  const response = await sendRequest("available-balances/get-balance", {operation_id:""});
  reply.send({
    balance_amount: response["data"]["balance_amount"],
    payout_balance: response["data"]["payout_balance"],
  });
}


export async function icoreStatus(request: FastifyRequest, reply: FastifyReply) {
  const response = await sendRequest("status", {operation_id: request.params["id"]});
  reply.send({status: response["operation"]["status"] });
}

export async function icoreDeposit(request: FastifyRequest, reply: FastifyReply) {
  const uuid = randomUUID();
  const amount = Number(request.body["amount"]);
  const response = await sendRequest("pay", {
    payment_id:uuid,
    operation_id: uuid,
    amount: amount * 100,
    currency: "PHP",
    by_method: "qrph",
    callback_url: depositCallbackUrl,
    return_url: depositReturnUrl,
    customer: {
        account_number: request.user["id"],
        name: request.body["fullName"],
        email: request.body["email"],
        phone_number: request.body["phoneNumber"],
        address: request.body["address"],
        remark: request.body["remark"]
    }
  });

  await request.db.transaction(async (trx) => {
    const [transaction] = await trx
      .insert(TransactionsTable)
      .values({
        userId: Number(request.user["id"]),
        type: 'deposit',
        amount:amount.toFixed(4),
        status:TransactionStatus.IN_PROGRESS
      })
      .returning();

    await trx
      .insert(depositsTable)
      .values({
        transactionId: transaction.id,
        status: TransactionStatus.IN_PROGRESS,
        meta:response,
      })
      .returning();
  })

  reply.send({
    operationId: response["operation_id"],
    redirectUrl: response["redirect_url"]
  })
}

export async function icoreWithdraw(request: FastifyRequest, reply: FastifyReply) {
  const uuid = randomUUID();
  const userId = Number(request.user["id"]);
  const amount = Number(request.body["amount"]) ;

  const [userWallet] = await request.db.select().from(WalletTable).where(eq(WalletTable.userId, userId))
  if (!userWallet || Number(userWallet.balance) < amount) return reply.code(400).send({error: 'Insufficient Balance'});


  const response = await request.db.transaction(async (trx) => {
    const [transaction] = await trx
      .insert(TransactionsTable)
      .values({
        userId: Number(request.user["id"]),
        type: 'withdraw',
        amount:amount.toFixed(4),
        status:TransactionStatus.IN_PROGRESS
      })
      .returning();

    const response = await sendRequest("payout", {
      payment_id:uuid,
      operation_id: uuid,
      amount: amount * 100,
      currency: "PHP",
      by_method: "instapay",
      callback_url: withdrawCallbackUrl,
      return_url: withdrawReturnUrl,
      customer: {
          account_number: request.body["accountNumber"],
          account_bank_id: request.body["bankId"],
          name: request.body["fullName"],
          email: request.body["email"],
          phone_number: request.body["phoneNumber"],
          address: request.body["address"],
          remark: request.body["remark"]
      }
    });

    await trx
      .insert(withdrawsTable)
      .values({
        transactionId: transaction.id,
        status: TransactionStatus.IN_PROGRESS,
        meta:response,
      })
      .returning();
    return response
  })

  reply.send({operationId: response["operation_id"]});
}

export async function icoreDepositCallback(request: FastifyRequest, reply: FastifyReply) {
  const response = request.body;
  if(response["operation"]["status"] != "paid") return reply.status(200).send();
  const [deposit] = await request.db.select().from(depositsTable).where(
    sql`${depositsTable.meta}->>'operation_id' = ${request.body["operation_id"]}`
  );
  console.log(deposit)
  const [transaction] = await request.db.select().from(TransactionsTable).where(eq(TransactionsTable.id, deposit.transactionId));
  await request.db.transaction(async (trx) => {
    console.log(deposit["status"] == TransactionStatus.IN_PROGRESS)
    if(deposit["status"] == TransactionStatus.IN_PROGRESS) {
      await trx.update(depositsTable).set({status: TransactionStatus.COMPLETED }).where(eq(depositsTable.id, deposit.id))
      const [wallet] = await trx.select().from(WalletTable).where(eq(WalletTable.userId, transaction.userId));
      const now = new Date();
      const newBalance = Number(wallet.balance) + Number(transaction.amount);
      await trx.update(WalletTable).set({balance: newBalance.toFixed(4),updatedAt: now}).where(eq(WalletTable.id, wallet.id));
      await trx.update(TransactionsTable).set({status: TransactionStatus.COMPLETED }).where(eq(TransactionsTable.id, transaction.id));
    }
  })
  reply.status(200).send();
}

export async function icoreWithdrawCallback(request: FastifyRequest, reply: FastifyReply) {
  const response = request.body;
  if(response["operation"]["status"] != "paid") return reply.status(200).send();
  const [withdraw] = await request.db.select().from(withdrawsTable).where(
    sql`${withdrawsTable.meta}->>'operation_id' = ${request.body["operation_id"]}`
  );
  const [transaction] = await request.db.select().from(TransactionsTable).where(eq(TransactionsTable.id, withdraw.transactionId));

  await request.db.transaction(async (trx) => {
    if(withdraw["status"] == TransactionStatus.IN_PROGRESS) {
      await trx.update(withdrawsTable).set({status: TransactionStatus.COMPLETED }).where(eq(withdrawsTable.id, withdraw.id))
      await completeUserTransaction(
        trx,
        'withdraws',         
        withdraw.id,         
        Number(transaction.userId),  
        Number(transaction.amount),
        TransactionStatus.COMPLETED,
        transaction.id
      );
    }
  })
  reply.status(200).send();
}