import {FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply} from "fastify";
import {sendSms} from "../../services/smsService.ts";
import {UsersTable} from "../db/schema.js";
import {eq} from "drizzle-orm";

export const ensureUserExists = async (request: FastifyRequest, mobile: string) =>
  (await request.db.select().from(UsersTable).where(eq(UsersTable.mobile, mobile)))[0] || null;

export const getOtpKey = (userId: string | number) => `otp:${userId}`;
export const saveOtp = (request: FastifyRequest, key: string, otp: string) => request.server.redis.set(key, otp, "EX", 60);
export const getOtp = (request: FastifyRequest, key: string) => request.server.redis.get(key);
export const deleteOtp = (request: FastifyRequest, key: string) => request.server.redis.del(key);
export const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const buildJwtPayload = (user: any) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  type: user.type,
  mobile: user.mobile,
});

export const requestOtpSchema = {
  tags: ["One Time PIN Code"],
  body: {
    type: "object",
    required: ["mobile"],
    properties: {mobile: {type: "string", minLength: 10, maxLength: 15}},
    additionalProperties: false
  },
  response: {
    200: {type: "object", properties: {message: {type: "string"}, otpCode: {type: "string"}}},
    400: {type: "object", properties: {error: {type: "string"}}},
    500: {type: "object", properties: {error: {type: "string"}}}
  },
};

export const verifyOtpSchema = {
  tags: ["One Time PIN Code"],
  body: {
    type: "object",
    required: ["otp", "mobile"],
    properties: {mobile: {type: "string"}, otp: {type: "string", minLength: 6, maxLength: 6}},
    additionalProperties: false
  },
  response: {
    200: {type: "object", properties: {message: {type: "string"}, resetToken: {type: "string"}}},
    400: {type: "object", properties: {error: {type: "string"}}},
    401: {type: "object", properties: {error: {type: "string"}}},
    500: {type: "object", properties: {error: {type: "string"}}}
  },
};

export const generateOtpHandler = async (request: FastifyRequest, user: { id: string; mobile: string }) => {
  const otp = generateOtp();
  if (process.env.SMS_ENABLED === "true"){ 
    await sendSms({recipient: user.mobile, message: `Your OTP is ${otp}`});
  }
  await saveOtp(request, getOtpKey(user.id), otp);
  return otp;
};

export const requestOtpCode = async (request: FastifyRequest<{ Body: { mobile: string } }>, reply: FastifyReply) => {
  try {
    const {mobile} = request.body;
    const user = await ensureUserExists(request, mobile);
    if (!user) return reply.code(400).send({error: "Mobile number not registered"});

    const otp = await generateOtpHandler(request, user);
    return reply.send({message: "OTP sent successfully", otpCode: otp});
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({error: "Internal Server Error"});
  }
};

export const verifyOtpCode = async (request: FastifyRequest<{
  Body: { mobile: string; otp: string }
}>, reply: FastifyReply) => {
  try {
    const {mobile, otp} = request.body;
    if (!mobile?.trim() || !otp?.trim()) return reply.code(400).send({error: "Mobile and OTP are required"});

    const user = await ensureUserExists(request, mobile);
    if (!user) return reply.code(404).send({error: "Mobile number not registered"});

    const key = getOtpKey(user.id);
    const storedOtp = await getOtp(request, key);
    if (!storedOtp) return reply.code(400).send({error: "OTP expired or invalid"});
    if (storedOtp !== otp) return reply.code(400).send({error: "Incorrect OTP"});

    await deleteOtp(request, key);
    const resetToken = await reply.jwtSign(buildJwtPayload(user), {expiresIn: "1h"});

    return reply.send({message: "OTP verified successfully", resetToken});
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({error: "Internal Server Error"});
  }
};

const OneTimePinCodeRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  server.post("/otp/request", {schema: requestOtpSchema}, requestOtpCode);
  server.post("/otp/verify", {schema: verifyOtpSchema}, verifyOtpCode);
};

export default OneTimePinCodeRoutesPlugin;