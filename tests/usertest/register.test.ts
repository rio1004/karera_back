import { FastifyInstance } from 'fastify';
import requestSupertest from 'supertest';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { eq , and , ilike } from 'drizzle-orm';
import { assert, describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Utils } from '../utils/utils.ts';
import UserRoutesPlugin from '../../src/api/UserRoutesPlugin.ts';
import OneTimePinCodeRoutesPlugin from '../../src/api/OneTimePinCodeRoutesPlugin.ts';
import { BannedPlayersTable } from '../../src/db/schema.ts';

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

async function seedTestBannedPlayer(testServer: FastifyInstance) {
  await testServer.db.insert(BannedPlayersTable).values({
    name: 'agnes mesina',
    nationality: 'Filipino',
    listType: 'Test',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function createCompleteUserData(baseUser: any, index: number) {
  return {
    firstName: baseUser.firstname,
    lastName: baseUser.lastname,
    userName: baseUser.username,
    email: baseUser.email,
    mobile: `${baseUser.mobile}094`,
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

describe('POST /register with OTP verification', () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/";
  const dbName = "kareraUserRegister";
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
    const xlsxPath = path.join(__dirname, 'users.xlsx');
    testUsers = await readUsersFromXlsx(xlsxPath);
    console.log(`Loaded ${testUsers.length} test users from XLSX file`);
  });

  afterAll(async () => {
    await utils.afterAll();
  });

  beforeEach(async () => {
    await utils.beforeEach();
    // Seed test banned player after transactional DB is attached
    await seedTestBannedPlayer(testServer);
  });

  afterEach(async () => {
    await utils.afterEach();
  });

  
  it('should register a new user successfully with OTP verification', async () => {
    for (const [i, user] of testUsers.entries()) {
      const userData = createCompleteUserData(testUsers[i], i);

      // Step 1: Register user
      const registrationResponse = await requestSupertest(testServer.server)
        .post('/register')
        .send(userData)
        .expect(201);

      // Validate registration response
      expect(registrationResponse.body).toHaveProperty('user');
      expect(registrationResponse.body).toHaveProperty('token');
      expect(registrationResponse.body).toHaveProperty('otpCode');
      expect(registrationResponse.body.user).toHaveProperty('id');
      expect(registrationResponse.body.user.type).toBe(userData.type);
      expect(registrationResponse.body.user.firstName).toBe(userData.firstName);
      expect(registrationResponse.body.user.lastName).toBe(userData.lastName);
      expect(registrationResponse.body.user.userName).toBe(userData.userName);
      expect(registrationResponse.body.user.email).toBe(userData.email);
      expect(registrationResponse.body.user.mobile).toBe(userData.mobile);
      
      // Validate OTP code format
      expect(typeof registrationResponse.body.otpCode).toBe('string');
      expect(registrationResponse.body.otpCode.length).toBe(6);

      // Step 2: Verify OTP
      const otpVerificationResponse = await verifyOtp(
        testServer, 
        userData.mobile, 
        registrationResponse.body.otpCode
      );

      // Validate OTP verification response
      expect(otpVerificationResponse.body).toHaveProperty('message', 'OTP verified successfully');
      expect(otpVerificationResponse.body).toHaveProperty('resetToken');
      expect(typeof otpVerificationResponse.body.resetToken).toBe('string');
      expect(otpVerificationResponse.body.resetToken.length).toBeGreaterThan(0);

      // Step 3: Verify user can be retrieved with the original token
      const user = await requestSupertest(testServer.server)
        .get(`/users/${registrationResponse.body.user.id}`)
        .set('Authorization', `Bearer ${registrationResponse.body.token}`)
        .expect(200);
      expect(user.body.user.type).toBe(userData.type);
    }
  });

  it('should return 403 if user name is in banned players list', async () => {
    // Test with a name that should be banned: Agnes Mesina
    const bannedUserData = {
      firstName: 'agnes',
      lastName: 'mesina',
      userName: 'agnes_mesina',
      email: 'agnes.mesina@test.com',
      mobile: '123403956789051',
      type: 'player' as const,
      password: 'password123',
      ekycTransactionId: `ekyc_${Date.now()}_banned`,
      permanentAddress: 'Test Permanent Address',
      currentAddress: 'Test Current Address',
      birthDate: '1990-01-01',
      birthPlace: 'Test City',
      nationality: 'Test Nationality',
      gamingSite: 'Test Gaming Site',
      natureOfWork: 'Test Work',
      sourceOfIncome: 'Test Income',
    };
    
    const response = await requestSupertest(testServer.server)
      .post('/register')
      .send(bannedUserData)
      .expect(403);
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('message');
    expect(response.body.error).toBe('Registration blocked');
    expect(response.body.message).toBe('This name is associated with a banned player and registration is not allowed. Contact support for more information.');
  });

  it('should return 400 if mobile number is too short', async () => {
    const userData = createCompleteUserData(testUsers[2], 2);
    userData.mobile = '1234567890'; // 10 digits, should fail
    const response = await requestSupertest(testServer.server)
      .post('/register')
      .send(userData)
      .expect(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('validation');
    expect(response.body.validation).toHaveLength(1);
    expect(response.body.validation[0].message).toContain('than 11 characters');
  });
  
  // NOTE: 2025-08-28: This test is not working as we removed the restriction with the UsersTable. I will put it back when we put back the restriction.
  // it('should return 409 if username already exists', async () => {
  //   const userData = {
  //     firstName: testUsers[3].firstname,
  //     lastName: testUsers[3].lastname,
  //     userName: testUsers[3].username,
  //     email: testUsers[3].email,
  //     mobile: testUsers[3].mobile,
  //     type: testUsers[3].type as 'admin' | 'moderator' | 'player',
  //     password: testUsers[3].password,
  //   };

  //   // First registration should succeed
  //   await requestSupertest(testServer.server)
  //     .post('/register')
  //     .send(userData)
  //     .expect(201);

  //   // Second registration with same username should fail
  //   const duplicateUser = {
  //     ...userData,
  //     email: testUsers[4].email,   // Different email
  //     mobile: testUsers[4].mobile, // Different mobile
  //   };

  //   const response = await requestSupertest(testServer.server)
  //     .post('/register')
  //     .send(duplicateUser)
  //     .expect(400);

  //   expect(response.body).toHaveProperty('error');
  //   expect(response.body).toHaveProperty('validation');
  //   expect(Array.isArray(response.body.validation)).toBe(true);
  //   expect(response.body.validation).toHaveLength(1);
  //   expect(response.body.validation[0].message).toContain('Username already exists');
  // });

  // it('should return 409 if email already exists', async () => {
  //   const firstUser = {
  //     firstName: testUsers[5].firstname,
  //     lastName: testUsers[5].lastname,
  //     userName: testUsers[5].username,
  //     email: testUsers[5].email,
  //     mobile: testUsers[5].mobile,
  //     type: testUsers[5].type as 'admin' | 'moderator' | 'player',
  //     password: testUsers[5].password,
  //   };
  
  //   await requestSupertest(testServer.server)
  //     .post('/register')
  //     .send(firstUser)
  //     .expect(201);
  
  //   const secondUser = {
  //     ...firstUser,
  //     userName: testUsers[6].username,
  //     mobile: testUsers[6].mobile, // different mobile
  //   };
  
  //   const response = await requestSupertest(testServer.server)
  //     .post('/register')
  //     .send(secondUser)
  //     .expect(400);
  
  //   expect(response.body).toHaveProperty('error');
  //   expect(response.body).toHaveProperty('validation');
  //   expect(Array.isArray(response.body.validation)).toBe(true);
  //   expect(response.body.validation).toHaveLength(1);
  //   expect(response.body.validation[0].message).toContain('Email already exists');
  // });

  // it('should return 409 if mobile number already exists', async () => {
  //   const firstUser = {
  //     firstName: testUsers[7].firstname,
  //     lastName: testUsers[7].lastname,
  //     userName: testUsers[7].username,
  //     email: testUsers[7].email,
  //     mobile: testUsers[7].mobile,
  //     type: testUsers[7].type as 'admin' | 'moderator' | 'player',
  //     password: testUsers[7].password,
  //   };
  
  //   await requestSupertest(testServer.server)
  //     .post('/register')
  //     .send(firstUser)
  //     .expect(201);
  
  //   const secondUser = {
  //     ...firstUser,
  //     userName: testUsers[8].username,
  //     email: testUsers[8].email, // different email
  //   };
  
  //   const response = await requestSupertest(testServer.server)
  //     .post('/register')
  //     .send(secondUser)
  //     .expect(400);
  
  //   expect(response.body).toHaveProperty('error');
  //   expect(response.body).toHaveProperty('validation');
  //   expect(Array.isArray(response.body.validation)).toBe(true);
  //   expect(response.body.validation).toHaveLength(1);
  //   expect(response.body.validation[0].message).toContain('Mobile number already exists');
  // });

  
});