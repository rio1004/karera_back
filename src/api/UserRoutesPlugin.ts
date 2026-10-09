import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import fs from 'fs';
import {UsersTable, PasswordResetOtpTable, EkycTable, WalletTable, ProfilesTable, BannedPlayersTable, UserSessionTable} from '../db/schema.ts';
import { userTypeValues, statusEnum } from '../db/schema.ts';
import { and, or, ilike, gte, lte, desc, sql, eq } from "drizzle-orm"

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'; 
import * as schema from '../db/schema.ts'; 
import { error_response_schema_400, error_response_schema_401, error_response_schema_404, error_response_schema_500 } from './utils/schemaUtils.ts';
import { sendSms } from '../../services/smsService.ts';
import {generateOtpHandler} from "./OneTimePinCodeRoutesPlugin.js";
import { createEkyc, createOrUpdateEkyc } from "./EkycRoutesPlugin.ts";
import path from 'path';
import { globalAuthentication } from '../app.ts';

// declare module 'fastify' {
//   interface FastifyInstance {
//     authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
//     db: NodePgDatabase<typeof schema>;
//   }
//   interface FastifyReply {
//     jwtSign(payload: object | string, options?: object): Promise<string>;
//   }
//   interface FastifyRequest {
//     db: NodePgDatabase<typeof schema>;
//   }
// }

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      userName: string;
      email: string;
      firstName: string;
      lastName: string;
      mobile: string;
      type: string;
    };
  }
}

const UserRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance, opts) => {
  await server.register(import('@fastify/multipart'));
  // JWT authentication preHandler
  globalAuthentication(server);

  server.post('/register', { schema: registerSchema }, register);
  server.post('/login', { schema: loginSchema }, login);
  server.post('/logout', { preHandler: server.authenticate, schema: logoutSchema }, logout);
  server.get('/verify-login', { preHandler: server.authenticate, schema: verifyLoginSchema }, verifyLogin);
  server.get('/debug-jwt', { schema: debugJwtSchema }, debugJwt);
  server.get('/users', { preHandler: server.authenticate, schema: getAllUsersSchema }, getAllUsers);
  server.post('/users/update-password', { preHandler: server.authenticate, schema: updatePasswordSchema }, updatePassword);
  server.post('/users/reset-password', { schema: requestPasswordUpdateSchema }, requestPasswordUpdate);
  server.post('/users/confirm-reset-password', { schema: confirmPasswordUpdateSchema }, confirmPasswordUpdate);
  // NOTE: lets comment out these apis for now as we might use them later
  // server.post('/users/forgot-password-by-mobile', { schema: forgotPasswordByMobileSchema }, forgotUserPasswordByMobileNumber);
  // server.post('/users/forgot-password', {preHandler: server.authenticate, schema: forgotPasswordByUserIdSchema }, forgotUserPassword);
  // NOTE: insure that the last /users/ apis are above the /users/:id so it wont have a conflict
  server.get('/users/:id', { preHandler: server.authenticate, schema: getUserByIdSchema }, getUserById);
  server.patch('/users/:id', { preHandler: server.authenticate, schema: updateUserSchema }, updateUser);

  server.post('/users/:id/profile-picture', { preHandler: server.authenticate, schema: profileSchema }, uploadProfilePicture);
  server.delete('/users/:id/profile-picture', { preHandler: server.authenticate , schema: deleteProfilePhotoSchema }, deleteProfilePictureHandler);
  server.patch("/users/:id/nickname",{ preHandler: server.authenticate, schema: updateNicknameSchema }, updateNickname);
};

interface RegisterBody {
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobile: string;
  type: 'player' | 'admin' | 'moderator' | 'operator' | 'host' | 'host_monitoring' | 'masteragent' | 'site_betting_cashier' | 'site_betting_staff' | 'supervisor' | 'accounting' | 'agent' | 'cashier';
  status: 'active' | 'inactive';
  password: string;
  permanentAddress: string;
  currentAddress: string;
  birthDate: string;
  birthPlace: string;
  age: string;
  idType: string;
  nationality: string;
  gamingSite: string;
  natureOfWork: string;
  sourceOfIncome: string;
  ekycTransactionId: string;
  profileMeta: any;
}



interface LoginBody {
  userNameOrEmail: string;
  password: string;
}

interface GetAllUsersQuery {
  limit?: string;
  offset?: string;
}

