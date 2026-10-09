import { FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import { UBankTransactionsTable } from "../../db/schema.ts";

const baseUrl = process.env.UB_BASE_URL || 'https://api-uat.unionbankph.com/partners/sb';

const depositUsername = process.env.UB_DEPOSIT_USERNAME || 'partner_sb';
const depositPassword = process.env.UB_DEPOSIT_PASSWORD || 'p@ssw0rd';
const depositClientId = process.env.UB_DEPOSIT_CLIENT_ID || '36aabb6f-452d-41ec-91b2-f57acc85fd32';
const depositClientSecret = process.env.UB_DEPOSIT_CLIENT_SECRET || 'O4dB0oL2xS7kF1vC0dW4kP4xE3yR8lN1eS7xL6pH2dD1lS3wO8';
const depositPartnerId = process.env.UB_DEPOSIT_PARTNER_ID || '5dff2cdf-ef15-48fb-a87b-375ebff415bb';
const depositBillerUuid = process.env.UB_DEPOSIT_BILLER_UUID || '02C16F6A-8329-D696-FEA1-7E51304B8A2E';

const callbackUrl = process.env.UB_CALLBACK_URL || 'http://127.0.0.1:3000';
const depositCallbackUrl = `${callbackUrl}/payments/ub/callbackDeposit`;

async function processDeposit(user, amount) {
  // Do something with the successful deposit
  console.log(`Deposit to ${user} of amount ${amount} processed successfully.`);
}

export async function ubDeposit(request: FastifyRequest, reply: FastifyReply) {
  const token = await fetch(`${baseUrl}/partners/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "grant_type": "password",
      "scope": "upay_payments",
      "username": depositUsername,
      "password": depositPassword,
      "client_id": depositClientId,
    })
  });
  const access_token = (await token.json())["access_token"];

  const refId = `${DateTime.now().setZone("Asia/Manila").toMillis()}${(Math.random() * 1000000).toFixed(0)}`
  const response = await fetch(`${baseUrl}/upay/payments/v1/transactions`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${access_token}`,
      "x-ibm-client-id": depositClientId,
      "x-ibm-client-secret": depositClientSecret,
      "x-ibm-partner-id": depositPartnerId,
    },
    body: JSON.stringify({
      "senderRefId": refId,
      "tranRequestDate": DateTime.now().setZone("Asia/Manila").toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS"),
      "emailAddress": request.body["email"],
      "mobileNumber": request.body["phoneNumber"],
      "amount": request.body["amount"],
      "billerUuid": depositBillerUuid,
      "paymentMethod": "instapay",
      "callbackUrl": depositCallbackUrl,
      "references": [
        { "index": 1, "value": request.user["id"] },
        { "index": 2, "value": request.body["fullName"] }
      ]
    })
  });

  const data = await response.json();
  console.log({
    userId: request.user["id"],
    senderRefId: refId,
    transactionId: data["transactionId"],
    transactionType: 'DEPOSIT',
    status: 'pending',
    amount: request.body["amount"],
    metadata: JSON.stringify(data),
  });

  await request.db.insert(UBankTransactionsTable).values({
    userId: request.user["id"],
    senderRefId: refId,
    transactionId: data["transactionId"],
    transactionType: 'DEPOSIT',
    status: 'pending',
    amount: request.body["amount"],
    metadata: JSON.stringify(data),
  });

  reply.send({
    senderRefId: data["senderRefId"],
    qrCode: data["qrCode"]
  })
}

export async function ubDepositCallback(request: FastifyRequest, reply: FastifyReply) {
  console.log(request.body)
  console.log(request.params)
  reply.status(204).send();
}
