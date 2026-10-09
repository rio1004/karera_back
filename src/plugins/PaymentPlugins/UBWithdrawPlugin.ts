import { FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import { UBankTransactionsTable } from "../../db/schema.ts";

const baseUrl = process.env.UB_BASE_URL || 'https://api-uat.unionbankph.com/partners/sb';

const withdrawUsername = process.env.UB_WITHDRAW_USERNAME || 'partner_sb';
const withdrawPassword = process.env.UB_WITHDRAW_PASSWORD || 'p@ssw0rd';
const withdrawClientId = process.env.UB_WITHDRAW_CLIENT_ID || 'abc5c34f-ac4b-44b9-91f8-f81501e2c60f';
const withdrawClientSecret = process.env.UB_WITHDRAW_CLIENT_SECRET || 'Q0kC2gC1tF4pQ7cN2mR2gV1rS2wL2qN0bQ8uW1kL5bF0tQ6jA2';
const withdrawPartnerId = process.env.UB_WITHDRAW_PARTNER_ID || '5dff2cdf-ef15-48fb-a87b-375ebff415bb';

async function processWithdraw(user, amount) {
  // Do something with the successful deposit
  console.log(`Deposit to ${user} of amount ${amount} processed successfully.`);
}

export async function ubWithdraw(request: FastifyRequest, reply: FastifyReply) {
  const token = await fetch(`${baseUrl}/partners/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "grant_type": "password",
      "scope": "transfers",
      "username": withdrawUsername,
      "password": withdrawPassword,
      "client_id": withdrawClientId,
    })
  });
  const access_token = (await token.json())["access_token"];

  const refId = `${DateTime.now().setZone("Asia/Manila").toMillis()}${(Math.random() * 1000000).toFixed(0)}`
  let response = await fetch(`${baseUrl}/partners/v3/transfers/single`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${access_token}`,
      "x-ibm-client-id": withdrawClientId,
      "x-ibm-client-secret": withdrawClientSecret,
      "x-partner-id": withdrawPartnerId,
    },
    body: JSON.stringify({
      "senderRefId": refId,
      "tranRequestDate": DateTime.now().setZone("Asia/Manila").toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS"),
      "accountNo": request.body["accountNumber"],
      "amount": {
        "currency": "PHP",
        "value": request.body["amount"]
      },
      "remarks": request.body["remark"],
      "particulars": "Withdrawal Request",
      "info": [
        {
          "index": 1,
          "name": "User ID",
          "value": request.user["id"]
        },
        {
          "index": 2,
          "name": "Receipient",
          "value": request.body["fullName"]
        }
      ]
    })
  });
  const data = await response.json();
  if("errors" in data) return reply.status(400).send(data);
  
  await request.db.insert(UBankTransactionsTable).values({
    userId: request.user["id"],
    senderRefId: refId,
    transactionId: data["transactionId"],
    transactionType: 'WITHDRAW',
    status: 'success',
    amount: request.body["amount"],
    metadata: JSON.stringify(data),
  });
  await processWithdraw(request.user["id"], request.body["amount"]);
  reply.send(data)
}
