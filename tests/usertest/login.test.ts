import { FastifyInstance } from 'fastify';
import requestSupertest from 'supertest';
import UserRoutesPlugin from '../../src/api/UserRoutesPlugin.ts';
import OneTimePinCodeRoutesPlugin from '../../src/api/OneTimePinCodeRoutesPlugin.ts';

import { assert, describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Utils } from '../utils/utils.ts';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { userTypeValues } from '../../src/db/schema.ts';

// Helper function to read users from XLSX file
async function readUsersFromXlsx(filePath: string): Promise<any[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(fs.createReadStream(filePath));
  const worksheet = workbook.worksheets[0];
  
  if (!worksheet) {
    throw new Error('No worksheet found in file');
  }
  
  const users: any[] = [];
  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (values.length >= 6) {
      const [username, password, email, mobile, firstname, lastname, type] = values;
      if (username && password && email && mobile && firstname && lastname) {
        users.push({
          username: username.toString(),
          password: password.toString(),
          email: email.toString(),
          mobile: mobile.toString(),
          firstname: firstname.toString(),
          lastname: lastname.toString(),
          type: type ? type.toString() : 'player'
        });
      }
    }
  }
  return users;
}

// Helper function to create complete user data for registration
function createCompleteUserData(baseUser: any, index: number) {
  return {
    firstName: baseUser.firstname,
    lastName: baseUser.lastname,
    userName: baseUser.username,
    email: baseUser.email,
    mobile: baseUser.mobile,
    type: baseUser.type as 'admin' | 'moderator' | 'player',
    password: baseUser.password,
    ekycTransactionId: `ekyc_${Date.now()}_${index}`,
    permanentAddress: 'Test Permanent Address',
    currentAddress: 'Test Current Address',
    birthDate: '1990-01-01',
    birthPlace: 'Test City',
    nationality: 'Test Nationality',
    gamingSite: 'Test Gaming Site',
    natureOfWork: 'Test Work',
    sourceOfIncome: 'Test Income',
  };
}

// Helper function to verify OTP
async function verifyOtp(testServer: FastifyInstance, mobile: string, otp: string) {
  return await requestSupertest(testServer.server)
    .post('/otp/verify')
    .send({ mobile, otp })
    .expect(200);
}

// Helper function to register user with OTP verification
async function registerUserWithOtpVerification(testServer: FastifyInstance, userData: any) {
  // Step 1: Register user
  const registrationResponse = await requestSupertest(testServer.server)
    .post('/register')
    .send(userData)
    .expect(201);

  // Step 2: Verify OTP
  const otpVerificationResponse = await verifyOtp(
    testServer, 
    userData.mobile, 
    registrationResponse.body.otpCode
  );

  return {
    registration: registrationResponse,
    otpVerification: otpVerificationResponse,
  };
}

describe('POST /login with OTP-based registration', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "kareraLogin";
  let testServer: FastifyInstance;
  let utils: Utils = new Utils();
  let testUsers: any[] = [];

  beforeAll(async () => {
    const init_db = true;
    testServer = await utils.beforeAll(url, dbName, init_db);
    
    testServer.register(UserRoutesPlugin);
    testServer.register(OneTimePinCodeRoutesPlugin);
    await testServer.ready();
    
    // Load test users from XLSX file
    const xlsxPath = path.join(__dirname, 'users.xlsx');
    testUsers = await readUsersFromXlsx(xlsxPath);
    console.log(`Loaded ${testUsers.length} test users from XLSX file`);
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

  
  it('should register a new user with OTP verification then login and return a token', async () => {
    for (const [i, user] of testUsers.entries()) {
      const userData = createCompleteUserData(testUsers[i], i);

      // Step 1: Register user with OTP verification
      const { registration } = await registerUserWithOtpVerification(testServer, userData);

      // Validate registration response
      expect(registration.body).toHaveProperty('user');
      expect(registration.body).toHaveProperty('token');
      expect(registration.body).toHaveProperty('otpCode');
      expect(registration.body.user).toHaveProperty('id');

      // Step 2: Login with the registered user
      const loginResponse = await requestSupertest(testServer.server)
        .post('/login')
        .send({
          userNameOrEmail: userData.userName,
          password: userData.password,
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('token');
      expect(typeof loginResponse.body.token).toBe('string');

      // Step 3: Verify user can be retrieved with JWT token
      const user = await requestSupertest(testServer.server)
        .get(`/users/${registration.body.user.id}`)
        .set('Authorization', `Bearer ${loginResponse.body.token}`)
        .expect(200);
      expect(user.body.user.type).toBe(userData.type);
    }
  });

  it('should return 400 if required fields are missing (login)', async () => {
    const response = await requestSupertest(testServer.server)
      .post('/login')
      .send({ userNameOrEmail: 'someone' }) // missing password
      .expect(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('validation');
    expect(Array.isArray(response.body.validation)).toBe(true);
  });

  it('should return 401 if username is incorrect', async () => {
    const userData = createCompleteUserData({
      firstname: 'Test',
      lastname: 'InvalidUser',
      username: 'validuser123',
      email: 'validuser@example.com',
      mobile: '88877766666',
      type: userTypeValues[0],
      password: 'password123',
    }, 0);

    // Register the valid user with OTP verification
    await registerUserWithOtpVerification(testServer, userData);

    // Attempt login with incorrect username
    const response = await requestSupertest(testServer.server)
      .post('/login')
      .send({
        userNameOrEmail: 'wronguser123', // incorrect username
        password: userData.password,
      })
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error.toLowerCase()).toContain('invalid');
  });

  it('should return 401 if password is incorrect', async () => {
    const userData = createCompleteUserData({
      firstname: 'Test',
      lastname: 'WrongPassword',
      username: 'wrongpassworduser',
      email: 'wrongpassword@example.com',
      mobile: '77788899999',
      type: userTypeValues[0],
      password: 'password123',
    }, 1);

    // Register the user with OTP verification
    await registerUserWithOtpVerification(testServer, userData);

    // Attempt login with wrong password
    const response = await requestSupertest(testServer.server)
      .post('/login')
      .send({
        userNameOrEmail: userData.userName,
        password: 'wrongpassword',
      })
      .expect(401);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error.toLowerCase()).toContain('invalid');
  });

});