const registerSchema = {
  description: 'Register a new user',
  tags: ['User'],
  body: {
    type: 'object',
    required: [
      'firstName',
      'lastName',
      'userName',
      'email',
      'mobile',
      'type',
      'password',
      'permanentAddress',
      'currentAddress',
      'birthDate',
      'birthPlace',
      'nationality',
      'gamingSite',
      'natureOfWork',
      'sourceOfIncome'
    ],
    properties: {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      userName: { type: 'string', minLength: 3 },
      email: { type: 'string', format: 'email' },
      mobile: { type: 'string', minLength: 11 },
      type: { type: 'string', enum: userTypeValues },
      password: { type: 'string', minLength: 6 },
      ekycTransactionId: { type: 'string' },
      permanentAddress: { type: 'string' },
      currentAddress: { type: 'string' },
      birthDate: { type: 'string', format: 'date' },
      birthPlace: { type: 'string' },
      nationality: { type: 'string' },
      gamingSite: { type: 'string' },
      natureOfWork: { type: 'string' },
      sourceOfIncome: { type: 'string' },
      profileMeta: { type: 'object', additionalProperties: true }
      
    }
  },
  response: {
    201: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            userName: { type: 'string' },
            email: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
            permanentAddress: { type: 'string' },
            currentAddress: { type: 'string' },
            birthDate: { type: 'string', format: 'date' },
            birthPlace: { type: 'string' },
            idType: { type: 'string' }, 
            nationality: { type: 'string' },
            gamingSite: { type: 'string' },
            natureOfWork: { type: 'string' },
            sourceOfIncome: { type: 'string' },

            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            ekycTransactionId: { type: 'string' }
          }
        },
        profile: {
          type: ['object', 'null'],
          properties: {
            id: { type: 'number' },
            userId: { type: 'number' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            permanentAddress: { type: 'string' },
            currentAddress: { type: 'string' },
            birthDate: { type: 'string', format: 'date' },
            birthPlace: { type: 'string' },
            nationality: { type: 'string' },
            gamingSite: { type: 'string' },
            natureOfWork: { type: 'string' },
            sourceOfIncome: { type: 'string' },
            profilePicture: { type: 'string' },
            profilePictureUrl: { type: 'string' },
            meta: { type: ['object', 'null'], additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        token: { type: 'string' },
        otpCode: { type: 'string' }
      }
    },
    400: error_response_schema_400,
    403: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        message: { type: 'string' },
        validation: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              instancePath: { type: 'string' },
              schemaPath: { type: 'string' },
              keyword: { type: 'string' },
              params: { type: 'object' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    500: error_response_schema_500
  }
};


const loginSchema = {
  description: 'Login a user',
  tags: ['User'],
  body: {
    type: 'object',
    required: ['userNameOrEmail', 'password'],
    properties: {
      userNameOrEmail: { type: 'string' },
      password: { type: 'string' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            userName: { type: 'string' },
            email: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
            status: { type: 'string', enum: statusEnum.enumValues},
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            ekycTransactionId: { type: 'string' }
          }
        },
        token: { type: 'string' }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500,
  }
};

const profileSchema = {
  description: "Upload profile picture for a user",
  tags: ["users"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "number" }, // userId
    },
  },
  consumes: ["multipart/form-data"],
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        result: {
          type: "object",
          properties: {
            id: { type: "number" },
            userId: { type: "number" },
            profilePicture: { type: "string" },
            meta: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
};

const deleteProfilePhotoSchema = {
  description: 'Delete a user’s profile photo',
  tags: ['User'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    404: error_response_schema_404,
    500: error_response_schema_500
  }
};

const updateNicknameSchema = {
  description: "Update user's nickname in profile meta",
  tags: ["User"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", description: "User ID" }
    }
  },
  body: {
    type: "object",
    required: ["nickname"],
    properties: {
      nickname: { type: "string", minLength: 1 }
    }
  },
  response: {
    200: {
      type: "object",
      properties: {
        message: { type: "string" },
        profile: { type: "object", additionalProperties: true }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    404: error_response_schema_404,
    500: error_response_schema_500
  }
};

// const getAllUsersSchema = {
//   description: 'Get all users with pagination',
//   tags: ['User'],
//   querystring: {
//     type: 'object',
//     properties: {
//       limit: { type: 'string', description: 'Number of users to return' },
//       offset: { type: 'string', description: 'Number of users to skip' }
//     }
//   },
//   response: {
//     200: {
//       type: 'object',
//       properties: {
//         users: {
//           type: 'array',
//           items: {
//             type: 'object',
//             properties: {
//               id: { type: 'string', format: 'uuid' },
//               firstName: { type: 'string' },
//               lastName: { type: 'string' },
//               userName: { type: 'string' },
//               email: { type: 'string' },
//               mobile: { type: 'string' },
//               type: { type: 'string', enum: userTypeValues },
//               createdAt: { type: 'string', format: 'date-time' },
//               updatedAt: { type: 'string', format: 'date-time' }
//             }
//           }
//         },
//         limit: { type: 'number' },
//         offset: { type: 'number' }
//       }
//     },
//     500: error_response_schema_500
//   }
// };

// user object schema
const userSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    userId: { type: "string" }, // was bigint in DB but now serialized to string
    firstName: { type: ["string", "null"] },
    lastName: { type: ["string", "null"] },
    userName: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    mobile: { type: ["string", "null"] },
    type: { type: "string" },
    status: { type: "string", enum: statusEnum.enumValues},
    birthDate: { type: ["string", "null"], format: "date-time" },
    hashedPassword: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  },
  required: ["id", "userId", "firstName", "lastName", "userName", "type", "status", "createdAt", "updatedAt"]
};

