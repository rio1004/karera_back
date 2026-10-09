import { FastifyInstance } from 'fastify';
import requestSupertest from 'supertest';
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Utils } from '../utils/utils.ts';
import UserRoutesPlugin from '../../src/api/UserRoutesPlugin.ts';
import OneTimePinCodeRoutesPlugin from '../../src/api/OneTimePinCodeRoutesPlugin.ts';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

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

describe('POST /users/request-password-update with OTP-based registration', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "kareraPasswordUpdate";
  let testServer: FastifyInstance;
  let utils: Utils = new Utils();
  let testUsers: any[] = [];

  beforeAll(async () => {
    const init_db = true;
    testServer = await utils.beforeAll(url, dbName, init_db);

    // Register plugins here
    testServer.register(UserRoutesPlugin);
    testServer.register(OneTimePinCodeRoutesPlugin);
    await testServer.ready();

    // Load test users from XLSX file
    const xlsxPath = path.join(__dirname, 'users_otp.xlsx');
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

  it('should register user with OTP verification then send password update OTP for a valid user', async () => {
    for (const [i, user] of testUsers.entries()) {
      const userData = createCompleteUserData(user, i);

      // Step 1: Register user with OTP verification
      const { registration } = await registerUserWithOtpVerification(testServer, userData);

      // Validate registration response
      expect(registration.body).toHaveProperty('user');
      expect(registration.body).toHaveProperty('token');
      expect(registration.body).toHaveProperty('otpCode');

      // Step 2: Request password update
      const response = await requestSupertest(testServer.server)
        .post('/users/reset-password?no_sms=true')
        .send({ userNameOrEmail: userData.userName })
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Your password update OTP has been sent to your mobile number.');
      expect(response.body).toHaveProperty('otp');

      // Step 3: Confirm password update with OTP
      const confirmPasswordUpdateResponse = await requestSupertest(testServer.server)
        .post('/users/confirm-reset-password')
        .send({ 
          otp: response.body.otp,
          userName: userData.userName, 
          newPassword: `${userData.password}1`, 
          confirmNewPassword: `${userData.password}1` 
        })
        .expect(200);
      
      expect(confirmPasswordUpdateResponse.body).toHaveProperty('message');
      expect(confirmPasswordUpdateResponse.body.message).toContain('Password updated successfully');

      // Step 4: Login with the new password
      const loginResponse = await requestSupertest(testServer.server)
        .post('/login')
        .send({ 
          userNameOrEmail: userData.userName, 
          password: `${userData.password}1` 
        })
        .expect(200);
      
      expect(loginResponse.body).toHaveProperty('token');
    }
  });

  it('should return 400 if userNameOrEmail is missing', async () => {
    const response = await requestSupertest(testServer.server)
      .post('/users/reset-password')
      .send({})
      .expect(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('validation');
    expect(Array.isArray(response.body.validation)).toBe(true);
    expect(response.body.validation).toHaveLength(1);
    expect(response.body.validation[0].message).toContain('required property');
  });

  it('should return 404 for a non-existent user', async () => {
    const response = await requestSupertest(testServer.server)
      .post('/users/reset-password')
      .send({ userNameOrEmail: 'nonexistentuser' })
      .expect(404);

    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('User with the given userNameOrEmail was not found.');
  });
});