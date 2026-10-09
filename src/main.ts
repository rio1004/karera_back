import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { create_app } from "./app.ts";
import { db } from "./db/index.ts";
import * as schema from "./db/schema.ts";

import DosLetraPlugin from "./api/dosletra/DosLetraPlugin.ts";
import CSRPlugin from "./api/csr/CSRPlugin.ts";

import UserRoutesPlugin from "./api/UserRoutesPlugin.ts";
import TransactionRoutesPlugin from "./api/TransactionRoutesPlugin.ts";
import WalletRoutesPlugin from "./api/WalletRoutesPlugin.ts";
import GameRoutesPlugin from "./api/GameRoutesPlugin.ts";
import EkycRoutesPlugin from "./api/EkycRoutesPlugin.ts";
import DebugRoutesPlugin from "./api/DebugRoutesPlugin.ts";
import TicketRoutesPlugin from "./api/TicketRoutesPlugin.js";
import LeaderBoardRoutePlugin from "./api/LeaderBoardRoutePlugin.ts";
import RoomRoutesPlugin from "./api/RoomsRoutesPlugin.ts";
import HostRoutesPlugin from "./api/HostRoutesPlugin.ts";
import AttendanceRoutesPlugin from "./api/AttendanceRoutesPlugin.ts";
import HealthRoutesPlugin from "./api/HealthRoutesPlugin.ts";
import WalletPinRoutesPlugin from "./api/WalletPinRoutesPlugin.js";
import PasswordRoutesPlugin from "./api/PasswordRoutesPlugin.js";
import OneTimePinCodeRoutesPlugin from "./api/OneTimePinCodeRoutesPlugin.js";
import PaymentsRoutesPlugin from "./api/PaymentsRoutesPlugin.ts";
import GamingSitesRoutesPlugin from "./api/GameSiteRoutesPlugin.ts";
import PlayerRoutesPlugin from "./api/PlayerRoutesPlugin.ts";
import GiftRoutePlugin from "./api/GiftRoutePlugin.ts";
import CSRRoutePlugin from "./api/CSRRoutePlugin.ts";
import OperatorRoutePlugin from "./api/OperatorRoutePlugin.ts";
import RepresentativeRoutePlugin from "./api/RepresentativeRoutePlugin.ts";
import CommissionRoutePlugin from "./api/CommissionRoutePlugin.ts";
import ResetAllTablesRoutePlugin from "./api/ResetAllTablesRoutePlugin.js";
import CreditRoutesPlugin from "./api/CreditRoutesPlugin.ts";
import EmailRoutesPlugin from "./api/EmailRoutesPlugin.ts";
import BadgeRoutesPlugin from "./api/BadgeRoutesPlugin.ts";
import fastifyRedis from "@fastify/redis";
import UsersAuditRoutesPlugin from "./api/UsersAuditRoutesPlugin.js";
import UserSessionRoutesPlugin from "./api/UserSessionRoutesPlugin.ts";

const app = create_app(false);

// --- ROUTES ---
const routePlugins = [
  HealthRoutesPlugin,
  UserRoutesPlugin,
  TransactionRoutesPlugin,
  WalletRoutesPlugin,
  GameRoutesPlugin,
  EkycRoutesPlugin,
  DebugRoutesPlugin,
  TicketRoutesPlugin,
  LeaderBoardRoutePlugin,
  RoomRoutesPlugin,
  HostRoutesPlugin,
  AttendanceRoutesPlugin,
  WalletPinRoutesPlugin,
  OneTimePinCodeRoutesPlugin,
  PasswordRoutesPlugin,
  PaymentsRoutesPlugin,
  GamingSitesRoutesPlugin,
  CSRRoutePlugin,
  PlayerRoutesPlugin,
  GiftRoutePlugin,
  OperatorRoutePlugin,
  RepresentativeRoutePlugin,
  CommissionRoutePlugin,
  ResetAllTablesRoutePlugin,
  CreditRoutesPlugin,
  EmailRoutesPlugin,
  UsersAuditRoutesPlugin,,
  BadgeRoutesPlugin,
  UserSessionRoutesPlugin
  // ZolozRoutesPlugin,
];

routePlugins.forEach(app.register);

// Register DosLetraPlugin separately here, before other observers/hooks
app.register(DosLetraPlugin, { speed: 1.0, countdownSpeed: 1.0});
app.register(CSRPlugin);

app.addHook('onRequest', (request, reply, done) => {
  request.db = db as NodePgDatabase<typeof schema>;
  done();
});

app.decorate('db', db as NodePgDatabase<typeof schema>)

app.listen({ port: 8000, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening on ${address}`);
});