export const getAllUsersSchema = {
  description: "Get all users with pagination",
  tags: ["User"],
  querystring: {
    type: "object",
    properties: {
      limit: { type: 'integer', minimum: 1, default: 100 },
      offset: { type: 'integer', minimum: 0, default: 0 },
      type: { 
        type: 'string', 
        enum: userTypeValues,
        description: 'Filter users by type (e.g., "host", "player", "admin")'
      },
      startDate: {
        type: 'string',
        pattern: '^[0-9]{8}$',
        description: 'Filter transactions created on or after this date (YYYYMMDD)'
      },
      endDate: {
        type: 'string',
        pattern: '^[0-9]{8}$',
        description: 'Filter transactions created on or before this date (YYYYMMDD)'
      },
      search: {
        type: 'string',
        description: 'Search keyword applied to users fields (e.g. transactionNumber, gameName, site, etc.)'
      }
    }
  },
  response: {
    200: {
      type: "object",
      properties: {
        users: {
          type: "array",
          items: {
            allOf: [
              userSchema,
              {
                type: "object",
                properties: {
                  profile: { type: ["object", "null"], additionalProperties: true }
                }
              }
            ]
          }
        },
        totalRows: { type: 'integer' },
        limit: { type: "integer" },
        offset: { type: "integer" }
      }
    }
  }
};

