import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter, on } from 'events';
import { Redis } from 'ioredis';
import FastifyRedis from '@fastify/redis';
import fp from 'fastify-plugin';
import { Auth } from './Auth.ts';
import { getAllBets, Moderator } from './Moderator.ts';
import { Player } from './Player.ts';
import { Broadcast, broadcastPlayerCount } from './Broadcast.ts';
import { CSR } from './CSR.ts';

export const AUTH_TIMEOUT = 1000;
export const TOTAL_NET_BETS = 'TOTAL_NET_BETS';
export const TOTAL_GROSS_BETS = 'TOTAL_GROSS_BETS';

// Define an interface for your plugin options
export interface DosLetraPluginOptions {
  speed: number;
  countdownSpeed: number;
}

declare module '@fastify/redis' {
  interface FastifyRedisType {
    dosletra: Redis;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticatedSockets: Map<string, Map<string, UserSocket>>;
    studioWsServers: Map<string, WebSocketServer>;
    clearDosLetraRedis: () => Promise<string>;
    selectDosLetraRedis: (db: number) => Promise<string>;
  }
}

const studios = [
  { studioNo: "DL01" },
  { studioNo: "DL02" },
  { studioNo: "DL03" },
  { studioNo: "DL04" },
];

const DosLetraPlugin: FastifyPluginAsync<DosLetraPluginOptions> = async (fastify: FastifyInstance, opts) => {
  fastify.decorate('events', new EventEmitter());
  fastify.decorate('authenticatedSockets', new Map<string, Map<string, UserSocket>>());
  fastify.decorate('studioWsServers', new Map<string, WebSocketServer>());

  await fastify
    .register(FastifyRedis, {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || '6379'),
      namespace: 'dosletra'
    });

  // Decorate fastify with a method to clear the dosletra redis namespace
  // This encapsulates the flushall logic within the plugin.
  fastify.decorate('clearDosLetraRedis', async () => {
    const result = await fastify.redis.dosletra.flushdb();
    
    for(const studio of studios){
      await fastify.redis.dosletra.set(`${studio.studioNo}:${GameValues.State}`, GameState.Unavailable);
    }
    return result;
  });

  fastify.decorate('selectDosLetraRedis', async (db: number) => {
    return fastify.redis.dosletra.select(db);
  });

  await fastify.clearDosLetraRedis();

  fastify.get('/', async (req, res) => {
    const { dosletra } = fastify.redis
    const value = await dosletra.get('hello');
    res.send(value);
  });

  fastify.addHook('onClose', async () => {
    await fastify.clearDosLetraRedis();
    fastify.log.info('Fastify application is closing. Performing cleanup...');
  });

  initWebsocket(fastify)

  for(const studio of studios){
    new Broadcast(studio.studioNo, opts.speed, opts.countdownSpeed, fastify);
    new Moderator(studio.studioNo, fastify); 
    new Player(studio.studioNo, fastify);
    // CSR.init(studio.studioNo, fastify);
  }
};


// function initWebsocket(fastify: FastifyInstance) {
//   const wss = new WebSocketServer({ noServer: true });
//   wss.on('connection', async (socket: WebSocket) => {
//     socket.on('error', console.error);

//     socket.on('close', async () => {
//       try {
//         let disconnectedMobile: string | null = null;
    
//         // Remove from authenticatedSockets
//         fastify.authenticatedSockets.forEach((value, key) => {
//           if (value.ws === socket) {
//             disconnectedMobile = value.mobile;
//             fastify.authenticatedSockets.delete(key);
//           }
//         });
    
//         if (disconnectedMobile) {
//           const redis = fastify.redis.dosletra;
//           await redis.srem(Player.ALL_PLAYERS, disconnectedMobile);
    
//           // Get new count from Redis
//           const count = await redis.scard(Player.ALL_PLAYERS);
    
//           // 🔥 Broadcast updated count
//           await broadcastPlayerCount(fastify, count);
    
//           fastify.log.info(`Player disconnected: ${disconnectedMobile}`);
//         }
//       } catch (err) {
//         fastify.log.error("Failed to update player count on disconnect");
//       }
//     });

//     function processMessage(message: string) {
//       Auth.authenticate(fastify, socket, message.toString());
//       socket.off('message', processMessage);
//     }

