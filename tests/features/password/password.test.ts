import {FastifyInstance} from "fastify";
import request from "supertest";
import {describe, it, expect, beforeAll, afterAll, beforeEach, afterEach} from "vitest";
import {Utils} from "../../utils/utils.js";
import UserRoutesPlugin from "../../../src/api/UserRoutesPlugin.ts";
import PasswordRoutesPlugin from "../../../src/api/PasswordRoutesPlugin.ts";
import {faker} from "@faker-js/faker";

describe("Password Routes", () => {
  const url = "postgresql://postgres:postgres@aggregator_db:5432/postgres";
  const dbName = "passwordTest";
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
    password: "oldpassword123", // fixed to test change
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

  const changePassword = (oldPassword: string, newPassword: string, newRepeatPassword: string) =>
    request(server.server)
      .patch("/password/change")
      .set("Authorization", `Bearer ${authToken}`)
      .send({oldPassword, newPassword, newRepeatPassword});

  beforeAll(async () => {
    server = await utils.beforeAll(url, dbName, true);
    server.register(UserRoutesPlugin);
    server.register(PasswordRoutesPlugin);
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

  describe("Change Password", () => {
    it("should change password successfully", async () => {
      const res = await changePassword("oldpassword123", "newpassword123", "newpassword123").expect(200);
      expect(res.body.message).toBe("Your password has been changed successfully");

      // login with new password
      const loginRes = await request(server.server)
        .post("/login")
        .send({userNameOrEmail: userPayload.email, password: "newpassword123"})
        .expect(200);

      expect(loginRes.body.token).toBeDefined();
    });

    it("should reject when new passwords do not match", async () => {
      const res = await changePassword("oldpassword123", "newpassword123", "wrongrepeat").expect(400);
      expect(res.body.error).toBe("Passwords do not match");
    });

    it("should reject when old password is incorrect", async () => {
      const res = await changePassword("wrongOld", "newpassword123", "newpassword123").expect(401);
      expect(res.body.error).toBe("You have entered an incorrect password");
    });

    it("should reject when new password is the same as old password", async () => {
      const res = await changePassword("oldpassword123", "oldpassword123", "oldpassword123").expect(400);
      expect(res.body.error).toBe("New password cannot be the same as old");
    });

    it("should reject unauthorized request", async () => {
      const res = await request(server.server)
        .patch("/password/change")
        .send({oldPassword: "x", newPassword: "y", newRepeatPassword: "y"})
        .expect(401);
      expect(res.body.error).toBe("Unauthorized Request");
    });
  });
});