const verifyLoginSchema = {
  description: 'Verify JWT and return user info',
  tags: ['User'],
  response: {
    200: {
      type: 'object',
      properties: {
        user: { type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
          }
        }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const logoutSchema = {
  description: 'Logout user (stateless, just a message)',
  tags: ['User'],
  response: {
    200: {
      type: 'object',
      properties: { message: { type: 'string' } }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const debugJwtSchema = {
  description: 'Decode and log JWT token from Authorization header',
  tags: ['Debug'],
  response: {
    200: {
      type: 'object',
      properties: { 
        decoded: { type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
            iat: { type: 'number' },
            exp: { type: 'number' },
          }
        }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500
  }
};

const updateUserSchema = {
  description: 'Update a user by ID',
  tags: ['User'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' }
    }
  },
  body: {
    type: 'object',
    properties: {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      userName: { type: 'string' },
      email: { type: 'string', format: 'email' },
      mobile: { type: 'string' },
      type: { type: 'string', enum: userTypeValues },
      status: { type: 'string', enum: statusEnum.enumValues},
      profileMeta: { type: 'object', additionalProperties: true },
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            userName: { type: 'string' },
            email: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
            status: { type: 'string', enum: statusEnum.enumValues},
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        profile: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    400: error_response_schema_400,
    401: error_response_schema_401,
    500: error_response_schema_500,
  }
};

const updatePasswordSchema = {
  description: 'Update user password without Email or confirm password',
  tags: ['Debug'],
  body: {
    type: 'object',
    required: ['userNameOrEmail', 'newPassword'],
    properties: {
      userNameOrEmail: { type: 'string' },
      newPassword: { type: 'string', minLength: 6 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        user: { type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
          }
        } }
    },
    400: error_response_schema_400,
    404: error_response_schema_400,
    500: error_response_schema_500
  }
};

const requestPasswordUpdateSchema = {
  description: 'Request a password update link via email',
  tags: ['User'],
  body: {
    type: 'object',
    required: ['userNameOrEmail'],
    properties: {
      userNameOrEmail: { type: 'string' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        user: { type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
          }
        },
        otp: { type: 'string' },
      }
    },
    400: error_response_schema_400,
    404: error_response_schema_404,
    500: error_response_schema_500
  }
};

const confirmPasswordUpdateSchema = {
  description: 'Confirm password update via sms',
  tags: ['User'],
  body: {
    type: 'object',
    required: ['otp','userName', 'newPassword', 'confirmNewPassword'],
    properties: {
      otp: { type: 'string' },
      userName: { type: 'string', minLength: 3 },
      newPassword: { type: 'string', minLength: 6 },
      confirmNewPassword: { type: 'string', minLength: 6 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: { 
        message: { type: 'string' },
        user: { type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
          }
        } }
    },
    400: error_response_schema_400,
    404: error_response_schema_400,
    500: error_response_schema_500
  }
};

const getUserByIdSchema = {
  description: 'Get a user by ID',
  tags: ['User'],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            userName: { type: 'string' },
            birthDate: { type: 'string' },
            birthPlace: { type: 'string' },
            email: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string', enum: userTypeValues },
            status: { type: 'string', enum: statusEnum.enumValues},
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: 'string', format: 'date-time' },
          }
        },
        profile: {
          type: 'object',
          additionalProperties: true
        }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

// Schema for forgot password by mobile number
const forgotPasswordByMobileSchema = {
  description: 'Forgot password using mobile number',
  tags: ['User'],
  body: {
    type: 'object',
    required: ['mobile', 'newPassword', 'confirmNewPassword'],
    properties: {
      mobile: { type: 'string' },
      newPassword: { type: 'string', minLength: 6 },
      confirmNewPassword: { type: 'string', minLength: 6 }
    }
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' }, user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, userName: { type: 'string' }, email: { type: 'string', format: 'email' }, firstName: { type: 'string' }, lastName: { type: 'string' }, mobile: { type: 'string' }, type: { type: 'string', enum: userTypeValues } } } } },
    400: error_response_schema_400,
    404: error_response_schema_400,
    500: error_response_schema_500
  }
};

// Schema for forgot password by user ID
const forgotPasswordByUserIdSchema = {
  description: 'Forgot password using user ID',
  tags: ['User'],
  body: {
    type: 'object',
    required: ['userId', 'newPassword', 'confirmNewPassword'],
    properties: {
      userId: { type: 'string', format: 'uuid' },
      newPassword: { type: 'string', minLength: 6 },
      confirmNewPassword: { type: 'string', minLength: 6 }
    }
  },
  response: {
    200: { type: 'object', properties: { message: { type: 'string' }, user: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, userName: { type: 'string' }, email: { type: 'string', format: 'email' }, firstName: { type: 'string' }, lastName: { type: 'string' }, mobile: { type: 'string' }, type: { type: 'string', enum: userTypeValues } } } } },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

async function checkBannedPlayer(db: any, firstName: string, lastName: string): Promise<boolean> {
  try {
    const bannedPlayer = await db
      .select({ id: BannedPlayersTable.id })
      .from(BannedPlayersTable)
      .where(
        or(
          // Exact matches
          ilike(BannedPlayersTable.name, `%${firstName}%${lastName}%`),
          ilike(BannedPlayersTable.name, `%${lastName}%${firstName}%`),
          // Contains both first and last names (for middle names)
          and(
            ilike(BannedPlayersTable.name, `%${firstName}%`),
            ilike(BannedPlayersTable.name, `%${lastName}%`)
          )
        )
      )
      .limit(1);
    return bannedPlayer.length > 0;
  } catch (error) {
    console.error('Error checking banned players:', error);
    return false;
  }
}

export async function register(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply
) {
  const {
    firstName,
    lastName,
    userName,
    email,
    mobile,
    password,
    type,
    ekycTransactionId,
    permanentAddress,
    currentAddress,
    birthDate,
    birthPlace,
    age,
    idType,
    nationality,
    gamingSite,
    natureOfWork,
    sourceOfIncome,
    profileMeta,
  } = request.body;

  try {
    // ✅ Check if the user is in banned players list
    const isBanned = await checkBannedPlayer(request.db, firstName, lastName);
    if (isBanned) {
      return reply.code(403).send({
        error: "Registration blocked",
        message:
          "This name is associated with a banned player and registration is not allowed. Contact support for more information.",
      });
    }

    // ✅ Check duplicate mobile
    const [existingUser] = await request.db
      .select()
      .from(UsersTable)
      .where(eq(UsersTable.mobile, mobile));

    if (existingUser) {
      return reply.code(400).send({ error: "Mobile number already exists" });
    }

    const saltRounds = process.env.NODE_ENV === "test" ? 1 : 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const now = new Date();
    const status = "active";

    const newUser = await request.db.transaction(async (tx) => {
      const [insertedUser] = await tx
        .insert(UsersTable)
        .values({
          firstName,
          lastName,
          userName,
          email,
          mobile,
          type,
          status,
          hashedPassword,
        })
        .returning();

      // ✅ eKYC creation inside transaction
      await createEkyc(tx, {
        userId: insertedUser.id,
        status: "NEW",
      });

      await tx.insert(ProfilesTable).values({
        userId: insertedUser.id,
        permanentAddress,
        currentAddress,
        birthDate,
        birthPlace,
        nationality,
        gamingSite,
        natureOfWork,
        sourceOfIncome,
        meta: {
          ...(profileMeta || {}),
          nickname: userName, // add username as nickname
        },
      });

      const walletTypes: Array<"game" | "commission" | "load"> = ["game", "commission", "load"];
      // if (["operator", "representative", "rep1", "rep2"].includes(type)) {
      //   walletTypes.push("commission", "load");
      // }

      const walletInsertData = walletTypes.map((walletType) => ({
        userId: insertedUser.id,
        balance: "0",
        onHoldBalance: "0",
        status: "active" as "active" | "frozen" | "closed",
        type: walletType,
        createdAt: now,
        updatedAt: now,
      }));

      await tx.insert(WalletTable).values(walletInsertData);

      return insertedUser;
    });

    // ✅ Generate OTP
    const otpCode = await generateOtpHandler(request, {
      id: String(newUser.id),
      mobile: newUser.mobile,
    });

    // ✅ Sign JWT
    const token = await reply.jwtSign({
      id: String(newUser.id),
      userName: newUser.userName,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      mobile: newUser.mobile,
      type: newUser.type,
    });

    // ✅ Insert session (replace old if exists)
    const existingSession = await request.db
      .select()
      .from(UserSessionTable)
      .where(eq(UserSessionTable.userId, newUser.id));

    if (existingSession.length > 0) {
      await request.db
        .delete(UserSessionTable)
        .where(eq(UserSessionTable.userId, newUser.id));
    }

    await request.db.insert(UserSessionTable).values({
      userId: newUser.id,
      token,
      deviceInfo: request.headers["user-agent"] || "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // ✅ Fetch created profile
    const createdProfile = await request.db.query.ProfilesTable.findFirst({
      where: (profiles, { eq }) => eq(profiles.userId, newUser.id),
    });

    return reply.code(201).send({
      user: {
        id: newUser.id,
        userName: newUser.userName,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        mobile: newUser.mobile,
        type: newUser.type,
        ekycTransactionId,
      },
      profile: createdProfile,
      token,
      otpCode,
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    const isUniqueViolation =
      error?.code === "23505" || error?.cause?.code === "23505";
    if (isUniqueViolation) {
      let message = "Duplicate value";
      const constraint =
        error?.constraint || error?.cause?.constraint || "";
      if (constraint.includes("userName")) message = "Username already exists";
      else if (constraint.includes("email")) message = "Email already exists";
      else if (constraint.includes("mobile")) message = "Mobile already exists";

      return reply.code(400).send({
        error: "Validation error",
        message,
      });
    }

    return reply.code(500).send({ error: "Internal Server Error" });
  }
}



async function login(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply
) {
  const { userNameOrEmail, password } = request.body;
  try {
    // 🔍 Find user by userName or email
    const user = await request.db.query.UsersTable.findFirst({
      where: (users, { eq, or }) =>
        or(
          eq(users.userName, userNameOrEmail),
          eq(users.email, userNameOrEmail)
        ),
    });

    if (!user) {
      return reply
        .code(401)
        .send({ error: "Invalid credentials", message: "Invalid username or email" });
    }

    // 🔑 Compare password
    const isMatch = await bcrypt.compare(password, user.hashedPassword);
    if (!isMatch) {
      return reply
        .code(401)
        .send({ error: "Invalid credentials", message: "Invalid password" });
    }

    // 🆕 Sign JWT
    const token = await reply.jwtSign({
      id: user.id,
      userName: user.userName,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      mobile: user.mobile,
      type: user.type,
    });

    // 🔄 Handle User Session
    const existingSession = await request.db
      .select()
      .from(UserSessionTable)
      .where(eq(UserSessionTable.userId, user.id));

    if (existingSession.length > 0) {
      // ✅ Remove old session → this invalidates the old JWT
      await request.db
        .delete(UserSessionTable)
        .where(eq(UserSessionTable.userId, user.id));
    }

    // ✅ Insert new session with updated token
    await request.db.insert(UserSessionTable).values({
      userId: user.id,
      token,
      deviceInfo: request.headers["user-agent"] || "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 🚫 Don’t send hashed password back
    const { hashedPassword, ...userWithoutPassword } = user;

    return reply.code(200).send({
      user: userWithoutPassword,
      token,
    });
  } catch (error) {
    request.log.error("Login error:", error);
    return reply.code(500).send({ error: "Internal server error" });
  }
}


function serializeBigInt(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  );
}

export async function uploadProfilePicture(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const data = await request.file(); // using fastify-multipart
    const userId = request.user.id; // make sure userId comes from auth/session

    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    // Generate filename
    const uniqueName = `profile-${Date.now()}-${data.filename}`;
    const uploadDir = path.join("/app/uploads/profiles", String(userId));

    // fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, uniqueName);

    // Save the file to disk
    // const buffer = await data.toBuffer();
    // await fs.promises.writeFile(filePath, buffer);


    // Insert/update in DB
    const metaData = { uploadedBy: userId, ip: request.ip };

    const result = await request.db
      .insert(ProfilesTable)
      .values({
        userId: Number(userId),
        profilePicture: uniqueName,
        profilePictureUrl: filePath,
        meta: JSON.stringify(metaData), // 👈 stringify here
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: ProfilesTable.userId,
        set: {
          profilePicture: uniqueName,
          profilePictureUrl: filePath,
          meta: JSON.stringify(metaData), // 👈 and here
          updatedAt: new Date(),
        },
      })
      .returning();
    
    const profile = result[0];
    
    return reply.send({
      success: true,
      message: "Profile picture uploaded successfully",
      result: {
        ...profile,
        meta: typeof profile.meta === 'string' ? JSON.parse(profile.meta) : profile.meta, // 👈 safely parse meta field
      },
    });
    

  } catch (err) {
    console.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function deleteProfilePictureHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };

  try {
    // 1. Find existing profile
    const profile = await request.db.query.ProfilesTable.findFirst({
      where: eq(ProfilesTable.userId, Number(id)),
    });

    if (!profile || !profile.profilePicture) {
      return reply.code(404).send({
        error: "Not Found",
        message: "Profile picture not found.",
      });
    }

    // 2. Remove file from disk
    try {
      await fs.promises.unlink(profile.profilePicture);
    } catch (e) {
      request.log.warn(`File not found on disk: ${profile.profilePicture}`);
    }

    // 3. Clear DB reference
    const [updated] = await request.db
      .update(ProfilesTable)
      .set({ profilePicture: null, profilePictureUrl: null, updatedAt: new Date() })
      .where(eq(ProfilesTable.userId, Number(id)))
      .returning();

    return reply.code(200).send({
      success: true,
      message: "Profile picture deleted successfully",
      result: updated,
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.code(500).send({
      error: "Internal server error",
      message: err.message,
    });
  }
}

async function updateNickname(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { id } = request.params as { id: string };
  const { nickname } = request.body as {nickname:string};
  const db = request.db;

  try {
    // check if profile exists
    const existing = await db
      .select()
      .from(ProfilesTable)
      .where(eq(ProfilesTable.userId, id));

    if (!existing.length) {
      return reply.code(404).send({ error: "Profile not found" });
    }

    // merge/update meta
    const currentMeta = existing[0].meta || {};
    const updatedMeta = { ...currentMeta, nickname };

    await db
      .update(ProfilesTable)
      .set({ meta: updatedMeta, updatedAt: new Date() })
      .where(eq(ProfilesTable.userId, id));

    return reply.code(200).send({
      message: "Nickname updated successfully",
      profile: { ...existing[0], meta: updatedMeta }
    });
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: "Failed to update nickname" });
  }
}



async function getAllUsers(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { limit = 100, offset = 0, startDate, endDate, search, type } = req.query as any;

    const parseDate = (d: string, end = false) =>
      new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${end ? "23:59:59" : "00:00:00"}Z`);

    const dateFilter =  and(
      startDate ? gte(UsersTable.createdAt, parseDate(startDate)) : undefined,
      endDate ? lte(UsersTable.createdAt, parseDate(endDate, true)) : undefined,
    );

    const typeFilter = type ? eq(UsersTable.type, type) : undefined;

    const searchFilter = search
      ? or(
        !isNaN(Number(search)) ? eq(UsersTable.userId, Number(search)) : undefined,
        ilike(UsersTable.firstName, `%${search}%`),
        ilike(UsersTable.lastName, `%${search}%`),
        ilike(UsersTable.userName, `%${search}%`),
        ilike(UsersTable.email, `%${search}%`),
        ilike(UsersTable.mobile, `%${search}%`),
        userTypeValues.includes(search as any)
          ? eq(UsersTable.type, search as (typeof userTypeValues)[number])
          : undefined
      )
      : undefined;

      const where = and(dateFilter, typeFilter, searchFilter);
      const [totalRowsResult, rows] = await Promise.all([
        req.db.select({ count: sql<number>`count(*)` }).from(UsersTable).where(where),
        req.db
          .select({
            user: UsersTable,
            profile: ProfilesTable,
          })
          .from(UsersTable)
          .leftJoin(ProfilesTable, eq(ProfilesTable.userId, UsersTable.id))
          .where(where)
          .orderBy(desc(UsersTable.createdAt))
          .limit(+limit)
          .offset(+offset),
      ]);
  
      const users = rows.map(({ user, profile }) => ({
        ...serializeBigInt(user),
        profile: serializeBigInt(profile),
      }));
  
      return reply.code(200).send({
        totalRows: Number(totalRowsResult[0]?.count || 0),
        limit: +limit,
        offset: +offset,
        users,
      });
  } catch (error) {
    req.log.error(error, "Failed to get users");
    return reply.code(500).send({ error: "Internal server error" });
  }
}

async function verifyLogin(request: FastifyRequest, reply: FastifyReply) {
  // The decoded JWT payload is usually attached to request.user by the authenticate preHandler
  // If your implementation is different, adjust accordingly
  // We'll return the user info from the JWT
  reply.code(200).send({ user: request.user });
}

async function debugJwt(request: FastifyRequest, reply: FastifyReply) {
  // Get the token from the Authorization header
  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(400).send({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7); // Remove 'Bearer '
  try {
    const decoded = request.server.jwt.decode(token);
    console.log(decoded)
    // Log the decoded payload
    request.log.info({ decoded }, 'Decoded JWT payload');
    reply.code(200).send({ decoded });
  } catch (err) {
    reply.code(400).send({ error: 'Invalid JWT token', message: err.message });
  }
}

async function logout(request: FastifyRequest, reply: FastifyReply) {
  // Optionally, you can require authentication here if you want
  reply.code(200).send({ message: 'Logged out successfully. Please delete your token on the client.' });
}

async function updateUser(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { firstName, lastName, userName, email, mobile, type, status, profileMeta } =
    request.body as Partial<RegisterBody> & { profileMeta?: any };

  if (!id) {
    reply.code(400).send({ error: 'Validation error', message: 'User ID is required.' });
    return;
  }

  if (request.user.type !== 'admin') {
    return reply.code(403).send({ error: 'Forbidden', message: 'You are not allowed to update user details.' });
  }

  const updateData: any = {};
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (userName !== undefined) updateData.userName = userName;
  if (email !== undefined) updateData.email = email;
  if (mobile !== undefined) updateData.mobile = mobile;
  if (type !== undefined) updateData.type = type;
  if (status !== undefined) updateData.status = status;

  try {
    const updatedUsers = await request.db.update(UsersTable)
      .set(updateData)
      .where(eq(UsersTable.id, Number(id))) // cast
      .returning();

    if (!updatedUsers.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'User with the given ID was not found.' });
    }
    let profile = null;
    if (profileMeta !== undefined) {
      const updatedProfile = await request.db.update(ProfilesTable)
        .set({ meta: profileMeta})
        .where(eq(ProfilesTable.userId, Number(id))); // cast
      if (updatedProfile) {
        profile = await request.db.query.ProfilesTable.findFirst({ where: (profiles, { eq }) => eq(profiles.userId, Number(id)) });
      }
    }

    const { hashedPassword, ...userWithoutPassword } = updatedUsers[0];
    reply.code(200).send({ user: userWithoutPassword, profile: profile });

  } catch (error: any) {
    const isUniqueViolation =
      (error.code && error.code === '23505') ||
      (error.cause && error.cause.code === '23505');
    if (isUniqueViolation) {
      let message = 'Username already exists';
      const constraint = error.cause.constraint || '';
      if (constraint.includes('userName')) {
        message = 'Username already exists';
      } else if (constraint.includes('email')) {
        message = 'Email already exists';
      } else if (constraint.includes('mobile')) {
        message = 'Mobile number already exists';
      } else {
        message = `Duplicate field value violates unique constraint: ${constraint}`;
      }
      return reply.code(400).send({
        error: 'Duplicate field value violates unique constraint',
        validation: [
          {
            instancePath: '/userName|/email|/mobile',
            schemaPath: '#/properties/userName|#/properties/email|#/properties/mobile',
            keyword: 'notFound',
            params: {},
            message: message
          }
        ]
      });
    } else {
      reply.code(500).send({ error: 'Internal server error', message: error.message });
    }
  }
}

async function updatePassword(request: FastifyRequest, reply: FastifyReply) {
  const { userNameOrEmail, newPassword } = request.body as { userNameOrEmail: string; newPassword: string };
  if (!userNameOrEmail || !newPassword) {
    reply.code(400).send({ error: 'Both userNameOrEmail and newPassword are required.' });
    return;
  }
  try {
    // Find user by userName or email
    const user = await request.db.query.UsersTable.findFirst({
      where: (users, { eq, or }) =>
        or(
          eq(users.userName, userNameOrEmail),
          eq(users.email, userNameOrEmail)
        ),
    });
    if (!user) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'User with the given userNameOrEmail was not found.'
      });
    }
    const saltRounds = process.env.NODE_ENV === 'test' ? 1 : 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await request.db.update(UsersTable)
      .set({ hashedPassword })
      .where(eq(UsersTable.id, user.id));
    reply.code(200).send({ message: 'Password updated and email sent.', user: user });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

async function requestPasswordUpdate(request: FastifyRequest, reply: FastifyReply) {
  const { userNameOrEmail } = request.body as { userNameOrEmail: string };
  const { no_sms } = request.query as { no_sms: string };
  try {
    // Find user by userName or email
    const user = await request.db.query.UsersTable.findFirst({
      where: (users, { eq, or }) =>
        or(
          eq(users.userName, userNameOrEmail),
          eq(users.email, userNameOrEmail)
        ),
    });
    if (!user) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'User with the given userNameOrEmail was not found.'
      });
    }
    // Generate secure  6 digit otp that is not already used
    let otp = Math.floor(100000 + Math.random() * 900000).toString();
    while (await request.db.query.PasswordResetOtpTable.findFirst({ where: (t, { eq }) => eq(t.otp, otp) })) {
      otp = Math.floor(100000 + Math.random() * 900000).toString();
    }
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 min expiry
    await request.db.insert(PasswordResetOtpTable).values({
      userId: user.id,
      userName: user.userName,
      otp,
      expiresAt,
      used: 'false',
    });
    // Should not send sms if url param has no_sms=true
    if (no_sms !== 'true') {
      sendSms({ recipient: user.mobile, message: `Your password update OTP is ${otp}` } );
    }
    reply.code(200).send({ message: 'Your password update OTP has been sent to your mobile number.', user: user, otp });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

async function confirmPasswordUpdate(request: FastifyRequest, reply: FastifyReply) {
  const { otp, userName, newPassword, confirmNewPassword } = request.body as { otp: string, userName: string, newPassword: string, confirmNewPassword: string };
  if (newPassword !== confirmNewPassword) {
    return reply.code(400).send({
      error: 'Validation error',
      validation: [
        {
          message: 'New password and confirmation do not match.'
        }
      ]
    });
  }
  try {
    // Find token
    const otpRow = await request.db.query.PasswordResetOtpTable.findFirst({
      where: (t, { eq, and }) => and(eq(t.otp, otp), eq(t.userName, userName)),
    });
    if (!otpRow || otpRow.used === 'true' || new Date(otpRow.expiresAt) < new Date()) {
      return reply.code(400).send({
        error: 'Validation error',
        validation: [
          {
            message: 'Invalid or expired otp or userName.'
          }
        ]
      });
    }
    // Find user
    const user = await request.db.query.UsersTable.findFirst({
      where: (users, { eq, or }) => or(eq(users.id, otpRow.userId), eq(users.userName, userName)),
    });
    if (!user) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'User with the given otp or userName was not found.'
      });
    }
    
    // Hash and update new password
    const saltRounds = process.env.NODE_ENV === 'test' ? 1 : 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await request.db.update(UsersTable)
      .set({ hashedPassword })
      .where(eq(UsersTable.id, user.id));
    // Invalidate otp
    await request.db.update(PasswordResetOtpTable)
      .set({ used: 'true' })
      .where(eq(PasswordResetOtpTable.id, otpRow.id));
    reply.code(200).send({ message: 'Password updated successfully.', user: user });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

async function forgotUserPasswordByMobileNumber(request: FastifyRequest, reply: FastifyReply) {

  const { mobile, newPassword, confirmNewPassword } = request.body as { mobile: string, newPassword: string, confirmNewPassword: string };
  if (!mobile || !newPassword || !confirmNewPassword) {
    return reply.code(400).send({ error: 'Validation error',
      validation: [
        {
          message: 'Mobile, newPassword, and confirmNewPassword are required.'
        }
      ]
    });
  }
  if (newPassword !== confirmNewPassword) {
    return reply.code(400).send({ error: 'Validation error',
      validation: [
        {
          message: 'New password and confirm password do not match.'
        }
      ]
    });
  }
  try {
    const user = await request.db.query.UsersTable.findFirst({ where: (users, { eq }) => eq(users.mobile, mobile) });
    if (!user) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'User with the given mobile number was not found.'
      });
    }
    const isSame = await bcrypt.compare(newPassword, user.hashedPassword);
    if (isSame) {
      return reply.code(409).send({ error: 'Validation error',
        validation: [
          {
            message: 'New password must not be the same as the old password.'
          }
        ]
      });
    }
    const saltRounds = process.env.NODE_ENV === 'test' ? 1 : 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await request.db.update(UsersTable)
      .set({ hashedPassword })
      .where(eq(UsersTable.id, user.id));
    reply.code(200).send({ message: 'Password updated successfully.', user: user });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

async function forgotUserPassword(request: FastifyRequest, reply: FastifyReply) {
  const { userId, newPassword, confirmNewPassword } = request.body as { userId: string, newPassword: string, confirmNewPassword: string };
  if (!userId || !newPassword || !confirmNewPassword) {
    return reply.code(400).send({ error: 'Validation error',
      validation: [
        {
          message: 'userId, newPassword, and confirmNewPassword are required.'
        }
      ]
    });
  }
  if (newPassword !== confirmNewPassword) {
    return reply.code(400).send({ error: 'Validation error',
      validation: [
        {
          message: 'New password and confirm password do not match.'
        }
      ]
    });
  }
  try {
    const user = await request.db.query.UsersTable.findFirst({ where: (users, { eq }) => eq(users.id, Number(userId)) });
    if (!user) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'User with the given userId was not found.'
      });
    }
    const saltRounds = process.env.NODE_ENV === 'test' ? 1 : 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await request.db.update(UsersTable)
      .set({ hashedPassword })
      .where(eq(UsersTable.id, Number(userId)));
    reply.code(200).send({ message: 'Password updated successfully.', user: user });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

async function getUserById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  try {
    const user = await request.db.query.UsersTable.findFirst({
      where: (users, { eq }) => eq(users.id, Number(id)),
    });
    if (!user) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'User with the given id was not found.'
      });
    }

    // Fetch the user's profile
    const profile = await request.db.query.ProfilesTable.findFirst({
      where: (profiles, { eq }) => eq(profiles.userId, Number(id)),
    });

    const { hashedPassword, ...userWithoutPassword } = user;
    const { birthDate, birthPlace } = profile;
    const mergedUser = {...userWithoutPassword, birthDate, birthPlace};

    reply.code(200).send({ user: mergedUser, profile: profile });
  } catch (error) {
    reply.code(500).send({ error: 'Internal server error', message: error.message });
  }
}

export default UserRoutesPlugin; 