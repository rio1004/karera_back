import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FastifyPluginAsync } from 'fastify';
import { EkycTable, SelfieTable, IdTable, UserSessionTable } from '../db/schema.ts';
import fs from 'fs';
import path from 'path';
import { UsersTable } from '../db/schema.ts';
import { eq , and } from 'drizzle-orm';
import { error_response_schema_400, error_response_schema_500 } from './utils/schemaUtils.ts';
import { callKairos } from './utils/kairosClient.ts';
import FormData from "form-data";
import { pipeline as pipelineCallback, Writable } from "stream";
import { promisify } from "util";
import { globalAuthentication } from '../app.ts';

const pipeline = promisify(pipelineCallback);
const EkycRoutesPlugin: FastifyPluginAsync = async (server: FastifyInstance) => {
  await server.register(import('@fastify/multipart'));
  // JWT authentication preHandler
  globalAuthentication(server);

  server.get('/ekyc', { schema: getAllEkycSchema }, getAllEkycHandler);
  server.get('/ekyc/:userId', { schema: getEkycByIdSchema, preHandler: [server.authenticate] }, getEkycByIdHandler);
  server.post('/ekyc', { schema: postEkycSchema, preHandler: [server.authenticate] }, postEkycHandler);
  server.patch('/ekyc/:userId', { schema: patchEkycSchema, preHandler: [server.authenticate] }, patchEkycHandler);
  server.patch('/ekyc/:userId/status', { schema: patchEkycStatusSchema, preHandler: [server.authenticate]}, patchEkycStatusHandler);
  server.delete('/ekyc/:userId', { schema: deleteEkycSchema, preHandler: [server.authenticate] }, deleteEkycHandler);

  server.post('/ekyc/:id/liveness', { schema: postSelfieSchema, preHandler: [server.authenticate] }, postSelfieHandler);
  server.post('/ekyc/:id/id', { schema: postIdSchema, preHandler: [server.authenticate] }, postIdHandler);

  // server.post("/ekyc/:id/liveness-verification", { schema: postLivenessSchema, preHandler: [server.authenticate] }, postLivenessHandler);
  // server.post("/ekyc/:id/document-verification/upload", { schema: postDocumentSchema, preHandler: [server.authenticate] }, postDocumentHandler);
  // server.get("/ekyc/:id/document-verification", { schema: getDocumentVerificationSchema, preHandler: [server.authenticate] },getDocumentVerificationHandler);
  // server.get("/ekyc/:id/liveness-verification", { preHandler: [server.authenticate] }, getLivenessVerificationHandler);
  // server.post("/ekyc/:id/full-id-verification", { schema: postFullIdVerificationSchema, preHandler: [server.authenticate] }, postFullIdVerificationHandler);
  // server.post("/ekyc/:id/biometric-verification", { schema: postBiometricSchema, preHandler: [server.authenticate] }, postBiometricHandler);
  // server.get("/ekyc/:id/biometric-verification", { preHandler: [server.authenticate] }, getBiometricVerificationHandler);  

};


interface EkycBody {
  userId: string;
  imagePath: string;
  status: string;
  birthplace: string;
  birthDate: string;
  age: string;
  idType: string;
  submittedAt: string;
}

const postEkycSchema = {
  description: `
  Create Initial eKYC record No Image as it will be handled by Zoloz
  `,
  tags: ['eKYC'],
  body: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'number' },
      status: { type: 'string', enum: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'DENIED'] },
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            userName: { type: 'string' },
            email: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string', nullable: true },
            birthPlace: { type: 'string', nullable: true },
            birthDate: { type: 'string', nullable: true },
            age: { type: 'string', nullable: true },
            idType: { type: 'string', nullable: true},
            submittedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

