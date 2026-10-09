import fastify, { FastifyInstance } from "fastify";
import { EventManager, EventMessage, Channel, JwtPayload, Message, UserSocket, inStudio, GameState, GameValues } from "./DosLetraPlugin.ts";
import { broadcastPlayerCount } from "./Broadcast.ts";
import { WebSocket } from 'ws';

export class Auth {
  static async authenticate(fastify: FastifyInstance, studioNo:string, socket: WebSocket, message: string) {
    try {
      const msg: Message = JSON.parse(message.toString());
      if (msg.state === GameState.Authenticate) {
        const data = msg.data; // dataPayload is now directly the object from msg.data

        // Ensure 'token' property exists and is a string
        if (!('token' in data) || typeof data.token !== 'string') {
            console.log("authenticate failed: 'token' not found or not a string in data", data);
            socket.close();
            return;
        }

        const jwtPayload = parseJwtPayload(data.token, fastify);

        if (jwtPayload !== null) {
          fastify.authenticatedSockets.get(studioNo).set(jwtPayload.mobile, new UserSocket(socket, jwtPayload));
          
          const redis = fastify.redis.dosletra;
          if (!redis.status || redis.status !== 'ready') {
            return;
          }

          // add to player set if type is "player"
          if (jwtPayload.type === "player") {
            await redis.sadd(inStudio(studioNo, GameValues.AllPlayers), jwtPayload.mobile);

            // broadcast new player count
            const eventMessage = new EventMessage(msg, jwtPayload, data.token, studioNo);
            await broadcastPlayerCount(fastify, eventMessage, studioNo);
          }

          socket.send(JSON.stringify(new Message(Channel.Game, GameState.Authenticate, { data: "Success" })));

          socket.on('message', (message: string) => {
            let parsedMessage: Message = JSON.parse(message.toString());
            const eventMessage = new EventMessage(parsedMessage, jwtPayload, data.token, studioNo);
            EventManager.emit('message', eventMessage);
          });
        } else {
          console.log("authenticate failed", data.token);
          socket.close();
        }
      }
    } catch (e) {
      console.log("authenticate failed", message, e);
      socket.close();
    }
  }
}

export function parseToken(token: string, fastify: FastifyInstance) {
  let userSocket: UserSocket | null = null;
  try {
    const decodedToken = fastify.jwt.verify(token) as JwtPayload;
    userSocket = new UserSocket(null, decodedToken);
    userSocket.firstName = decodedToken.firstName;
    userSocket.lastName = decodedToken.lastName;
    userSocket.userName = decodedToken.userName;
    userSocket.email = decodedToken.email;
    userSocket.mobile = decodedToken.mobile;
    userSocket.type = decodedToken.type;
  } catch (e) {
    userSocket = null;
  }

  return userSocket;
}

export function parseJwtPayload(token: string, fastify: FastifyInstance) {
  try {
    const decodedToken = fastify.jwt.verify(token) as JwtPayload;
    decodedToken.token = token;
    return decodedToken;
  } catch (e) {
    return null;
  }
}
