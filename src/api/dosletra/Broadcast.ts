import {FastifyInstance} from "fastify";
import {
  Channel,
  EventManager,
  EventMessage,
  GameState,
  GameValues,
  InternalEvents,
  inStudio,
  Message,
  SupportState,
  updateGameValues,
  buildGameData
} from "./DosLetraPlugin.ts";

export class Broadcast {
  // Constants remain static
  public static readonly LAST_CALL: number = 10;
  public static readonly CLOSING: number = 5;
  public static readonly PCT: number = 0.1

  private liveInterval: NodeJS.Timeout | null = null;
  private studioNo: string;
  private speed: number;
  private countdownSpeed: number;
  private fastify: FastifyInstance;
  public odds: Map<string, number> = new Map(); // Instance odds map

  // Constructor replaces the static init method
  constructor(studioNo: string, speed: number, countdownSpeed: number, fastify: FastifyInstance) {
    this.studioNo = studioNo;
    this.speed = speed;
    this.countdownSpeed = countdownSpeed;
    this.fastify = fastify;
    
    // Call initialization methods using 'this'
    this.initListeners();
    this.initProcessHandlers(); // Handles SIGINT/SIGTERM
    this.liveBroadcast();
  }

  // Moved liveBroadcast logic into an instance method
  private liveBroadcast() {
    // Uses instance properties: this.liveInterval and this.speed
    this.liveInterval = setInterval(async () => {
      let data = new Map();
      let redis = this.fastify.redis.dosletra;
      if (!redis.status || redis.status !== 'ready') {
        return;
      }
      // Uses the instance's inStudio() method
      const state = await redis.get(this.inStudio(GameValues.State))
      if(state === GameState.Unavailable) return;
      
      data.set('studio', this.studioNo); // Uses instance studioNo
      await updateGameValues(this.fastify, data, this.studioNo); // Passes instance studioNo
      await this.broadcast(data);
    }, 1000 / this.speed); // Uses instance speed
  }

