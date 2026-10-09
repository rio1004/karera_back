import { FastifyInstance } from "fastify";
import { EventManager, EventMessage, Channel, GameState, Message, inStudio, InternalEvents, replyGameWS, GameValues, getAllKeys, SupportState } from "./DosLetraPlugin.ts";

export class Moderator {
  public static readonly COUNTDOWN: number = 60;
  constructor(private readonly studioNo: string, private readonly fastify: FastifyInstance) {
    this.initListeners(fastify);
  }
  private initListeners(fastify: FastifyInstance) {
    // 🎯 Attaches ONE listener per Moderator instance
    EventManager.on('message', async (msg: EventMessage) => {
      // CRITICAL FILTER: Only run logic if the message belongs to THIS studio instance
      if (msg.studioNo !== this.studioNo) {
        return; 
      }
      const data = msg.message.data;

      await onOpen(msg, data, fastify);
      await rolling(msg, data, fastify);
      await winnerDeclared(msg, data, fastify);
      await newGame(msg, data, fastify);
      await sendPayout(msg, data, fastify);
    });
  }
}

async function onOpen(msg: EventMessage, data: any, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const state = await redis.get(inStudio(msg.studioNo, GameValues.State));
  
  if (!isOpenValid(state, msg)) {
    return;
  }
  
  const playerMobile = msg.jwtPayload.mobile;
  const socket = fastify.authenticatedSockets.get(msg.studioNo).get(playerMobile);
  fastify.authenticatedSockets.keys()

  if (('play' in data) && typeof data.play === 'boolean') {
    const isPlay: boolean = data.play;
    await redis.set(inStudio(msg.studioNo, GameValues.Play), JSON.stringify(isPlay));
    replyGameWS(socket,  msg.message.state, { data: { play: isPlay } });
  }

  if(state === GameState.NewGame){
    // if gameSessionId is not in redis, return
    const gameSessionId = await redis.get(inStudio(msg.studioNo, GameValues.SessionId));
    if (!gameSessionId) {
      replyGameWS(socket,  msg.message.state, { error: "Game not started yet." });
      return;
    }
    await redis.set(inStudio(msg.studioNo, GameValues.State), GameState.Open);
    await redis.set(inStudio(msg.studioNo, GameValues.Countdown), Moderator.COUNTDOWN + 1);
    EventManager.emit(InternalEvents.GameStateChanged, msg);
  }

}

async function rolling(msg: EventMessage, data: any, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const state = await redis.get(inStudio(msg.studioNo, GameValues.State));

  if (!isRollingValid(state, msg)) {
    return;
  }
  const gameSessionId = await redis.get(inStudio(msg.studioNo, GameValues.SessionId));
  if (!gameSessionId) {
    const playerMobile = msg.jwtPayload.mobile;
    const socket = fastify.authenticatedSockets.get(msg.studioNo).get(playerMobile);
    if (socket) {
      socket.ws.send(
        JSON.stringify(
          new Message(Channel.Game, msg.message.state, { error: "Game not started yet." })
        )
      )
    }
    return;
  }

  await redis.set(inStudio(msg.studioNo, GameValues.State), GameState.Rolling);
  EventManager.emit(InternalEvents.GameStateChanged, msg);
}
async function isGameSessionValid(msg: EventMessage, fastify: FastifyInstance){
  const redis = fastify.redis.dosletra;
  const playerMobile = msg.jwtPayload.mobile;
  const socket = fastify.authenticatedSockets.get(msg.studioNo).get(playerMobile);
  const gameSessionId = await redis.get(inStudio(msg.studioNo, GameValues.SessionId));
  if (!gameSessionId) {
    if (socket) {
      socket.ws.send(
        JSON.stringify(
          new Message(Channel.Game, msg.message.state, { error: "Game not started yet." })
        )
      )
    }
    return false;
  }
  return true;
}


async function winnerDeclared(msg: EventMessage, data: any, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const state = await redis.get(inStudio(msg.studioNo, GameValues.State));

  if (!isWinnerDeclared(state, msg) || !isGameSessionValid(msg, fastify)) {
    return;
  }

  if (!('choice' in data) || typeof data.choice !== 'string') {
    return; // Skip invalid choices
  }

  const winningChoice = data.choice;

  const winningOdds = await redis.hget(inStudio(msg.studioNo, GameValues.Odds), winningChoice)

  await redis.set(inStudio(msg.studioNo, GameValues.WinningChoice), winningChoice);
  await redis.set(inStudio(msg.studioNo, GameValues.WinningOdds), winningOdds);
  await redis.set(inStudio(msg.studioNo, GameValues.State), GameState.WinnerDeclared);
  EventManager.emit(InternalEvents.GameStateChanged, msg);
}

