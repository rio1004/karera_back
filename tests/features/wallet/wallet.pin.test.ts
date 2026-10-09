import {FastifyInstance} from "fastify";
import request from "supertest";
import {describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} from "vitest";
import {Utils} from "../../utils/utils.js";
import UserRoutesPlugin from "../../../src/api/UserRoutesPlugin.ts";
import WalletRoutesPlugin from "../../../src/api/WalletPinRoutesPlugin.ts";
import {faker} from "@faker-js/faker";

describe("Wallet PIN Routes", () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/postgres";
  const dbName = "walletPinTest";
  let server: FastifyInstance;
  let utils: Utils = new Utils();

  let authToken: string;
  let userId: string;

  const userPayload = {
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    userName: faker.internet.username().toLowerCase(),
    email: faker.internet.email().toLowerCase(),
    mobile: faker.phone.number("###########"),
    type: "player",
    password: faker.internet.password().toLowerCase(),
  };

  const registerAndLogin = async () => {
    await request(server.server).post("/register").send(userPayload);

    const res = await request(server.server)
      .post("/login")
      .send({userNameOrEmail: userPayload.email, password: userPayload.password})
      .expect(200);

    authToken = res.body.token;
    userId = res.body.user.id;
  };

  const createPin = (pin: string) =>
    request(server.server)
      .post("/wallet/pin")
      .set("Authorization", `Bearer ${authToken}`)
      .send({pin});

  const updatePin = (pin: string, password: string) =>
    request(server.server)
      .patch("/wallet/pin")
      .set("Authorization", `Bearer ${authToken}`)
      .send({pin, password});

  const verifyPin = (pin: string) =>
    request(server.server)
      .post("/wallet/pin/verify")
      .set("Authorization", `Bearer ${authToken}`)
      .send({pin});

  beforeAll(async () => {
    server = await utils.beforeAll(url, dbName, true);
    server.register(UserRoutesPlugin);
    server.register(WalletRoutesPlugin);
    await server.ready();
  });

  afterAll(async () => {
    await utils.afterAll();
  });

  beforeEach(async () => {
    await utils.beforeEach();
    await registerAndLogin();
  });

  afterEach(async () => {
    await utils.afterEach();
  });

  describe("Create PIN", () => {
    it("should create a valid PIN", async () => {
      const res = await createPin("1234").expect(200);
      expect(res.body.message).toBe("PIN created successfully");
    });

    it("should reject invalid PIN format", async () => {
      const res = await createPin("abcd").expect(400);
      expect(res.body.error).toBe("PIN must be 4 digits");
    });
  });

  describe("Update PIN", () => {
    it("should update PIN with correct password", async () => {
      await createPin("1234").expect(200);
      const res = await updatePin("5678", userPayload.password).expect(200);
      expect(res.body.message).toBe("PIN updated");
    });

    it("should reject update with wrong password", async () => {
      await createPin("1234").expect(200);
      const res = await updatePin("9999", "wrongPass").expect(401);
      expect(res.body.error).toBe("Invalid password");
    });

    it("should reject invalid PIN format on update", async () => {
      await createPin("1234").expect(200);
      const res = await updatePin("12", userPayload.password).expect(400);
      expect(res.body.error).toBe("PIN must be 4 digits");
    });
  });

  describe("Verify PIN", () => {
    it("should verify the correct PIN", async () => {
      await createPin("1234").expect(200);
      await updatePin("2468", userPayload.password).expect(200);
      const res = await verifyPin("2468").expect(200);
      expect(res.body.message).toBe("PIN verified successfully");
    });

    it("should reject incorrect PIN", async () => {
      await createPin("1234").expect(200);
      await updatePin("2468", userPayload.password).expect(200);
      const res = await verifyPin("0000").expect(401);
      expect(res.body.error).toBe("Incorrect PIN");
    });

    it("should reject invalid PIN format", async () => {
      const res = await verifyPin("abcd").expect(400);
      expect(res.body.error).toBe("Invalid PIN format");
    });
  });
});
