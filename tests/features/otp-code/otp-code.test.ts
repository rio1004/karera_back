import { describe, it, beforeAll, afterAll, expect } from "vitest";
import supertest from "supertest";
import Fastify from "fastify";
import OneTimePinCodeRoutesPlugin from "../src/api/OneTimePinCodeRoutesPlugin";
import fastifyJwt from "@fastify/jwt";

let app: ReturnType<typeof Fastify>;
let token: string;

describe("OTP Routes", () => {
  beforeAll(async () => {
    app = Fastify();
    app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("db", {
      select: () => ({
        from: () => ({
          where: () => [{ id: "u1", mobile: "09123456789" }],
        }),
      }),
    });
    await app.register(OneTimePinCodeRoutesPlugin);
    await app.ready();
    token = app.jwt.sign({ id: "u1", mobile: "09123456789" });
  });

  afterAll(() => app.close());

  it("should request OTP successfully", async () => {
    const res = await supertest(app.server)
      .post("/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({ mobile: "09123456789" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OTP sent successfully");
    expect(res.body.otpCode).toHaveLength(6);
  });

  it("should fail request with unregistered mobile", async () => {
    app.db.select = () => ({ from: () => ({ where: () => [] }) });

    const res = await supertest(app.server)
      .post("/otp/request")
      .set("Authorization", `Bearer ${token}`)
      .send({ mobile: "09999999999" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Mobile number not registered");
  });

  it("should verify OTP successfully", async () => {
    await app.redis.set("otp:09123456789", "123456");
    const res = await supertest(app.server)
      .post("/otp/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ otp: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OTP verified successfully");
  });

  it("should reject incorrect OTP", async () => {
    await app.redis.set("otp:09123456789", "123456");
    const res = await supertest(app.server)
      .post("/otp/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ otp: "654321" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Incorrect OTP");
  });

  it("should reject expired OTP", async () => {
    const res = await supertest(app.server)
      .post("/otp/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ otp: "123456" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("OTP expired or invalid");
  });
});
