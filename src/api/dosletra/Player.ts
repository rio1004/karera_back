import { FastifyInstance } from "fastify";
import { EventManager, EventMessage, Channel, GameState, isStart, Message, UserSocket, replyGameWS, GameValues, ChatState, GiftState, getAllKeys, SupportState, inStudio, buildGameData, InternalEvents } from "./DosLetraPlugin.ts";
import {Redis} from "ioredis";

export class Player {
  // Remove static studioNo and make it a private instance property
  private readonly studioNo: string;

  // Constructor replaces the static init method
  constructor(studioNo: string, fastify: FastifyInstance) {
    this.studioNo = studioNo;
    this.initListeners(fastify);
  }
  
  private initListeners(fastify: FastifyInstance) {
    const { authenticatedSockets } = fastify;

    // 1. Message Listener
    EventManager.on('message', async (msg: EventMessage) => {
      // 🎯 CRITICAL FILTER: Only process messages for this instance
      if (msg.studioNo !== this.studioNo) {
        return;
      }
      
      const data = msg.message.data;
      
      if (msg.message.channel === Channel.Chat && msg.message.state === ChatState.Message) {
        const playerMobile = msg.jwtPayload.mobile;
        
        // Use instance's studioNo for socket lookup
        const socket = authenticatedSockets.get(this.studioNo)?.get(playerMobile); 
        
        if (socket) {
          // broadcastMessage must use the fastify instance and provided socket/data
          await broadcastMessage(socket, data.message, fastify); 
        }
        return;
      }

      if (msg.message.channel === Channel.Game && msg.message.state === GameState.History) {
        const { gameId } = msg.message.data;
        const token = msg.jwtPayload.token;
        
        // This function now runs in the context of this studio
        const history = await getGameHistory(fastify, token, gameId);
      
        if (history) {
          await broadcastGameHistory(fastify, history);
        }
        return;
      }
      // These functions must use the studioNo from msg.studioNo for isolation
      await createBet(msg, data, fastify);
    });

    // 2. Gift Event Listener
    EventManager.on('gift', async (msg: Message & { studioNo: string }) => {
      // 🎯 CRITICAL FILTER: Only process gifts for this instance
      // Assumes the Message object has been decorated with studioNo by the emitter.
      if (msg.studioNo !== this.studioNo) { 
          return;
      }

      // Iterates over sockets for this instance's studioNo
      authenticatedSockets.get(this.studioNo)?.forEach((socket) => {
        if (socket.ws.readyState === socket.ws.OPEN) {
          socket.ws.send(JSON.stringify(msg));
        }
      });
    });

    EventManager.on("gameStatus", async (msg: Message) => {
      const status = msg.data?.status;

      const redis = fastify.redis.dosletra;
      await redis.set(GameState.GameStatus, status);

      fastify.authenticatedSockets.forEach((socket, mobile) => {
        if (socket.ws.readyState === socket.ws.OPEN) {
          socket.ws.send(JSON.stringify(msg));

          if (status === "disable") {
            fastify.log.info(`Disconnecting socket for player: ${mobile}`);
            socket.ws.close(1000, "Game disabled");
            fastify.authenticatedSockets.delete(mobile);
          }

          if (status === "enable") {
            fastify.log.info("Game enabled: clients can reconnect");
            fastify.authenticatedSockets.forEach((socket) => {
              if (socket.ws.readyState === socket.ws.OPEN) {
                socket.ws.send(JSON.stringify(
                  new Message(Channel.Game, GameState.GameStatus, { data: { status } })
                ));
              }
            });
          }
        }
      });
    });
  }
}


