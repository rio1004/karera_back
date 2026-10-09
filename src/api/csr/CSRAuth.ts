import { FastifyInstance } from 'fastify';
import { CSRUserSocket, CSRUser } from './CSRPlugin.ts';
import { parseJwtPayload } from '../dosletra/Auth.ts';

export class CSRAuth {
  static async authenticate(
    fastify: FastifyInstance,
    csrSocket: CSRUserSocket,
    token: string
  ): Promise<boolean> {
    try {
      const jwtPayload = parseJwtPayload(token, fastify);

      if (!jwtPayload) return false;

      // Assign full user info to socket
      const user: CSRUser = {
        id: jwtPayload.id,
        firstName: jwtPayload.firstName,
        lastName: jwtPayload.lastName,
        mobile: jwtPayload.mobile,
        userName: jwtPayload.userName,
        email: jwtPayload.email,
        token,
        type: jwtPayload.type
      };

      csrSocket.user = user;
      csrSocket.token = token;
      csrSocket.type = user.type;

      if (user.type === "csr") {
        fastify.csrSockets.set(user.id, csrSocket); // use id for CSRs
        fastify.authenticatedSockets.set(`csr:${user.id}`, csrSocket);
      } else if (user.type === "player") {
        fastify.authenticatedSockets.set(user.mobile, csrSocket);
      }

      return true;
    } catch (e) {
      fastify.log.error({ e }, 'Authentication error');
      return false;
    }
  }
}