// --- PATCH /ekyc SCHEMA ---
export const patchEkycSchema = {
  description: 'Update eKYC details for a user',
  tags: ['eKYC'],
  params: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'number' }
    }
  },
  body: {
    type: 'object',
    required: ['birthDate'],
    properties: {
      birthPlace: { type: 'string' },
      birthDate: { type: 'string' },
      type: { type: 'string', enum: ["Driver's License", 'UMID (Unified Multi-Purpose ID', 'Postal ID', 'Passport', 'SSS ID', 'PRC ID', 'National ID']}
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            userId: { type: 'number' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            userName: { type: 'string' },
            email: { type: 'string' },
            mobile: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string', nullable: true },
            birthPlace: { type: 'string', nullable: true },
            birthDate: { type: 'string', nullable: true },
            age: { type: 'string', nullable: true },
            idType: { type: 'string', nullable: true},
            submittedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

export const patchEkycStatusSchema = {
  description: "Update eKYC status (Admin only)",
  tags: ["eKYC"],
  params: {
    type: "object",
    required: ["userId"],
    properties: {
      userId: { type: "number" },
    },
  },
  body: {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["UNVERIFIED", "PENDING", "VERIFIED", "DENIED"] },
    },
  },
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
            status: { type: "string" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    403: {
      type: "object",
      properties: {
        error: { type: "string" },
        message: { type: "string" },
      },
    },
    404: {
      type: "object",
      properties: {
        error: { type: "string" },
        message: { type: "string" },
      },
    },
    500: error_response_schema_500,
  },
};


// --- GET /ekyc SCHEMA ---
export const getAllEkycSchema = {
  description: 'Get all eKYC details with pagination',
  tags: ['eKYC'],
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'string', description: 'Number of records to return' },
      offset: { type: 'string', description: 'Number of records to skip' },
      status: { type: 'string', description: 'Filter by eKYC status' },
      age: { type: 'string', description: 'Filter by age' },
      submittedAt: { type: 'string', format: 'date-time', description: 'Filter by submittedAt (ISO string)' },
      deletedAt: { type: 'string', format: 'date-time', description: 'Filter by deletedAt (ISO string)' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        ekycRecords: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              userId: { type: 'number' },
              imagePath: { type: 'string' },
              status: { type: 'string' },
              birthPlace: { type: 'string' },
              birthDate: { type: 'string' },
              age: { type: 'string' },
              idType: { type: 'string' },
              submittedAt: { type: 'string', format: 'date-time' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              deletedAt: { type: 'string', format: 'date-time' }
            }
          }
        },
        limit: { type: 'number' },
        offset: { type: 'number' }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

// --- GET /ekyc/:id SCHEMA ---
export const getEkycByIdSchema = {
  description: 'Get eKYC details for a user by ID',
  tags: ['eKYC'],
  params: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        // eKYC
        ekycId: { type: 'number' },
        userId: { type: 'number' },
        status: { type: 'string' },
        meta: { type: 'object' }, // previously was imagePath, age, etc.
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time' },

        // ID info
        idId: { type: 'number' },
        frontPath: { type: 'string' },
        backPath: { type: 'string', nullable: true },
        idStatus: { type: 'string' },
        type: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        gender: { type: 'string' },
        birthPlace: { type: 'string' },
        birthDate: { type: 'string' },
        nationality: { type: 'string' },
        natureOfWork: { type: 'string' },

        // Selfie info
        selfieId: { type: 'number', nullable: true },
        filePath: { type: 'string', nullable: true },
        selfieMeta: { type: 'string', nullable: true },
        selfieCreatedAt: { type: 'string', format: 'date-time', nullable: true },
        selfieUpdatedAt: { type: 'string', format: 'date-time', nullable: true },
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

// --- DELETE /ekyc/:id SCHEMA ---
export const deleteEkycSchema = {
  description: 'Delete eKYC details for a user by ID',
  tags: ['eKYC'],
  params: {
    type: 'object',
    required: ['userId'],
    properties: {
      userId: { type: 'number' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            userId: { type: 'number' },
            imagePath: { type: 'string' },
            status: { type: 'string' },
            birthPlace: { type: 'string', nullable: true },
            birthDate: { type: 'string', nullable: true },
            age: { type: 'string', nullable: true },
            idType: { type: 'string', nullable: true},
            submittedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            deletedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

export const postSelfieSchema = {
  description: "Upload selfie for manual eKYC verification",
  tags: ["eKYC"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "number" } // eKYC record ID
    }
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
            ekycId: { type: "number" },
            filePath: { type: "string" },
            meta: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        }
      }
    },
    400: error_response_schema_400,
    500: error_response_schema_500
  }
};

export const postIdSchema = {
  description: "Upload ID front and back images for manual eKYC verification",
  tags: ["eKYC"],
  consumes: ["multipart/form-data"],
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "number" },
    },
  },
  // ✅ use requestBody instead of body for multipart
  requestBody: {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          properties: {
            documentFront: { type: "string", format: "binary" },
            documentBack: { type: "string", format: "binary" },
            type: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            gender: { type: "string" },
            birthPlace: { type: "string" },
            birthDate: { type: "string", format: "date" },
            nationality: { type: "string" },
            natureOfWork: { type: "string" },
          },
          required: ["documentFront"],
        },
      },
    },
  },
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
            ekycId: { type: "number" },
            frontPath: { type: "string" },
            backPath: { type: "string" },
            type: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            gender: { type: "string" },
            birthPlace: { type: "string" },
            birthDate: { type: "string", format: "date" },
            nationality: { type: "string" },
            natureOfWork: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    400: error_response_schema_400,
    500: error_response_schema_500,
  },
};

