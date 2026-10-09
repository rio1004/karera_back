import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { FastifyInstance } from 'fastify';
import { Utils } from '../utils/utils.ts';
import { sendSms } from '../../services/smsService.ts';

vi.mock('axios');

const mockAxiosPost = axios.post as unknown as ReturnType<typeof vi.fn>;

describe('sendSms', () => {
     const url = "postgresql://postgres:postgres@localhost:5432/";
     const dbName = "kareraRegister";
     let testServer: FastifyInstance;
     let utils: Utils = new Utils();

     beforeAll(async () => {
          const init_db = true;
          testServer = await utils.beforeAll(url, dbName, init_db);
          await testServer.ready();
     });

     afterAll(async () => {
          await utils.afterAll();
     });

     beforeEach(async () => {
          await utils.beforeEach();
     });

     afterEach(async () => {
          await utils.afterEach();
     });

     it('returns success true when SMS is sent', async () => {
          mockAxiosPost.mockResolvedValueOnce({ data: { success: true } });
          const result = await sendSms({ recipient: '09123456789', message: 'Hello!' });
          expect(result).toHaveProperty('success', true);
     });

}); 