  private broadcast(data: Map<string, any>) {
    // Access fastify via 'this'
    if (this.fastify.studioWsServers.has(this.studioNo)){
      const wss = this.fastify.studioWsServers.get(this.studioNo);
      wss.clients.forEach((client)=>{
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(new Message(Channel.Game, GameState.Update, {
            data: Object.fromEntries(data)
          })));
        }
      });
    }
  }
  
  // Method to set up the event listener
  private initListeners() {
    // Attaches ONE listener per Broadcast instance
    EventManager.on(InternalEvents.GameStateChanged, async (msg: EventMessage) => {
      // 🎯 CRITICAL FILTER: Only process the event if it's for this studio
      if (msg.studioNo !== this.studioNo) {
        return;
      }

      const redis = this.fastify.redis.dosletra;
      // Uses the instance's inStudio() method
      const state = await redis.get(this.inStudio(GameValues.State));
      
      this.onOpen(state, msg); 
      this.onRolling(state, msg);
      this.onWinnerDeclared(state, msg);
      this.onSendPayout(state, msg);
      this.onNewGame(state, msg);
    });

    // From frontend/client
    EventManager.on('message', async (msg: EventMessage) => {
      if (msg.message.channel !== Channel.Game) {
        return;
      }
      if (msg.studioNo !== this.studioNo) {
        return;
      }
      // const data = JSON.parse(msg.message.data);
      const data = msg.message.data;
      await this.onGetUpdate(msg, data);
    });
  }

  // Isolating the process handlers in case they affect the entire application
  private initProcessHandlers() {
    // ⚠️ Note: Attaching SIGINT/SIGTERM handlers *in a loop* is risky. 
    // This should ideally be done ONCE in the main plugin/app file, 
    // ensuring ALL intervals (from ALL Broadcast instances) are cleared.
    
    // If you must keep it here, ensure it's idempotent or only called once per process.
    // However, since we are moving it out of the static 'init' and into an instance 
    // it will be attached multiple times, which is problematic.
    
    // A better approach is to collect all interval IDs and clear them globally.
    // For now, let's keep the cleanup logic for this instance available:
    const cleanup = () => {
      if (this.liveInterval) {
        clearInterval(this.liveInterval);
        this.liveInterval = null;
      }
    };
    
    // Instead of attaching process handlers here, we'll expose a cleanup method.
    // We will rely on the main Fastify app's onClose hook to call cleanup on all instances.
    this.fastify.addHook('onClose', cleanup);
  }


  public async onOpen(state: string, msg: EventMessage) {
    if (state !== GameState.Open) {
      return;
    }
    const data = msg.message.data; //{ play: false }
    let id = setInterval(async () => {
      
      const redis = this.fastify.redis.dosletra;
      const countdown = await redis.get(this.inStudio(GameValues.Countdown));
      const isPlay = JSON.parse(await redis.get(this.inStudio(GameValues.Play)))
      if (countdown === null) {
        clearInterval(id);
        return;
      }

      if (isPlay !== null && isPlay === false){
        return
      }

      const prevCount = Number(countdown);
      let currentCountdown = prevCount - 1;
      await redis.set(this.inStudio(GameValues.Countdown), currentCountdown);

      // FIXME: Have to think more about saving Game State in Redis here
      if (currentCountdown >= 0) {
        if (this.fastify.studioWsServers.has(this.studioNo)){
          const wss = this.fastify.studioWsServers.get(this.studioNo);
          wss.clients.forEach(async (client)=>{
            if (client.readyState === WebSocket.OPEN) {
              if (currentCountdown > 10) {
                client.send(JSON.stringify(new Message(Channel.Game, GameState.Open, {
                  data: { countdown: currentCountdown },
                })));
              }

              else if (currentCountdown > Broadcast.CLOSING && currentCountdown <= Broadcast.LAST_CALL) {
                await redis.set(this.inStudio(GameValues.State), GameState.LastCall);
                client.send(JSON.stringify(new Message(Channel.Game, GameState.LastCall, {
                  data: { countdown: currentCountdown },
                })));
              }

              else if (currentCountdown > 0 && currentCountdown <= Broadcast.CLOSING) {
                await redis.set(this.inStudio(GameValues.State), GameState.Closing);
                client.send(JSON.stringify(new Message(Channel.Game, GameState.Closing, {
                  data: { countdown: currentCountdown },
                })));
              } else {
                await redis.set(this.inStudio(GameValues.State), GameState.Closed);
                client.send(JSON.stringify(new Message(Channel.Game, GameState.Closed, {
                  data: { countdown: currentCountdown },
                })));
              }
              
            }
          })
        };
      } else {
        clearInterval(id);
      }

    }, 1000 / this.countdownSpeed);
  }

  public async onRolling(state: string, msg: EventMessage) {
    if (state !== GameState.Rolling) {
      return;
    }

    if (this.fastify.studioWsServers.has(this.studioNo)){
      const wss = this.fastify.studioWsServers.get(this.studioNo);
      wss.clients.forEach((client)=>{
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(new Message(Channel.Game, state, {})));
        }
      })
    };
  }

  public async onSendPayout(state: string, msg: EventMessage) {
    if (state !== GameState.SendPayout) {
      return;
    }
    const redis = this.fastify.redis.dosletra;
    await redis.set(this.inStudio(GameValues.State), GameState.WinnerDeclared);
    const winners: Record<string, {
      winnings: number,
      lastName: string,
      firstName: string
    }> = msg.message.data.winners;
    
    const sortedWinners = Object.entries(winners).sort((a, b) => b[1].winnings - a[1].winnings);
    const topWinners = await Promise.all(
      sortedWinners.slice(0, 3).map(async ([user, winnings]) => {
          return winnings;
      })
    );

    if (this.fastify.studioWsServers.has(this.studioNo)){
      const wss = this.fastify.studioWsServers.get(this.studioNo);
      wss.clients.forEach((client)=>{
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(new Message(Channel.Game, GameState.SendPayout, {
            data: {
              topWinners: topWinners
            }
          })));
        }
      })
    };
  }

  public async onWinnerDeclared(state: string, msg: EventMessage) {
    if (state !== GameState.WinnerDeclared) {
      return;
    }
    const redis = this.fastify.redis.dosletra;
    
    const winningChoice = await redis.get(this.inStudio(GameValues.WinningChoice))

    if (this.fastify.studioWsServers.has(this.studioNo)){
      const wss = this.fastify.studioWsServers.get(this.studioNo);
      wss.clients.forEach((client)=>{
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(new Message(Channel.Game, state, {
            data: {
              choice: winningChoice
            }
          })));
        }
      })
    };
  }

  public async onNewGame(state: string, msg: EventMessage) {
    if (state !== GameState.NewGame) {
      return;
    }

    const redis = this.fastify.redis.dosletra;
    const sessionId = await redis.get(this.inStudio(GameValues.SessionId));
  
    if (this.fastify.studioWsServers.has(this.studioNo)) {
      const wss = this.fastify.studioWsServers.get(this.studioNo);
  
      wss.clients.forEach(async (client) => {
        if (client.readyState === WebSocket.OPEN) {
          // lookup user attached to this socket
          const studioSockets = this.fastify.authenticatedSockets.get(this.studioNo);
          const userSocket = [...studioSockets.values()].find(s => s.ws === client);
  
          // if moderator send sessionId
          if (userSocket?.type === "moderator") {
            client.send(
              JSON.stringify(
                new Message(Channel.Game, state, { data: { sessionId } })
              )
            );
          } else {
            client.send(
              JSON.stringify(
                new Message(Channel.Game, state, {})
              )
            );
          }
        }
      });
    }  
  }

  
  public isUpdate(state: string, msg: EventMessage): boolean {
    return msg.message.channel === Channel.Game &&
      msg.message.state === GameState.Update;
  }
  
  public async onGetUpdate(msg: EventMessage, data: any) {
  
    const redis = this.fastify.redis.dosletra;
    const state = await redis.get(inStudio(msg.studioNo, GameValues.State)) as GameState;
    if (!this.isUpdate(state, msg)) {
      return;
    }
  
    const socket = this.fastify.authenticatedSockets.get(msg.studioNo).get(msg.jwtPayload.mobile);
    if (socket) {
      let data: Record<string, any> = {};
      if (msg.jwtPayload.type === 'player'){
        data = await buildGameData(socket, msg.studioNo, this.fastify);
      }
      data.studioNo = msg.studioNo;
      socket.ws.send(
        JSON.stringify(
          new Message(Channel.Game, state, {data})
        )
      )
    }
  }


  // Helper method now uses the instance's studioNo
  public inStudio(value: GameValues): string {
    return `${this.studioNo}:${value}`;
  }

}


export async function broadcastPlayerCount(
  fastify: FastifyInstance,
  msgOrCount: EventMessage | number,
  studioNo: string
) {
  let count: number;

  if (typeof msgOrCount === "number") {
    count = msgOrCount;
  } else {
    if (msgOrCount.jwtPayload.type !== "player") {
      return;
    }
    const redis = fastify.redis.dosletra;
    const allPlayers = await redis.smembers(inStudio(studioNo, GameValues.AllPlayers));
    count = allPlayers.length;
  }

  const payload = {
    playerCount: count
  };

  if (fastify.studioWsServers.has(studioNo)){
    const wss = fastify.studioWsServers.get(studioNo);
    wss.clients.forEach((client)=>{
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify(
            new Message(Channel.Game, GameState.PlayerCount, { data: payload })
          )
        );
      }
    })
  };
}
