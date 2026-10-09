import {icoreBalance, icoreDeposit, icoreDepositCallback, icoreStatus, icoreWithdraw, icoreWithdrawCallback} from "../plugins/PaymentPlugins/ICorePlugin.ts";
import { FastifyReply, FastifyRequest } from 'fastify';
import { ubDeposit, ubDepositCallback } from "../plugins/PaymentPlugins/UBDepositPlugin.ts";
import { ubWithdraw } from "../plugins/PaymentPlugins/UBWithdrawPlugin.ts";
import { UserSessionTable } from "../db/schema.ts";
import { globalAuthentication } from "../app.ts";

const icoreStatusSchema = {
  description: 'Icore Transaction Status',
  tags: ['payments'],
  response: {
    200: {
      type: 'object',
      properties: {
        status: {type: 'string'},
      }
    }
  }
};

const icoreDepositSchema = {
  description: 'Icore Deposit',
  tags: ['payments'],
  body: {
    type: 'object',
    properties: 
      {
        amount: { type:'number' },
        fullName: { type:'string' },
        email: { type:'string' },
        phoneNumber: { type:'string' },
        address: { type:'string' },
        remark: { type:'string' }
    },
    required: ['amount', 'fullName', 'email', 'phoneNumber', 'address', 'remark']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        operationId: {type: 'string'},
        redirectUrl: {type: 'string'}
      }
    }
  }
};

const icoreWithdrawSchema = {
  description: 'Icore Withdraw',
  tags: ['payments'],
  body: {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      bankId: { type: 'string' },
      accountNumber: { type: 'string' },
      fullName: { type:'string' },
      email: { type:'string' },
      phoneNumber: { type:'string' },
      address: { type:'string' },
      remark: { type:'string' }
    },
    required: ['amount', 'bankId', 'accountNumber', 'fullName', 'email', 'phoneNumber', 'address', 'remark']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        operationId: {type: 'string'},
      }
    },
    400: {
      type: 'object',
      properties: {
        error: {type: 'string'},
      }
    }
  }
};

const icoreDepositCallbackSchema = {
  description: 'ICore Deposit Callback',
  tags: ['callbacks'],
  body: {type: 'object' }
};

const icoreWithdrawCallbackSchema = {
  description: 'ICore Withdraw Callback',
  tags: ['callbacks'],
  body: {type: 'object' }
};

const ubDepositSchema = {
  description: 'UnionBank Deposit',
  tags: ['payments'],
  body: {
    type: 'object',
    properties: {
      amount: { type:'number' },
      fullName: { type:'string' },
      email: { type:'string' },
      phoneNumber: { type:'string' },
      address: { type:'string' },
      remark: { type:'string' }
    },
    required: ['amount', 'fullName', 'email', 'phoneNumber', 'address', 'remark']
  },
  response: {
    200: {
      type: 'object',
      properties: {
        senderRefId: {type: 'string'},
        qrCode: {type: 'string'}
      }
    }
  }
};

const ubWithdrawDepositSchema = {
  description: 'UnionBank Withdraw',
  tags: ['payments'],
  body: {
    type: 'object',
    properties: {
      accountNumber: { type:'string' },
      amount: { type:'number' },
      fullName: { type:'string' },
      remark: { type:'string' }
    },
    required: ['accountNumber', 'amount', 'fullName', 'remark']
  },
};

async function PaymentsRoutesPlugin(server, opts) {
  globalAuthentication(server);

  server.get('/payments/icore/balance', { preHandler: server.authenticate }, icoreBalance)

  server.get('/payments/icore/status/:id', { preHandler: server.authenticate, schema:icoreStatusSchema, }, icoreStatus)

  server.post('/payments/icore/deposit', { preHandler: server.authenticate, schema:icoreDepositSchema }, icoreDeposit)
  server.post('/payments/icore/callbackDeposit',{ schema:icoreDepositCallbackSchema }, icoreDepositCallback)

  server.post('/payments/icore/withdraw', { preHandler: server.authenticate, schema:icoreWithdrawSchema }, icoreWithdraw)
  server.post('/payments/icore/callbackWithdraw', { schema: icoreWithdrawCallbackSchema }, icoreWithdrawCallback)

  server.post('/payments/ub/deposit', { preHandler: server.authenticate, schema: ubDepositSchema }, ubDeposit)
  server.post('/payments/ub/callbackDeposit', { }, ubDepositCallback)
  server.get('/payments/ub/callbackDeposit', { }, ubDepositCallback)

  server.post('/payments/ub/withdraw', { preHandler: server.authenticate, schema: ubWithdrawDepositSchema }, ubWithdraw)
}

export default PaymentsRoutesPlugin