// export const postLivenessSchema = {
//   description: "Verify liveness of user by selfie",
//   tags: ['eKYC'],
//   params: {
//     type: 'object',
//     required: ['id'],
//     properties: {
//       id: { type: 'string', format: 'uuid' }
//     }
//   },
//   requestBody: {
//     required: true,
//     content: {
//       'multipart/form-data': {
//         schema: {
//           type: 'object',
//           properties: {
//             selfie: {
//               type: 'string',
//               format: 'binary',
//               description: 'Selfie image for liveness verification'
//             },
//             threshold: {
//               type: 'number',
//               description: 'Optional threshold for liveness verification'
//             }
//           },
//           required: ['selfie']
//         }
//       }
//     }
//   },
//   response: {
//     200: {
//       description: 'Liveness verification result',
//       type: 'object',
//       properties: {
//         success: { type: 'boolean' },
//         message: { type: 'string' },
//         result: { type: 'object' },
//         kairos: { type: 'object' }
//       }
//     },
//     400: error_response_schema_400,
//     500: error_response_schema_500
//   }
// };

// export const postDocumentSchema = {
//   description: "Verify user's document by uploading front and back images",
//   tags: ['eKYC'],
//   params: {
//     type: 'object',
//     required: ['id'],
//     properties: {
//       id: { type: 'string', format: 'uuid' }
//     }
//   },
//   requestBody: {
//     required: true,
//     content: {
//       'multipart/form-data': {
//         schema: {
//           type: 'object',
//           properties: {
//             document: {
//               type: 'string',
//               format: 'binary',
//               description: 'Front side of the ID document'
//             },
//             document_back: {
//               type: 'string',
//               format: 'binary',
//               description: 'Back side of the ID document'
//             }
//           },
//           required: ['document', 'document_back']
//         }
//       }
//     }
//   },
//   response: {
//     200: {
//       description: 'Document verification result',
//       type: 'object',
//       properties: {
//         success: { type: 'boolean' },
//         message: { type: 'string' },
//         result: { type: 'object' },
//         kairos: { type: 'object' }
//       }
//     },
//     400: error_response_schema_400,
//     500: error_response_schema_500
//   }
// };

// // schema
// export const getDocumentVerificationSchema = {
//   description: 'Get Kairos document verification result by eKYC ID',
//   tags: ['eKYC'],
//   params: {
//     type: 'object',
//     required: ['id'],
//     properties: {
//       id: { type: 'string', format: 'uuid' }
//     }
//   },
//   response: {
//     200: {
//       type: 'object',
//       properties: {
//         success: { type: 'boolean' },
//         message: { type: 'string' },
//         kairos: { type: 'object' }
//       }
//     },
//     400: error_response_schema_400,
//     500: error_response_schema_500
//   }
// };

// export const postFullIdVerificationSchema = {
//   summary: "Full ID Verification",
//   description: "Uploads ID document (front, back, selfie) for verification",
//   tags: ["eKYC"],
//   consumes: ["multipart/form-data"],
//   params: {
//     type: "object",
//     required: ["id"],
//     properties: {
//       id: { type: "string" }
//     }
//   },
//   response: {
//     200: {
//       type: "object",
//       properties: {
//         success: { type: "boolean" },
//         message: { type: "string" },
//         result: { type: "object" },
//         kairos: { type: "object" }
//       }
//     }
//   }
// }

// export const postBiometricSchema = {
//   description: "Perform biometric verification using a selfie and a reference image",
//   tags: ["eKYC"],
//   consumes: ["multipart/form-data"],
//   params: {
//     type: "object",
//     required: ["id"],
//     properties: {
//       id: { type: "string", format: "uuid" }
//     }
//   },
//   requestBody: {
//     required: true,
//     content: {
//       "multipart/form-data": {
//         schema: {
//           type: "object",
//           required: ["selfie", "image"],
//           properties: {
//             selfie: { type: "string", format: "binary", description: "Selfie image (min 480x480)" },
//             image: { type: "string", format: "binary", description: "Photo for face comparison (min 480x480)" },
//             image_multiface: { type: "boolean", description: "Set true if photo contains multiple faces" }
//           }
//         }
//       }
//     }
//   },
//   response: {
//     200: {
//       description: "Biometric verification result",
//       type: "object",
//       properties: {
//         success: { type: "boolean" },
//         message: { type: "string" },
//         result: { type: "object" },
//         kairos: { type: "object" }
//       }
//     },
//     400: { type: "object", properties: { error: { type: "string" } } },
//     500: { type: "object", properties: { error: { type: "string" }, details: { type: ["string", "object"] } } }
//   }
// }
// --- DELETE /ekyc/:id HANDLER ---
export async function deleteEkycHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as { userId: number };
  try {
    // 1. Fetch the record to get the image path
    const ekyc = await request.db.query.EkycTable.findFirst({
      where: (ekyc, { eq }) => eq(ekyc.userId, userId)
    });
    if (!ekyc) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'eKYC record not found.'
      });
    }

    // 3. Soft delete the DB record
    // const [deleted] = await request.db.delete(EkycTable)
    //   .where(eq(EkycTable.id, id))
    //   .returning();
    // reply.code(200).send({ success: true, message: 'eKYC record deleted.' });
    const [updated] = await request.db.update(EkycTable)
      .set({
        deletedAt: new Date(),
      })
      .where(eq(EkycTable.userId, userId))
      .returning();
    reply.code(200).send({ success: true, message: 'eKYC record set to deleted.', result: updated });
  } catch (err) {
    reply.code(500).send({
      error: 'Internal server error',
      message: err.message
    });
  }
}