//     socket.on('message', processMessage);
//   });

//   fastify.server.on('upgrade', function upgrade(request, socket, head) {
//     const { pathname } = new URL(request.url, 'http://localhost');

//     if (pathname === '/api') {
//       wss.handleUpgrade(request, socket, head, function done(ws) {
//         wss.emit('connection', ws, request);
//       });
//     } else {
//       socket.destroy();
//     }
//   });
// }

function initWebsocket(fastify: FastifyInstance) {
  for (const studio of studios) {
    const studioNo = studio.studioNo;
    fastify.authenticatedSockets.set(studioNo, new Map<string, UserSocket>())

    if (!fastify.studioWsServers.has(studioNo)){
      const wss = new WebSocketServer({ noServer: true });
      wss.on('connection', (socket: WebSocket) => {
        socket.on('error', console.error);

        socket.on('close', async () => {
          try {
            let disconnectedMobile: string | null = null;
      
            // Remove from authenticatedSockets
            fastify.authenticatedSockets.get(studioNo).forEach((value, key) => {
              if (value.ws === socket) {
                disconnectedMobile = value.mobile;
                fastify.authenticatedSockets.get(studioNo).delete(key);
              }
            });
        
            if (disconnectedMobile) {
              const redis = fastify.redis.dosletra;
              await redis.srem(inStudio(studioNo, GameValues.AllPlayers), disconnectedMobile);
        
              // Get new count from Redis
              const count = await redis.scard(inStudio(studioNo, GameValues.AllPlayers));
        
              // 🔥 Broadcast updated count
              await broadcastPlayerCount(fastify, count, studioNo);
        
              fastify.log.info(`Player disconnected: ${disconnectedMobile}`);
            }
          } catch (err) {
            fastify.log.error("Failed to update player count on disconnect");
          }
        });

        function processMessage(message: string) {
          Auth.authenticate(fastify, studioNo, socket, message.toString());
          socket.off('message', processMessage);
        }

        socket.on('message', processMessage);
      });
      fastify.studioWsServers.set(studioNo, wss)
    }
  }

  fastify.server.on('upgrade', function upgrade(request, socket, head) {
    const { pathname } = new URL(request.url, 'http://localhost');
    const pathSegments = pathname.split('/');
    
    // Use the already-created server from the map
    if (pathSegments[1] === 'api' && pathSegments[2] === 'studio' && pathSegments[3]) {
      const studioId = pathSegments[3];
      const wss = fastify.studioWsServers.get(studioId);

      if (wss) {
        wss.handleUpgrade(request, socket, head, function done(ws) {
          // You don't need to re-emit 'connection', handleUpgrade does this.
          // This line is already handled internally by `handleUpgrade`
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    }
  });
}



export async function updateGameValues(
  fastify: FastifyInstance,
  data: Map<string, any>,
  studioNo: string
) {
  try {
      
    const redis = fastify.redis.dosletra;
    if (!redis.status || redis.status !== 'ready') {
      return;
    }
    const allBets = await getAllBets(studioNo, fastify);
    
    // Add null check to prevent Object.entries error
    if (!allBets || Object.keys(allBets).length === 0) {
      // No bets available, set default values
      data.set('commission', Broadcast.PCT);
      data.set('odds', {});
      data.set('net', {});
      data.set('gross', {});
      return;
    }
    
    const grossPerChoice: Record<string, number> = {}
    for (const [choice, bettors] of Object.entries(allBets)) {
      grossPerChoice[choice] = 0
      for (const [user, betAmount] of Object.entries(bettors)){
        grossPerChoice[choice] += betAmount
      }
    }
    let commission = Broadcast.PCT;
    if((await redis.exists(`${studioNo}:${GameValues.Commission}`))){
      const gameCommission = await redis.get(`${studioNo}:${GameValues.Commission}`);
      commission = parseFloat(gameCommission)
    }

    const netPerChoice: Record<string, number> = {}
    for (const [choice, gross] of Object.entries(grossPerChoice)){
      netPerChoice[choice] = gross * (1 - commission);
    }
    
    const totalGross = Object.values(grossPerChoice).reduce((sum, value) => sum + value, 0);
    const totalNet = totalGross * (1 - commission);

    const allOdds: Record<string, number> = {}
    for (const [choice, gross] of Object.entries(grossPerChoice)) {
      if (gross > 0) {
        allOdds[choice] = totalNet / gross;
      } else {
        allOdds[choice] = 0; 
      }
    }

    await redis.hset(`${studioNo}:${GameValues.Net}`, `total`, totalNet, ...Object.entries(netPerChoice).flat());
    await redis.hset(`${studioNo}:${GameValues.Gross}`, `total`, totalGross, ...Object.entries(grossPerChoice).flat());
    await redis.hset(`${studioNo}:${GameValues.Odds}`, ...Object.entries(allOdds).flat())
    // data.set('totalGross', totalGross)
    // data.set('totalNet', totalNet)
    data.set('commission', commission)
    data.set('odds', Object.fromEntries(Object.entries(allOdds).map(([key, value]) => [key, value])));
    data.set('net', Object.fromEntries(Object.entries(netPerChoice).map(([key, value]) => [key, value])))
    data.set('gross', Object.fromEntries(Object.entries(grossPerChoice).map(([key, value]) => [key, value])))

  } catch (error) {
    fastify.log.error(error.message);
  }
}

function processIncoming(
  wsUser: WsUser, 
  fastify: FastifyInstance,
  message: string
) {
  try {
    const parsedMessage = JSON.parse(message.toString());
    EventManager.emit('message', new SocketMessage(wsUser, fastify, parsedMessage));
  } catch (e) {
    wsUser.ws.send(JSON.stringify({
      type: 'error',
      code: 'INVALID_MESSAGE_FORMAT',
      message: 'Message must be valid JSON.',
      originalMessage: message.toString().substring(0, 100) + (message.toString().length > 100 ? '...' : '')
    }));
  }
}
export async function replyGameWS(socket: UserSocket, state: GameState | SupportState | ChatState | GiftState, data:any){
  if (socket) {
    socket.ws.send(
      JSON.stringify(
        new Message(Channel.Game, state, data)
      )
    )
  }
}

export async function replySupportWS(socket: any, state: GameState | SupportState | ChatState | GiftState, data: any) {
  if (socket) {
    socket.ws.send(
      JSON.stringify(
        new Message(Channel.Support, state, { data })
      )
    );
  }
}

export function isStart(state: string): boolean {
  return ((state === GameState.Open || state === GameState.Closing || state === GameState.LastCall) || state === null);
}

export function isGameStarted(state: string): boolean {
  return (state === GameState.NewGame);
}


export function inStudio(studio: string, value: GameValues){
  return `${studio}:${value}`;
}



type RoomResponse = {
  id: number;
  status: string;
  host?: {
    id: number;
    firstName: string;
    lastName: string;
    hostName: string;
  };
};



export async function getRoom(token: string, studioNo: string, fastify: FastifyInstance) {
  let room: RoomResponse | null = null;
  
  const redis = fastify.redis.dosletra;
  const roomId = await redis.get(inStudio(studioNo, GameValues.RoomId));
  
  if (!roomId) {
    return null;
  }
  
  const roomsReq = await fastify.inject({
    method: "GET",
    url: `/room/session/${roomId}`,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
  });
  if (roomsReq.statusCode === 200) {
    const roomRes = await roomsReq.json();
    room = roomRes.room;
  }
  return room;
}


export async function getBalance(token: string, fastify: FastifyInstance){
  let balance: number = null
  const balanceReq = await fastify.inject({
    method: 'GET',
    url: '/balance',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
  if (balanceReq.statusCode === 200){
    const balanceRes = await balanceReq.json();
    const walletLists:any[] = balanceRes.wallets;
    const gameWallet = walletLists.find(wallet => wallet.type === 'game');
    balance = gameWallet !== undefined ? gameWallet.balance : null;
  }
  return balance
}


export async function buildGameData(socket: any, studioNo:string, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const dataRoom = await getRoom(socket.token, studioNo, fastify);
  const balance = await getBalance(socket.token, fastify);
  
  return {
    gameRound: await redis.get(inStudio(studioNo, GameValues.Round)),
    hostId: dataRoom?.host?.id,
    hostName: dataRoom?.host?.hostName ?? null,
    balance,
  };
}


export default fp(DosLetraPlugin);

export class EventManager {
  static emitter = new EventEmitter(); // The internal EventEmitter instance

  // Set the limit immediately after initialization
  // A limit of 50 or more is safe for your architecture
  static {
    // Setting a new default limit
    EventManager.emitter.setMaxListeners(50); 
  }
  public static emit(event: string, ...args: any[]) {
    EventManager.emitter.emit(event, ...args);
  }

  public static on(event: string, callback: (...args: any[]) => void) {
    EventManager.emitter.on(event, callback);
  }
}

export class SocketMessage {
  public wsUser: WsUser;
  public fastify: FastifyInstance;
  public message: Message; // Change type from 'string' to 'any'

  constructor(wsUser: WsUser, fastify: FastifyInstance, message: Message) {
    this.wsUser = wsUser;
    this.fastify = fastify;
    this.message = message;
  }
}

export class Message {
  channel: Channel;
  state: GameState | SupportState | ChatState | GiftState;
  data?: any;
  error?: string;

  constructor(channel: Channel, state: GameState | SupportState | ChatState | GiftState, payload: { data?: any; error?: string }) {
    this.channel = channel;
    this.state = state;
    this.data = payload.data;
    this.error = payload.error;
  }
}

export class EventMessage {
  message: Message;
  jwtPayload: JwtPayload;
  token: string;
  studioNo: string;
  constructor(message: Message, jwtPayload: JwtPayload, token: string, studioNo: string) {
    this.message = message;
    this.jwtPayload = jwtPayload;
    this.token = token;
    this.studioNo = studioNo;
  }
}

export class WsUser {
  ws: WebSocket;
  countdown: number;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobile: string;
  type: string;

  constructor(ws: WebSocket, countdown: number) {
    this.ws = ws;
    this.countdown = countdown;
  }
}

export class UserSocket {
  ws: WebSocket;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobile: string;
  type: string;
  token: string;

  constructor(ws: WebSocket, jwt: JwtPayload) {
    this.ws = ws;
    this.firstName = jwt.firstName;
    this.lastName = jwt.lastName;
    this.userName = jwt.userName;
    this.email = jwt.email;
    this.mobile = jwt.mobile;
    this.type = jwt.type;
    this.token = jwt.token;
  }
}


export class PlayerData {
  bet: number;

  constructor(bet: number) {
    this.bet = bet;
  }
}

// Add this interface to define the structure of your JWT payload
export interface JwtPayload {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  mobile: string;
  type: string;
  token: string;
  // Add any other properties that might be in your JWT payload, e.g., exp, iat
}

export enum Channel {
  Game = "Game",
  Support = "Support",
  Chat = "Chat",
  Gift = "Gift"
}

export enum GameState {
  Authenticate = "Authenticate",
  Update = "Update",
  Unavailable = "Unavailable",
  Open = "Open",
  LastCall = "LastCall",
  Closing = "Closing",
  Closed = "Closed",
  Rolling = "Rolling",
  WinnerDeclared = "WinnerDeclared",
  SendPayout = "SendPayout",
  NewGame = "NewGame",
  Bet = "Bet",
  Win = "Win",
  Join = "Join",
  History = "History",
  PlayerCount = "PlayerCount"
}

export enum GameValues {
  Studios="studios",
  SessionId="sessionId",
  Commission="commission",
  Countdown="countdown",
  Choices="choices",
  State="state",
  Round="round",
  RoomId="roomId",
  Bet="bet",
  Win="win",
  Odds="odds",
  WinningChoice=`winningchoice`,
  WinningOdds=`winningodds`,
  Gross=`gross`,
  Net=`net`,
  Play='play',
  AllPlayers='allplayers'
}

export const getAllKeys = async (redis: Redis, keyword: string) => {
  let cursor = '0';
  const allKeys: string[] = [];
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', keyword, 'COUNT', 100);
    cursor = nextCursor;
    allKeys.push(...keys);
  } while (cursor !== '0');
  return allKeys;
}

export enum InternalEvents {
  GameStateChanged = "GameStateChanged"
}

export enum SupportState {
  Authenticate = "Authenticate",
  Start = "Start",
  Message = "Message",
  End = "End",
  Chat = "Chat",
  TicketUpdate = "TicketUpdate",
  ChatHistory = "ChatHistory",
  ListSessions = "ListSessions"
}

export enum ChatState {
  Message = "Message"
}

export enum GiftState {
  Send = "Send"
}