async function sendPayout(msg: EventMessage, data: any, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const state = await redis.get(inStudio(msg.studioNo, GameValues.State));

  if (!isWinPayoutReady(state, msg) || !isGameSessionValid(msg, fastify)) {
    return;
  }
  const playerMobile = msg.jwtPayload.mobile;
  const socket = fastify.authenticatedSockets.get(msg.studioNo).get(playerMobile);
  const gameSessionId = await redis.get(inStudio(msg.studioNo, GameValues.SessionId)); 

  const token = socket.token
  if(!(await redis.exists(inStudio(msg.studioNo, GameValues.WinningChoice))) || !(await redis.exists(inStudio(msg.studioNo, GameValues.WinningOdds)))){
    return;
  }
  const winningChoice = await redis.get(inStudio(msg.studioNo, GameValues.WinningChoice));
  const winningOdds = await redis.get(inStudio(msg.studioNo, GameValues.WinningOdds));
  const odds = await redis.hgetall(inStudio(msg.studioNo, GameValues.Odds))

  const allBets = await getAllBets(msg.studioNo, fastify)
  
  const betsArray: {
    user:string,
    amount: number,
    choice:string
  }[] = [];

  for (const choice in allBets) {
      const users = allBets[choice];
      for (const user in users) {
          const amount = users[user];
          betsArray.push({
              user: user,
              amount: amount,
              choice: choice
          });
      }
  }
  
  const winners: {
    user: string,
    winAmount: number
  }[] = []
  for(const bet of betsArray){
    if(bet.choice === winningChoice){
      const winnerAmount = bet.amount * parseFloat(winningOdds);
      winners.push({
        user: bet.user,
        winAmount: winnerAmount
      })
    }
  }

  const broadcastWinners: Record<string, {
    winnings: number,
    lastName: string,
    firstName: string
  }> = {}

  
  const body = {
    "sessionId": gameSessionId,
    "choice": winningChoice,
    "odds": odds,
    "winners": winners
  }

  const gameSessionBody = {
    "status": "completed"
  }

  try {
    const response = await fastify.inject({
      method: 'POST',
      url: '/win',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      payload: JSON.stringify(body)
    });
    if(response.statusCode === 201){
      const responseData = await response.json();
      const acknowledgedWinners: {
        user: string,
        balance: number,
        winAmount: number
      }[] = responseData.winners;
      for(const acknowledgedWinner of acknowledgedWinners){
        const userSocket = fastify.authenticatedSockets.get(msg.studioNo).get(acknowledgedWinner.user);
        
        if(acknowledgedWinner.winAmount > 0){
          // User won something
          broadcastWinners[acknowledgedWinner.user] = {
            winnings: acknowledgedWinner.winAmount,
            lastName: userSocket.lastName,
            firstName: userSocket.firstName,
          }
          replyGameWS(userSocket, GameState.Win, {data: { wins: acknowledgedWinner.winAmount, balance: acknowledgedWinner.balance}});
        }
      }

      const gameSessionResponse = await fastify.inject({
        method: 'PATCH',
        url: `/game/session/${gameSessionId}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        payload: JSON.stringify(gameSessionBody)
      });

      if (gameSessionResponse.statusCode !== 200) {
        const errorlog = JSON.parse(gameSessionResponse.payload);
        fastify.log.error(`Failed to close game session: ${errorlog.error}`);
      }
    } else {
      const errorlog = await response.json();
      fastify.log.error(`Failed to finalize game payout: ${errorlog.error}`);
      replyGameWS(socket, msg.message.state, { error: errorlog.error });
    }
  } catch (error) {
    fastify.log.error('Something went wrong while setting payout: ');
    replyGameWS(socket, msg.message.state, { error: 'Something went wrong while setting payout: ' + error });
  }

  msg.message.data = {
    winners:broadcastWinners
  };
  replyGameWS(socket, msg.message.state, {});
  await redis.set(inStudio(msg.studioNo, GameValues.State), GameState.SendPayout);
  EventManager.emit(InternalEvents.GameStateChanged, msg);
}


export async function getAllBets(studioNo: string, fastify: FastifyInstance){
  const redis = fastify.redis.dosletra;
  if(!(await redis.exists(`${studioNo}:${GameValues.Choices}`))){
    return {}; // Return empty object instead of undefined
  }
  const choices:string[] = JSON.parse(await redis.get(`${studioNo}:${GameValues.Choices}`));

  const allBetKeys: string[] = await getAllKeys(redis, `${studioNo}:${GameValues.Bet}:*`);
  
 
  const allBets: Record<string, Record<string, number>> = {}
  for (const choice of choices){
    const choiceBettors: Record<string, number> = {}
    for (const betKey of allBetKeys) {
      const amount = await redis.hget(betKey, choice);
      if(amount === null){
        continue
      }
      const user = betKey.replace(`${studioNo}:${GameValues.Bet}:`, '')
      choiceBettors[user] = parseFloat(amount)
    }
    allBets[choice] = choiceBettors
  }

  return allBets
}


async function newGame(msg: EventMessage, data: any, fastify: FastifyInstance) {
  const redis = fastify.redis.dosletra;
  const state = await redis.get(inStudio(msg.studioNo, GameValues.State));
  if (!isNewGameValid(state, msg)) {
    return;
  }
  const token = msg.token;
  const gameId = data.gameId;
  try {
    const raw = JSON.stringify({
      "gameId": gameId
    });
    if (gameId) {
      const response = await fastify.inject({
        method: 'POST',
        url: '/game/session',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        payload: raw // Use 'payload' instead of 'body' for inject()
      });
      if (response.statusCode === 201) {
        const sessionData = await response.json();
        const gameChoices:string[] = sessionData.gameChoices;
        await clearPreviousGameValues(msg, fastify)
        await redis.set(inStudio(msg.studioNo, GameValues.SessionId), sessionData.id);
        await redis.set(inStudio(msg.studioNo, GameValues.Commission), sessionData.gameCommission);
        await redis.set(inStudio(msg.studioNo, GameValues.Round), sessionData.round);
        await redis.set(inStudio(msg.studioNo, GameValues.RoomId), sessionData.roomId);
        await redis.set(inStudio(msg.studioNo, GameValues.Choices), JSON.stringify(gameChoices));
        await redis.set(inStudio(msg.studioNo, GameValues.State), GameState.NewGame);
        await redis.hset(inStudio(msg.studioNo, GameValues.Odds), ...gameChoices.flatMap(choice => [choice, 0]));
      } else {
        fastify.log.error(await response.json(),'Failed to request new game session');
      }
    }
  } catch (error) {
    fastify.log.error(error, 'Failed to request game Session');
  }
  EventManager.emit(InternalEvents.GameStateChanged, msg);
}

async function clearPreviousGameValues(msg: EventMessage, fastify: FastifyInstance){
  await clearRedis(fastify, `${inStudio(msg.studioNo, GameValues.Bet)}:*`);
  await clearRedis(fastify, `${inStudio(msg.studioNo, GameValues.Win)}:*`);
  await clearRedis(fastify, inStudio(msg.studioNo, GameValues.WinningChoice));
  await clearRedis(fastify, inStudio(msg.studioNo, GameValues.WinningOdds));
  await clearRedis(fastify, inStudio(msg.studioNo, GameValues.Gross));
  await clearRedis(fastify, inStudio(msg.studioNo, GameValues.Net));
  await clearRedis(fastify, inStudio(msg.studioNo, GameValues.Odds));
  await clearRedis(fastify, inStudio(msg.studioNo, GameValues.Play));
}

async function clearRedis(fastify, pattern) {
  const redis = fastify.redis.dosletra;
  const allKeys = await getAllKeys(redis, pattern);

  const BATCH_SIZE = 500;
  
  if (allKeys.length === 0) {
    return;
  }

  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const batch = allKeys.slice(i, i + BATCH_SIZE);
    // Use UNLINK for non-blocking deletion in the background.
    await redis.unlink(...batch);
  }
}

function isOpenValid(currentState: string, msg: EventMessage): boolean {
  if (msg.jwtPayload.type === 'moderator' &&
    (currentState === GameState.NewGame || 
      currentState === GameState.Open) &&
    msg.message.channel === Channel.Game
  ) {
    return msg.message.state === GameState.Open;
  }
  return false;
}


function isRollingValid(state: string, msg: EventMessage): boolean {
  if (msg.jwtPayload.type === 'moderator' &&
    (state === GameState.Closed 
      || state === null 
      || state === "") &&
    msg.message.channel === Channel.Game
  ) {
    return msg.message.state === GameState.Rolling;
  }

  return false;
}

function isWinnerDeclared(state: string, msg: EventMessage): boolean {
  if (msg.jwtPayload.type === 'moderator' &&
    (state === GameState.Rolling 
      || state === null 
      || state === "") &&
    msg.message.channel === Channel.Game
  ) {
    return msg.message.state === GameState.WinnerDeclared;
  }

  return false;
}
function isWinPayoutReady(currentstate: string, msg: EventMessage): boolean {
  if (msg.jwtPayload.type === 'moderator' &&
    (currentstate === GameState.WinnerDeclared 
      || currentstate === null 
      || currentstate === "") &&
    msg.message.channel === Channel.Game
  ) {
    return msg.message.state === GameState.SendPayout;
  }

  return false;
}

function isNewGameValid(state: string, msg: EventMessage): boolean {
  if (msg.jwtPayload.type === 'moderator' &&
    (state === GameState.WinnerDeclared || state === GameState.Unavailable
      || state === null 
      || state === "") &&
    msg.message.channel === Channel.Game
  ) {
    return msg.message.state === GameState.NewGame;
  }

  return false;
}

async function getGameSessionId(
  fastify: FastifyInstance,
  token: string
): Promise<string | null> {
  const gameId = process.env.GAME_ID; // temporary hardcoded game id
  if (!gameId) {
    fastify.log.error("GAME_ID is not configured");
    return null;
  }

  try {
    const response = await fastify.inject({
      method: 'POST',
      url: '/game/session',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      payload: JSON.stringify({ gameId }) // Use 'payload' instead of 'body' for inject()
    });

    if (response.statusCode !== 201) {
      fastify.log.error(
        `Failed to request new game session: ${response.statusCode} ${response.statusMessage}`
      );
      return null;
    }

    const sessionData = await response.json();
    return sessionData.id ?? null;
  } catch (error) {
    fastify.log.error("Failed to request new game session:");
    return null;
  }
}