async function createBet(msg: EventMessage, data: any, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const state = await redis.get(inStudio(msg.studioNo, GameValues.State));
  if (!isBetValid(state, msg)) {
    return;
  }
  const playerMobile = msg.jwtPayload.mobile;
  const socket = fastify.authenticatedSockets.get(msg.studioNo).get(playerMobile);
  const lastName = socket.lastName;
  const firstName = socket.firstName;
  // if state is not open, send error game not started yet
  if (!isStart(state)) {
    replyGameWS(socket, msg.message.state, { error: "Game not started yet" })
    return;
  }

  let bet: ReceivedBet = data;
  const token = msg.token;

  if (await redis.hexists(`${inStudio(msg.studioNo, GameValues.Bet)}:${playerMobile}`, bet.choice)) {
    fastify.log.info(`Already bet for player: ${playerMobile}`);
    replyGameWS(socket, msg.message.state, { error: "Already placed a bet" })
    return;
  }
  const gameSessionId = await redis.get(inStudio(msg.studioNo, GameValues.SessionId));
  if (!gameSessionId) {
    fastify.log.error("Game session id not found when betting");
    replyGameWS(socket, msg.message.state, { error: "Game session id not found" })
    return;
  }
  const bettor: Bettor = {
    session: gameSessionId,
    mobile: playerMobile,
    lastName: lastName,
    firstName: firstName,
    token: token,
    bet: bet
  }
  try {
    let acknowledgedBet = await acknowledgeBet(bettor, fastify)

    await saveBet({...bettor, bet: acknowledgedBet}, msg.studioNo, fastify)
    const socket = fastify.authenticatedSockets.get(msg.studioNo).get(playerMobile);
    replyGameWS(socket, msg.message.state, {data:acknowledgedBet})
  } catch (error) {
    replyGameWS(socket, msg.message.state, { error: `${error.message}` })
  }
}

async function saveBet(bettor: Bettor, studioNo:string, fastify: FastifyInstance){
  const redis = fastify.redis.dosletra; 
  const {choice, amount} = bettor.bet;
  await redis.hset(`${inStudio(studioNo, GameValues.Bet)}:${bettor.mobile}`, choice, amount, 'lastname', bettor.lastName, 'firstname', bettor.firstName)
}

async function acknowledgeBet(bettor: Bettor, fastify: FastifyInstance){
  try {
    const {choice, amount} = bettor.bet;
    if (typeof amount !== 'number') {
      throw new Error('Invalid amount type'); // Skip invalid choices
    }

    const response = await fastify.inject({
      method: 'POST',
      url: '/bet',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bettor.token}`
      },
      payload: JSON.stringify({
        "sessionId": bettor.session,
        "choice": choice,
        "amount": amount 
      }) // Use 'payload' instead of 'body' for inject()
    });
    
    if (response.statusCode === 201) {
      const betRes = await response.json();
      return {
        choice,
        amount,
        balance: betRes.balance
      }
    } else {
      const errorlog = await response.json();
      throw new Error(errorlog.error)
    }
  } catch (error) {
    throw new Error(error)
  }
}

function isBetValid(state: string, msg: EventMessage): boolean {
  return (msg.message.channel === Channel.Game && msg.message.state === GameState.Bet); 
}

async function broadcastMessage(senderSocket: UserSocket, message: string, fastify: FastifyInstance) {
  if (!message || message.trim() === "") return;

  const payload = {
    sender: {
      mobile: senderSocket.mobile,
      firstName: senderSocket.firstName,
      lastName: senderSocket.lastName,
      userName: senderSocket.userName
    },
    message,
    timestamp: new Date().toISOString()
  };

  fastify.authenticatedSockets.get(this.studioNo).forEach((socket) => {
    if (socket.ws.readyState === socket.ws.OPEN) {
      socket.ws.send(
        JSON.stringify(
          new Message(Channel.Chat, ChatState.Message, { data: payload })
        )
      );
    }
  });
}

async function getGameHistory(
  fastify: FastifyInstance,
  token: string,
  gameId: number
): Promise<any[] | null> {
  try {
    const response = await fastify.inject({
      method: 'GET',
      url: `/game/history/${gameId}`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.statusCode !== 200) {
      fastify.log.error(
        `Failed to fetch game history: ${response.statusCode} ${response.statusMessage}`
      );
      return null;
    }

    return await response.json();
  } catch (error) {
    fastify.log.error("Failed to fetch game history");
    return null;
  }
}

async function broadcastGameHistory(fastify: FastifyInstance, history: any[]) {
  const payload = {
    history,
    timestamp: new Date().toISOString()
  };

  fastify.authenticatedSockets.get(this.studioNo).forEach((socket) => {
    if (socket.ws.readyState === socket.ws.OPEN) {
      socket.ws.send(
        JSON.stringify(
          new Message(Channel.Game, GameState.History, { data: payload })
        )
      );
    }
  });
}

type Bettor = {
  session: string;
  mobile: string;
  lastName: string;
  firstName: string;
  token: string;
  bet: ReceivedBet;
};

// type CompiledBet = Array<Record<string, number>>;

export type ReceivedBet = {
  choice: string,
  amount: number
}