// --- GET /ekyc HANDLER ---
export async function getAllEkycHandler(request: FastifyRequest, reply: FastifyReply) {
  const { limit, offset, status, age, submittedAt, deletedAt } = request.query as any;
  const limitNum = Number(limit) || 10;
  const offsetNum = Number(offset) || 0;

  // Build conditions array
  const conditions = [];
  if (status) conditions.push(eq(EkycTable.status, status));
  if (deletedAt) conditions.push(eq(EkycTable.deletedAt, new Date(deletedAt)));

  try {
    let query = request.db.select().from(EkycTable);
    const finalQuery = conditions.length > 0
      ? query.where(and(...conditions))
      : query;
    const ekycRecords = await finalQuery.limit(limitNum).offset(offsetNum);
    reply.code(200).send({ ekycRecords, limit: limitNum, offset: offsetNum });
  } catch (err) {
    reply.code(500).send({
      error: 'Internal server error',
      validation: [],
      message: err.message
    });
  }
}

// --- GET /ekyc/:id HANDLER ---
export async function getEkycByIdHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { userId } = request.params as { userId: string };

  try {
    const result = await request.db
      .select({
        ekycId: EkycTable.id,
        userId: EkycTable.userId,
        status: EkycTable.status,
        meta: EkycTable.meta,
        createdAt: EkycTable.createdAt,
        updatedAt: EkycTable.updatedAt,
        deletedAt: EkycTable.deletedAt,

        // ID info
        idId: IdTable.id,
        frontPath: IdTable.frontPath,
        backPath: IdTable.backPath,
        idStatus: IdTable.status,
        type: IdTable.type,
        firstName: IdTable.firstName,
        lastName: IdTable.lastName,
        gender: IdTable.gender,
        birthPlace: IdTable.birthPlace,
        birthDate: IdTable.birthDate,
        nationality: IdTable.nationality,
        natureOfWork: IdTable.natureOfWork,

        // Selfie info
        selfieId: SelfieTable.id,
        filePath: SelfieTable.filePath,
        selfieMeta: SelfieTable.meta,
        selfieCreatedAt: SelfieTable.createdAt,
        selfieUpdatedAt: SelfieTable.updatedAt,
      })
      .from(EkycTable)
      .leftJoin(IdTable, eq(EkycTable.id, IdTable.ekycId))
      .leftJoin(SelfieTable, eq(EkycTable.id, SelfieTable.ekycId))
      .where(eq(EkycTable.userId, Number(userId)));

    if (!result.length) {
      return reply.code(404).send({
        error: "Not Found",
        message: "eKYC record not found.",
      });
    }

    reply.code(200).send(result[0]);
  } catch (err) {
    reply.code(500).send({
      error: "Internal server error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// --- PATCH /ekyc/:id HANDLER ---
export async function patchEkycHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as { userId: number };
  const { birthPlace, birthDate, type } = request.body as any;

  // Check eKYC record existence
  const ekyc = await request.db.query.EkycTable.findFirst({ where: (ekyc, { eq }) => eq(ekyc.userId, userId) });
  if (!ekyc) {
    return reply.code(404).send({
      error: 'Not Found',
      message: 'eKYC record not found.'
    });
  }
  // Update eKYC record
  try {
    const [updated] = await request.db.update(IdTable)
      .set({
        birthPlace: birthPlace ?? null,
        birthDate: birthDate ?? null,
        type: type ?? null,
        updatedAt: new Date(),
      })
      .where(eq(IdTable.id, ekyc.id))
      .returning();
    reply.code(200).send({ success: true, message: 'eKYC record updated.', result: updated });
  } catch (err) {
    return reply.code(500).send({
      error: 'Internal server error',
      message: err.message,
    });
  }
}

export async function patchEkycStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as { userId: string };
  const { status } = request.body as { status: string };

  try {
    // 🔑 Check if requester is Admin
    const currentUser = request.user; // assuming you attach user info to request after auth
    if (!currentUser || currentUser.type !== "admin") {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Only admin users can update eKYC status.",
      });
    }

    // ✅ Check if record exists
    const ekyc = await request.db.query.EkycTable.findFirst({
      where: (ekyc, { eq }) => eq(ekyc.userId, Number(userId)),
    });
    if (!ekyc) {
      return reply.code(404).send({
        error: "Not Found",
        message: "eKYC record not found.",
      });
    }

    // 🔄 Update only status
    const [updated] = await request.db
      .update(EkycTable)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(EkycTable.userId, Number(userId)))
      .returning();

    return reply.code(200).send({
      success: true,
      message: "eKYC status updated successfully.",
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


export async function createOrUpdateEkyc(db: any, { userId, status, birthPlace, birthDate, age, idType }: any) {
  const now = new Date();

  // Check if user exists
  const user = await db.query.UsersTable.findFirst({
    where: (user, { eq }) => eq(user.id, userId),
  });
  if (!user) throw new Error("User does not exist");

  // Check existing record
  const existingEkyc = await db.query.EkycTable.findFirst({
    where: (ekyc, { eq }) => eq(ekyc.userId, userId),
  });

  if (existingEkyc) {
    const [updated] = await db.update(EkycTable)
      .set({
        status: status || "UNVERIFIED",
        birthPlace: birthPlace || null,
        birthDate: birthDate || null,
        age: age || null,
        idType: idType,
        updatedAt: now,
        submittedAt: now,
      })
      .where(eq(EkycTable.id, existingEkyc.id))
      .returning();
    return updated;
  } else {
    const [inserted] = await db.insert(EkycTable)
      .values({
        userId,
        status: status || "UNVERIFIED",
        birthPlace: birthPlace || null,
        birthDate: birthDate || null,
        age: age || null,
        idType: idType,
        submittedAt: now,
      })
      .returning();
    return inserted;
  }
}

export async function createEkyc(db: any, { userId }: any) {
  // Check if user exists
  const user = await db.query.UsersTable.findFirst({
    where: (user, { eq }) => eq(user.id, userId),
  });
  if (!user) throw new Error("User does not exist");

  // Check existing record
  const existingEkyc = await db.query.EkycTable.findFirst({
    where: (ekyc, { eq }) => eq(ekyc.userId, userId),
  });

  if (existingEkyc) throw new Error("eKYC already exist for this user");

  const [inserted] = await db.insert(EkycTable)
    .values({
      userId,
      status: "UNVERIFIED"
    })
    .returning();
  return inserted;
}

export async function updateEkyc(db: any, { userId, status }: any) {
  // Check if user exists
  const user = await db.query.UsersTable.findFirst({
    where: (user, { eq }) => eq(user.id, userId),
  });
  if (!user) throw new Error("User does not exist");

  // Check existing record
  const existingEkyc = await db.query.EkycTable.findFirst({
    where: (ekyc, { eq }) => eq(ekyc.userId, userId),
  });

  if (!existingEkyc) throw new Error("eKYC does not exist for this user");

  const [updated] = await db.update(EkycTable)
      .set({
        status: status,
      })
      .where(eq(EkycTable.id, existingEkyc.id))
      .returning();
    return updated;
}


// --- POST /ekyc HANDLER ---
export async function postEkycHandler(request: FastifyRequest, reply: FastifyReply) {
  const { userId, status, birthPlace, birthDate, age, idType } = request.body as any;

  try {
    // const ekycRecord = await createOrUpdateEkyc(request.db, {
    //   userId,
    //   status,
    //   birthPlace,
    //   birthDate,
    //   age,
    //   idType
    // });
    const ekycRecord = await createOrUpdateEkyc(request.db, {
        userId,
        status
      });

    return reply.code(200).send({
      success: true,
      message: "eKYC record processed successfully.",
      result: ekycRecord,
    });
  } catch (err: any) {
    if (err.message === "User does not exist") {
      return reply.code(400).send({ error: "Validation error", message: err.message });
    }
    return reply.code(500).send({ error: "Internal server error", message: err.message });
  }
}

export async function postSelfieHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };

  try {
    // 1. Validate eKYC record
    const ekyc = await request.db.query.EkycTable.findFirst({
      where: (ekyc, { eq }) => eq(ekyc.id, id),
    });
    if (!ekyc) {
      return reply.code(404).send({ error: "Not Found", message: "eKYC record not found." });
    }

    // 2. Ensure multipart request
    if (!request.isMultipart) {
      return reply.code(400).send({ error: "Content-Type must be multipart/form-data" });
    }

    // 3. Handle file upload
    let selfiePath: string | null = null;
    for await (const part of request.parts()) {
      if (part.type === "file" && part.fieldname === "selfie") {
        const uploadDir = path.join(process.cwd(), "uploads", "ekyc", String(id), "selfies");
        fs.mkdirSync(uploadDir, { recursive: true });

        selfiePath = path.join(uploadDir, `selfie-${Date.now()}-${part.filename}`);
        await fs.promises.writeFile(selfiePath, await part.toBuffer());
      }
    }

    if (!selfiePath) {
      return reply.code(400).send({ error: "Validation error", message: "Selfie file is required" });
    }

    // 4. Insert into SelfieTable
    const [inserted] = await request.db.insert(SelfieTable).values({
      ekycId: id,
      filePath: selfiePath,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    // 5. Check if ID record exists for this eKYC
    const idRecord = await request.db.query.IdTable.findFirst({
      where: eq(IdTable.ekycId, id),
    });

    // 6. If both ID + Selfie exist → update eKYC status to pending
    if (idRecord) {
      await request.db
        .update(EkycTable)
        .set({ status: "pending", updatedAt: new Date() })
        .where(eq(EkycTable.id, id));
    }

    return reply.code(200).send({
      success: true,
      message: "Selfie uploaded successfully",
      result: inserted,
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error", message: err.message });
  }
}

export async function postIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: number };

  try {
    // 1) Validate eKYC record
    const ekyc = await request.db.query.EkycTable.findFirst({
      where: (ekyc, { eq }) => eq(ekyc.id, id),
    });
    if (!ekyc) {
      return reply.code(404).send({ error: "Not Found", message: "eKYC record not found." });
    }

    // 2) Ensure multipart
    if (typeof (request as any).isMultipart === "function" ? !(request as any).isMultipart() : !(request as any).isMultipart) {
      return reply.code(400).send({ error: "Content-Type must be multipart/form-data" });
    }

    const uploadDir = path.join(process.cwd(), "uploads", "ekyc", String(id), "docs");
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const allowedFieldNames = new Set([
      "type", "firstName", "lastName", "gender", "birthPlace", "birthDate", "nationality", "natureOfWork"
    ]);

    let documentFrontPath: string | null = null;
    let documentBackPath: string | null = null;
    const extraFields: Record<string, string> = {};

    for await (const part of (request as any).parts()) {
      console.log("Received part:", part.fieldname, part.type);
      if (part.type === "file") {
        const base = part.fieldname === "documentFront" ? "front" :
                     part.fieldname === "documentBack" ? "back" : null;

        if (!base) {
          // Unknown file field; drain it safely
          await pipeline(part.file, new Writable({ write(_c, _e, cb) { cb(); } }));
          continue;
        }

        const safeName = String(part.filename || "file").replace(/[^\w.\-]+/g, "_");
        const targetPath = path.join(uploadDir, `${base}-${Date.now()}-${safeName}`);
        await pipeline(part.file, fs.createWriteStream(targetPath));

        if (base === "front") documentFrontPath = targetPath;
        if (base === "back") documentBackPath = targetPath;
      } else if (part.type === "field") {
        const key = String(part.fieldname);
        if (allowedFieldNames.has(key)) {
          extraFields[key] = String(part.value ?? "");
        }
      }
    }

    if (!documentFrontPath) {
      return reply.code(400).send({
        error: "Validation error",
        message: "documentFront is required",
      });
    }

    // 3) Insert into IdTable
    const [inserted] = await request.db
      .insert(IdTable)
      .values({
        ekycId: id,
        frontPath: documentFrontPath,
        backPath: documentBackPath,
        status: "pending",
        type: extraFields.type,
        firstName: extraFields.firstName,
        lastName: extraFields.lastName,
        gender: extraFields.gender,
        birthPlace: extraFields.birthPlace,
        birthDate: extraFields.birthDate,
        nationality: extraFields.nationality,
        natureOfWork: extraFields.natureOfWork,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    
      // 4) Check if a selfie exists for this eKYC
      const selfie = await request.db.query.SelfieTable.findFirst({
        where: eq(SelfieTable.ekycId, id),
      });

      // 5) If selfie exists, update eKYC status → pending
      if (selfie) {
        await request.db
          .update(EkycTable)
          .set({
            status: "pending",
            updatedAt: new Date(),
          })
          .where(eq(EkycTable.id, id));
      }

    return reply.code(200).send({
      success: true,
      message: "ID document uploaded successfully",
      result: inserted,
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.code(500).send({ error: "Internal server error", message: err.message });
  }
}

// export async function postLivenessHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };
//   let threshold: number | undefined;
//   let selfieFile: any;

//   try {
//     // 1️⃣ Ensure multipart request
//     if (!request.isMultipart) {
//       return reply.code(400).send({ error: "Content-Type must be multipart/form-data" });
//     }

//     // 2️⃣ Parse parts
//     for await (const part of request.parts()) {
//       if (part.type === "file" && part.fieldname === "selfie") {
//         selfieFile = part;
//       }
//       if (part.type === "field" && part.fieldname === "threshold") {
//         threshold = Number(part.value);
//       }
//     }

//     if (!selfieFile) {
//       return reply.code(400).send({ error: "Selfie file is required" });
//     }

//     // 3️⃣ Build FormData
//     const form = new FormData();
//     form.append("selfie", selfieFile.file, { filename: selfieFile.filename });
//     if (threshold !== undefined) {
//       form.append("threshold", threshold.toString());
//     }

//     // 4️⃣ Call Kairos Liveness Verification
//     const kairosResponse = await callKairos("liveness-verification", form, true);

//     // 5️⃣ Save result in DB
//     const [updated] = await request.db.update(EkycTable)
//       .set({
//         livenessMeta: kairosResponse,
//         ekycStatus: "LIVENESS_VERIFIED",
//         updatedAt: new Date(),
//       })
//       .where(eq(EkycTable.id, id))
//       .returning();

//     return reply.code(200).send({
//       success: true,
//       message: "Liveness verification completed",
//       result: updated,
//       kairos: kairosResponse,
//     });
//   } catch (err: any) {
//     request.log.error(err?.response?.data || err.message);
//     return reply.code(500).send({
//       error: "Liveness verification failed",
//       details: err?.response?.data || err.message,
//     });
//   }
// }

// export async function postDocumentHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };
//   let documentFile: any;
//   let documentBackFile: any;

//   try {
//     if (!request.isMultipart) {
//       return reply.code(400).send({ error: 'Content-Type must be multipart/form-data' });
//     }

//     for await (const part of request.parts()) {
//       if (part.type === 'file') {
//         if (part.fieldname === 'document') documentFile = part;
//         else if (part.fieldname === 'document_back') documentBackFile = part;
//       }
//     }

//     if (!documentFile) {
//       return reply.code(400).send({ error: "Field 'document' is required" });
//     }

//     const form = new FormData();
//     form.append('document', documentFile.file, {
//       filename: documentFile.filename,
//       contentType: documentFile.mimetype,
//     });
//     if (documentBackFile) {
//       form.append('document_back', documentBackFile.file, {
//         filename: documentBackFile.filename,
//         contentType: documentBackFile.mimetype,
//       });
//     }

//     const kairosResponse = await callKairos('document-verification', form, true);

//     // Store the UUID returned by Kairos
//     const { api_req_uuid } = kairosResponse as { api_req_uuid: string };
//     await request.db
//       .update(EkycTable)
//       .set({ ekycTransactionId: api_req_uuid, ekycStatus: 'DOCUMENT_UPLOADED', updatedAt: new Date() })
//       .where(eq(EkycTable.id, id));

//     return reply.code(201).send({
//       success: true,
//       message: 'Document uploaded for verification',
//       api_req_uuid,
//     });
//   } catch (err: any) {
//     request.log.error(err?.response?.data ?? err.message);
//     return reply.code(500).send({
//       error: 'Document upload failed',
//       details: err?.response?.data ?? err.message,
//     });
//   }
// }

// export async function getDocumentVerificationHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };

//   try {
//     // Fetch the eKYC record to get its transaction ID
//     const ekyc = await request.db.query.EkycTable.findFirst({
//       where: (ekyc, { eq }) => eq(ekyc.id, id),
//       columns: { idMeta: true }
//     });

//     if (!ekyc || !ekyc.idMeta) {
//       return reply.code(404).send({
//         error: 'Not Found',
//         message: 'eKYC record or Kairos transaction ID not found.'
//       });
//     }

//     // Call Kairos GET endpoint
//     const kairosResponse = await callKairos(`document-verification/${ekyc.idMeta}`, null, false);

//     return reply.code(200).send({
//       success: true,
//       message: 'Document verification fetched successfully',
//       kairos: kairosResponse
//     });
//   } catch (err: any) {
//     request.log.error(err);
//     return reply.status(500).send({
//       error: 'Internal server error',
//       message: err.message
//     });
//   }
// }

// export async function getLivenessVerificationHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };

//   try {
//     const ekyc = await request.db.query.EkycTable.findFirst({
//       where: (ekyc, { eq }) => eq(ekyc.id, id),
//       columns: { livenessMeta: true }
//     });

//     if (!ekyc || !ekyc.livenessMeta) {
//       return reply.code(404).send({
//         error: 'Not Found',
//         message: 'eKYC record or liveness verification not found.'
//       });
//     }

//     return reply.code(200).send({
//       success: true,
//       message: 'Liveness verification fetched successfully',
//       kairos: ekyc.livenessMeta
//     });
//   } catch (err: any) {
//     request.log.error(err);
//     return reply.status(500).send({
//       error: 'Internal server error',
//       message: err.message
//     });
//   }
// }

// export async function postFullIdVerificationHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };
//   let documentFile: any;
//   let documentBackFile: any;
//   let selfieFile: any;
//   let threshold: number | undefined;

//   try {
//     // 1️⃣ Ensure multipart request
//     if (!request.isMultipart) {
//       return reply.code(400).send({ error: "Content-Type must be multipart/form-data" });
//     }

//     // 2️⃣ Parse uploaded files & fields
//     for await (const part of request.parts()) {
//       if (part.type === "file") {
//         if (part.fieldname === "document") {
//           documentFile = part;
//         } else if (part.fieldname === "document_back") {
//           documentBackFile = part;
//         } else if (part.fieldname === "selfie") {
//           selfieFile = part;
//         }
//       }
//       if (part.type === "field" && part.fieldname === "threshold") {
//         threshold = Number(part.value);
//       }
//     }

//     if (!documentFile || !selfieFile) {
//       return reply.code(400).send({
//         error: "Both 'document' (front) and 'selfie' files are required",
//       });
//     }

//     // 3️⃣ Build FormData
//     const form = new FormData();
//     form.append("document", documentFile.file, { filename: documentFile.filename });
//     if (documentBackFile) {
//       form.append("document_back", documentBackFile.file, { filename: documentBackFile.filename });
//     }
//     form.append("selfie", selfieFile.file, { filename: selfieFile.filename });
//     if (threshold !== undefined) {
//       form.append("threshold", threshold.toString());
//     }

//     // 4️⃣ Call Kairos Full ID Verification API
//     const kairosResponse = await callKairos("full-id-verification", form, true);

//     // 5️⃣ Save result in DB
//     const [updated] = await request.db.update(EkycTable)
//       .set({
//         fullIdMeta: kairosResponse, // store raw JSON from Kairos
//         ekycStatus: "FULL_ID_VERIFIED",
//         updatedAt: new Date(),
//       })
//       .where(eq(EkycTable.id, id))
//       .returning();

//     return reply.code(200).send({
//       success: true,
//       message: "Full ID verification completed",
//       result: updated,
//       kairos: kairosResponse,
//     });
//   } catch (err: any) {
//     request.log.error(err?.response?.data || err.message);
//     return reply.code(500).send({
//       error: "Full ID verification failed",
//       details: err?.response?.data || err.message,
//     });
//   }
// }

// export async function postBiometricHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };
//   let selfieFile: any;
//   let imageFile: any;
//   let imageMultiface: boolean | undefined;

//   try {
//     if (!request.isMultipart) {
//       return reply.code(400).send({ error: "Content-Type must be multipart/form-data" });
//     }

//     for await (const part of request.parts()) {
//       if (part.type === "file") {
//         if (part.fieldname === "selfie") selfieFile = part;
//         else if (part.fieldname === "image") imageFile = part;
//       } else if (part.type === "field" && part.fieldname === "image_multiface") {
//         imageMultiface = part.value === "true";
//       }
//     }

//     if (!selfieFile || !imageFile) {
//       return reply.code(400).send({ error: "Both 'selfie' and 'image' files are required" });
//     }

//     const form = new FormData();
//     form.append("selfie", selfieFile.file, { filename: selfieFile.filename, contentType: selfieFile.mimetype });
//     form.append("image", imageFile.file, { filename: imageFile.filename, contentType: imageFile.mimetype });
//     if (imageMultiface !== undefined) form.append("image_multiface", String(imageMultiface));

//     const kairosResponse = await callKairos("biometric-verification", form, true);

//     console.log("Kairos raw response:", kairosResponse)

//     const [updated] = await request.db.update(EkycTable)
//       .set({
//         biometricMeta: kairosResponse,
//         ekycStatus: "BIOMETRIC_VERIFIED",
//         updatedAt: new Date(),
//       })
//       .where(eq(EkycTable.id, id))
//       .returning({
//         id: EkycTable.id,
//         ekycStatus: EkycTable.ekycStatus,
//         updatedAt: EkycTable.updatedAt,
//         biometricMeta: EkycTable.biometricMeta,
//       });

//       return reply.code(200).send({
//         success: true,
//         message: "Biometric verification completed",
//         result: updated,
//         kairos: kairosResponse,
//     });
//   } catch (err: any) {
//     request.log.error(err?.response?.data || err.message);
//     return reply.code(500).send({
//       error: "Biometric verification failed",
//       details: err?.response?.data || err.message,
//     });
//   }
// }

// export async function getBiometricVerificationHandler(request: FastifyRequest, reply: FastifyReply) {
//   const { id } = request.params as { id: string };

//   try {
//     const ekyc = await request.db.query.EkycTable.findFirst({
//       where: (ekyc, { eq }) => eq(ekyc.id, id),
//       columns: { biometricMeta: true }
//     });

//     if (!ekyc || !ekyc.biometricMeta) {
//       return reply.code(404).send({
//         error: 'Not Found',
//         message: 'eKYC record or biometric verification not found.'
//       });
//     }

//     return reply.code(200).send({
//       success: true,
//       message: 'Biometric verification fetched successfully',
//       kairos: ekyc.biometricMeta
//     });
//   } catch (err: any) {
//     request.log.error(err);
//     return reply.status(500).send({
//       error: 'Internal server error',
//       message: err.message
//     });
//   }
// }



export default EkycRoutesPlugin; 