import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  decimal,
  jsonb,
  numeric,
  integer,
  boolean,
  bigserial,
  date,
  bigint
} from 'drizzle-orm/pg-core';
import {tinyint} from "drizzle-orm/mysql-core";

export const userTypeValues = [
  'admin',
  'moderator',
  'player',
  'csr',
  'operator',
  'super_operator',
  'host',
  'accounting',
  'agent',
  'cashier',
  'host_monitoring',
  'masteragent',
  'site_betting_cashier',
  'site_betting_staff',
  'supervisor',
  'treasury',
  'verifier',
  'superadmin',
  'gamemaster',
  'rep1',
  'rep2',
] as const;

export const userTypeEnum = pgEnum('userType', userTypeValues);

export const transactionStatusValues = [
  'in progress',
  'completed',
  'void'
] as const;
export const TransactionStatusEnum = pgEnum('transactionStatus', transactionStatusValues);

export const statusEnum = pgEnum("status", ["active", "inactive"]);
export const UsersTable = pgTable('users', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigint("userId", {mode: "number"}),
  firstName: text('firstName'), // todo: to deleted, it should be on profiles table
  lastName: text('lastName'), // todo: to deleted, it should be on profiles table
  userName: text('userName').unique(),
  email: varchar({length: 255}).unique(),
  mobile: varchar({length: 255}).unique(),
  type: userTypeEnum('type').notNull().default('player'),
  status: statusEnum("status").notNull().default("active"),
  birthDate: timestamp('birthDate'), // todo: to deleted, it should be on profiles table
  hashedPassword: text('password'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

export const EmailTable = pgTable("emails", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial("userId", {mode: 'number'}).references(() => UsersTable.id).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("unread"), // unread | read
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).default(null),
});

export const ProfilesTable = pgTable("profiles", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial("userId", {mode: 'number'}).references(() => UsersTable.id).notNull().unique(),
  permanentAddress: text("permanentAddress"),
  currentAddress: text("currentAddress"),
  birthDate: date("birthDate"),
  birthPlace: text("birthPlace"),
  nationality: text("nationality"),
  gamingSite: text("gamingSite"),
  natureOfWork: text("natureOfWork"),
  sourceOfIncome: text("sourceOfIncome"),
  profilePicture: text("profilePicture"),
  profilePictureUrl: text("profilePictureUrl"),
  meta: jsonb('meta'),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const OtpCodes = pgTable('otpCodes', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).notNull(),
  otp: text('otp').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  used: text('used').notNull().default('false'), // 'true' or 'false'
});

export const PasswordResetOtpTable = pgTable('passwordResetOtp', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).notNull(),
  userName: text('userName').notNull().default(''),
  otp: text('otp').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  used: text('used').notNull().default('false'), // store as 'true' or 'false' for simplicity
});

export const agentsEnum = pgEnum("agentType", ["super", "master", "agent", "player"]);

export const AgentsTable = pgTable('agents', {
  userId: bigserial('id', {mode: 'number'}).primaryKey(),
  agentType:agentsEnum().default("player").notNull(),
  superReferrerId: bigserial('superReferrerId', {mode: 'number'}),
  masterReferrerId: bigserial('masterReferrerId', {mode: 'number'}),
  agentReferrerId: bigserial('agentReferrerId', {mode: 'number'}),
  referrerId: bigserial('referrerId', {mode: 'number'}),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

export const CodesTable = pgTable('codes', {
  userId: bigserial('id', {mode: 'number'}).primaryKey(),
  commissionId: bigserial('commissionId', {mode: 'number'}).notNull(),
  code: varchar({ length: 255 }).notNull().unique(),
  superReferrerId: bigserial('superReferrerId', {mode: 'number'}),
  masterReferrerId: bigserial('masterReferrerId', {mode: 'number'}),
  agentReferrerId: bigserial('agentReferrerId', {mode: 'number'}),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

export const CommissionsTable = pgTable('commissions', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  betId: bigserial('betId', {mode: 'number'}).notNull().references(() => BetsTable.id),
  operatorId: bigserial('operatorId', {mode: 'number'}).notNull().references(() => UsersTable.id),
  rep1Id: bigserial('rep1Id', {mode: 'number'}).notNull().references(() => UsersTable.id),
  rep2Id: bigserial('rep2Id', {mode: 'number'}).notNull().references(() => UsersTable.id),
  opAmount: numeric('opAmount', { precision: 11, scale: 4 }).notNull(),
  rep1Amount: numeric('rep1Amount', { precision: 11, scale: 4 }).notNull(),
  rep2Amount: numeric('rep2Amount', { precision: 11, scale: 4 }).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const EkycTable = pgTable('ekyc', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).notNull().references(() => UsersTable.id),
  status: text('status'),
  // birthPlace: text('birthplace'),
  // birthDate: text('birthdate'),
  // age: text('age'),
  // idType: text('idType'),
  // submittedAt: timestamp('submittedAt'),
  
  // New field for storing meta
  meta: jsonb('meta'),

  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const SelfieTable = pgTable("selfie", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  ekycId: bigserial("ekycId", {mode: 'number'}).notNull().references(() => EkycTable.id, { onDelete: "cascade" }),
  
  // store file path or URL
  filePath: text("filePath").notNull(),

  // optional metadata (resolution, file size, etc.)
  meta: text("meta"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const IdTable = pgTable("id", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  ekycId: bigserial("ekycId", {mode: 'number'}).notNull().references(() => EkycTable.id, { onDelete: "cascade" }),

  // file paths or URLs
  frontPath: text("frontPath").notNull(),
  backPath: text("backPath"), // optional, for IDs without a back side

  // verification fields
  status: text("status").default("pending").notNull(), // pending | verified | rejected

  type: text('type'),
  firstName: text('firstName'), // todo: to deleted, it should be on profiles table
  lastName: text('lastName'), 
  gender: text('gender'),
  birthPlace: text('birthplace'),
  birthDate: text('birthdate'),
  nationality: text('nationality'),
  natureOfWork: text("natureOfWork"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const walletTypeEnum = pgEnum('walletType', ['game', 'commission', 'load']);
export const walletStatusEnum = pgEnum('walletStatus', ['active', 'frozen', 'closed']);
export const WalletTable = pgTable('wallets', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).notNull().references(() => UsersTable.id),
  pinHash: text('pinHash'),
  balance: numeric('balance', { precision: 11, scale: 4 }).notNull().default('0'),
  onHoldBalance: numeric('onHoldBalance', { precision: 11, scale: 4 }).notNull().default('0'),
  status: walletStatusEnum('status').notNull().default('active'),
  type: walletTypeEnum('type').notNull().default('game'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const ticketStatusEnum = pgEnum("ticketStatus", [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
]);

export const ticketPriorityEnum = pgEnum("ticketPriority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "URGENT",
]);

export const Tickets = pgTable("tickets", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial("userId", { mode: 'number' }).notNull(),
  assigneeId: bigserial("assigneeId", {mode: 'number'}),
  subject: varchar("subject", { length: 255 }).notNull(),
  status: ticketStatusEnum("status").notNull().default("OPEN"),
  priority: ticketPriorityEnum("priority").notNull().default("MEDIUM"),
  messages: jsonb('messages'),
  meta: jsonb('meta'),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  closedAt: timestamp("closedAt", { withTimezone: true }),
});

export const TicketLogs = pgTable("ticketLogs", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  ticketId: bigserial("ticketId", {mode: 'number'})
    .notNull()
    .references(() => Tickets.id),
  // Foreign key to your users/staff table
  actorId: bigserial("actorId", {mode: 'number'}).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  oldValue: varchar("oldValue", { length: 255 }),
  newValue: varchar("newValue", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
});


export const HostTable = pgTable('hosts', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial("userId", {mode: 'number'}).notNull().references(() => UsersTable.id),
  name: text('name').notNull().unique(),
  location: text('location'),        
  birthDate: date('birthDate'),       
  zodiac: text('zodiac'),             
  talent: text('talent'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const LikeTable = pgTable("likes", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial("userId", {mode: 'number'}).notNull().references(() => UsersTable.id), // assumes you have UsersTable
  hostId: bigserial("hostId", {mode: 'number'}).notNull().references(() => HostTable.id),
  createdAt: timestamp("createdAt").defaultNow()
});

export const badgeTypeEnum = pgEnum("badge_type", [
  "VIP",
  "FRONT_RUNNER",
  "LOYALTY",
  "MASTER_GIVER"
]);

export const BadgesTable = pgTable("badges", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial("userId", {mode: 'number'}).notNull().references(() => UsersTable.id),
  type: badgeTypeEnum("type").notNull(),
  meta: jsonb("meta").notNull() // { description, duration, color }
});

export const ModeratorsTable = pgTable('moderators', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const ICoreTransactionTypeEnum = pgEnum('iCoreTransactionType', ['DEPOSIT', 'WITHDRAWAL']);

export const ICoreTransactionsTable = pgTable('iCoreTransactions', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).references(() => UsersTable.id, { onDelete: "cascade" }).notNull(),
  operationId: uuid('operationId').unique(),
  externalId: varchar('externalId', {length: 255}).notNull().unique(),
  transactionType: ICoreTransactionTypeEnum('transactionType').notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  amount: numeric('amount', { precision: 11, scale: 4 }).notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
});

export const GameSessionsTable = pgTable('gameSessions', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  gameId: bigserial("gameId", {mode: 'number'}).references(() => GamesTable.id).notNull(),
  roomId: bigserial('roomId', {mode: 'number'}).references(() => RoomsTable.id).notNull(),
  round: text("round").unique(),
  status: varchar('status', { length: 50 }).notNull().default('in progress'), // in progress / completed
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const gameStatusEnum = pgEnum("gameStatus", ["enable", "disable"]);
export const GamesTable = pgTable('games', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  name: text('name').notNull().unique(),
  choices: text('choices').array().notNull(),
  commission: numeric('commission', { precision: 11, scale: 4 }),
  status: gameStatusEnum("status").notNull().default("enable"),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const WinsTable = pgTable('wins', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  sessionId: bigserial('sessionId', {mode: 'number'}).references(()=>GameSessionsTable.id).notNull(),
  transactionId: bigserial('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id).notNull(),
  choice: text('choice'),
  createdAt: timestamp('createdAt').defaultNow().notNull()
});


function generateTicketNumber(): string {
  const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
  return `SBT-${randomNumber}`;
}

export const BetTickets = pgTable("betTickets", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  gameId: bigserial("gameId", {mode: 'number'}).references(() => GamesTable.id).notNull(),
  sessionId: bigserial("sessionId", {mode: 'number'}).references(() => GameSessionsTable.id).notNull(),
  choice: text("choice"),
  amount: numeric("amount", { precision: 11, scale: 4 }),
  ticketNumber: varchar("ticketNumber", { length: 255 })
    .notNull()
    .$defaultFn(() => generateTicketNumber()),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow()
});


// export const TransactionTypeEnum = pgEnum('transactiontypes', ['deposit', 'withdraw', 'bet', 'gifting', 'sendMoney']);
// export const TransactionsTable = pgTable('transactions', {
//   id: bigserial('id',{ mode: 'number' }).primaryKey(),
//   userId: uuid('userId').notNull().references(() => UsersTable.id),
//   receiverId: uuid('receiverId').notNull().references(() => UsersTable.id),
//   type: TransactionTypeEnum('type').notNull(),
//   amount: numeric('amount', { precision: 11, scale: 4 }).notNull(),
//   status: text('status').notNull(),
//   meta: jsonb('meta'),
//   createdAt: timestamp('createdAt').defaultNow().notNull(),
//   updatedAt: timestamp('updatedAt').defaultNow().notNull(),
//   deletedAt: timestamp('deletedAt'),
// });

export const transactionTypesValues = [
  'bet', 'gift', 'withdraw', 'deposit', 'promo', 'credit'
] as const;
export const TransactionTypeEnum = pgEnum('transactiontypes',transactionTypesValues);

export const TransactionsTable = pgTable("transactions", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).references(() => UsersTable.id),
  type: TransactionTypeEnum('type').notNull(),
  status: TransactionStatusEnum('status').notNull().default('in progress'), // in progress, completed, void
  amount: numeric('amount', { precision: 11, scale: 4 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const BetsTable = pgTable('bets', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  transactionId: bigserial('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id),
  gameSessionId: bigserial("gameSessionId", {mode: 'number'}).references(()=>GameSessionsTable.id),
  choice: text('choice'),
  amount: numeric('amount', { precision: 11, scale: 4 }).notNull(),
  fee: numeric('fee', { precision: 11, scale: 4 }).default('0'),
  winAmount: numeric('winAmount', { precision: 11, scale: 4 }).default('0'),
  odds: numeric("odds", {precision: 11, scale: 4}),
  meta: jsonb('meta'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const withdrawsTable = pgTable('withdraws', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  transactionId: bigserial('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id),
  status: varchar('status', { length: 50 }),
  meta: jsonb('meta').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const depositsTable = pgTable('deposits', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  transactionId: bigserial('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id),
  status: varchar('status', { length: 50 }),
  meta: jsonb('meta').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const SitesTable = pgTable('sites', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const OperatorCommissionsTable = pgTable('operatorsCommissions', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).references(() => UsersTable.id),
  serviceFee: numeric("serviceFee", {precision: 11, scale: 4}),
  isFromOnline: boolean("isFromOnline").default(false).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const roomStatusEnum = pgEnum('roomStatus', ['open', 'occupied', 'closed']);
export const RoomsTable = pgTable('rooms', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  gameId: bigserial('gameId', {mode: 'number'}).notNull(),
  hostId: bigint('hostId', { mode: 'number' }),
  moderatorId: bigserial('moderatorId', {mode: 'number'}).notNull(),
  studioNo: text('studioNo').notNull().references(() => StudiosTable.studioNo),
  status: roomStatusEnum('status').notNull().default('open'),
  createdByUserId: bigserial('createdByUserId', {mode: 'number'}).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

// --- NEW ENUM FOR ATTENDANCE STATUS ---
export const attendanceStatusEnum = pgEnum('attendanceStatus', ['Present', 'Rest Day']);

// --- ATTENDANCE TABLE ---
export const AttendanceTable = pgTable('attendance', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'})
  .notNull()
  .references(() => UsersTable.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  checkIn: timestamp('checkIn', { withTimezone: true }),
  checkOut: timestamp('checkOut', { withTimezone: true }),
  totalHours: numeric('totalHours', { precision: 5, scale: 2 }).notNull().default('0'),
  payableHours: numeric('payableHours', { precision: 5, scale: 2 }).notNull().default('8'),
  status: attendanceStatusEnum('status').notNull().default('Rest Day'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

// new table for banned players
export const BannedPlayersTable = pgTable('bannedPlayers', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  systemId: bigint('systemId', {mode: 'number'}),
  name: text('name'),
  nationality: text('nationality'),
  nameOrigin: text('nameOrigin'),
  title: text('title'),
  listType: text('listType'),
  unListType: text('unListType'),
  designation: text('designation'),
  listedOn: text('listedOn'),
  lastUpdate: text('lastUpdate'),
  listedOnDate: timestamp('listedOnDate'),
  lastUpdateDate: timestamp('lastUpdateDate'),
  comments: text('comments'),
  dataType: text('dataType'),
  gender: text('gender'),
  age: integer('age'),
  affiliationGroup: text('affiliationGroup'),
  notice: text('notice'),
  sanction: text('sanction'),
  city: text('city'),
  region: text('region'),
  contacts: text('contacts'),
  entity: text('entity'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const UBankTransactionTypeEnum = pgEnum('UBankTransactionType', ['DEPOSIT', 'WITHDRAW']);
export const UBankTransactionsTable = pgTable('UBankTransactions', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).references(() => UsersTable.id, { onDelete: "cascade" }).notNull(),
  senderRefId: varchar('senderRefId', {length: 255}).notNull(),
  transactionId: varchar('transactionId', {length: 255}).notNull(),
  transactionType: UBankTransactionTypeEnum('transactionType').notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  amount: numeric('amount', { precision: 11, scale: 4 }).notNull(),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull()
});

export const GamingSitesTable = pgTable("gamingSites", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  name: text("name").unique().notNull(),
  gameSiteId: text("gameSiteId").unique().notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
});

export const chatSessionStatusEnum = pgEnum("chatSessionStatus", ["open", "closed"]);

export const ChatSessions = pgTable("chatSessions", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  mobile: varchar({length: 255}).notNull(),
  typeId: bigserial("typeId", { mode: "number" })
    .references(() => ChatSessionTypes.id, { onDelete: "restrict" })
    .notNull(),
  status: chatSessionStatusEnum("status").default("open").notNull(),
  meta: jsonb('meta'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

export const ChatSessionTypes = pgTable("chatSessionTypes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar({ length: 255 }).notNull().unique(),   // e.g., "Withdrawal Concern"
  code: varchar({ length: 50 }).notNull().unique(),    // e.g., "withdrawal"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ChatMessages = pgTable("chatMessages", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  sessionId: bigserial('sessionId', {mode: 'number'}).references(() => ChatSessions.id, { onDelete: "cascade" }).notNull(),
  mobile: varchar({length: 255}).notNull(),
  message: text("message").notNull(),
  isRead: boolean('isRead').default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

export const GiftsTable = pgTable("gifts", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  transactionId: bigint('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id),
  receiverId: bigserial('receiverId', {mode: 'number'}).notNull().references(() => UsersTable.id),
  meta: jsonb('meta'),
  status: varchar('status', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const StudiosTable = pgTable('studios', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  studioNo: text('studioNo').notNull().unique(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const PromosTable = pgTable('promos', {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  transactionId: bigint('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id),
  code: text('code').notNull().unique(),
  meta: jsonb('meta'),
  status: varchar('status', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

// --- NEW ENUM: for rep codes ---
export const repTypeEnum = pgEnum("repType", ["rep1", "rep2"]);

// ReferralCodes: owned by Operators
export const ReferralCodesTable = pgTable("referralCodes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  operatorId: bigserial("operatorId", { mode: "number" })
    .notNull()
    .references(() => UsersTable.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 255 }).notNull().unique(),
  pctOperator: numeric("pctOperator", { precision: 5, scale: 2 }).notNull().default("0"), // operator %
  pctRep1: numeric("pctRep1", { precision: 5, scale: 2 }).notNull().default("0"),       // rep1 %
  pctRep2: numeric("pctRep2", { precision: 5, scale: 2 }).notNull().default("0"),       // rep2 %
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ReferralRepCodes: owned by reps but tied to an Operator's referralCode
export const ReferralRepCodesTable = pgTable("referralRepCodes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  referralCodeId: bigserial("referralCodeId", { mode: "number" })
    .notNull()
    .references(() => ReferralCodesTable.id, { onDelete: "cascade" }),
  repId: bigserial("repId", { mode: "number" })
    .notNull()
    .references(() => UsersTable.id, { onDelete: "cascade" }),
  repType: repTypeEnum("repType").notNull(), // ✅ explicitly mark rep1 / rep2
  recruitedUserId: bigint("recruitedUserId", { mode: "number" })
    .references(() => UsersTable.id, { onDelete: "set null" })
    .$type<number | null>()
    .default(null),
  code: varchar("code", { length: 255 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// Referrals: links a Player to an Operator + optional Rep codes
export const ReferralsTable = pgTable("referrals", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  referralCodeId: bigserial("referralCodeId", { mode: "number" })
    .notNull()
    .references(() => ReferralCodesTable.id, { onDelete: "set null" }),

  operatorId: bigserial("operatorId", { mode: "number" })
    .notNull()
    .references(() => UsersTable.id, { onDelete: "cascade" }),

  rep1Id: bigint("rep1Id", { mode: "number" })
    .references(() => UsersTable.id, { onDelete: "set null" })
    .$type<number | null>()
    .default(null),

  rep2Id: bigint("rep2Id", { mode: "number" })
    .references(() => UsersTable.id, { onDelete: "set null" })
    .$type<number | null>()
    .default(null),

  playerId: bigint("playerId", { mode: "number" })
    .references(() => UsersTable.id, { onDelete: "set null" })
    .$type<number | null>()
    .unique()
    .default(null),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const CreditsTable = pgTable("credits", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  transactionId: bigint('transactionId',{ mode: 'number' }).references(()=>TransactionsTable.id),
  mobile: varchar({length: 255}).notNull(),
  meta: jsonb('meta'),
  status: varchar('status', { length: 50 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const AdminTrailTable = pgTable("adminTrail", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).references(() => UsersTable.id, { onDelete: "cascade" }).notNull(),
  meta: jsonb("meta").default({}),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

// gameSiteBets type
export const betTypeEnum = pgEnum("betType", ["SINGLE", "ADVANCED"]);
export const gameSiteBetsTypeEnum = pgEnum("gameSiteBetsType", ["CREATED", "CLAIMED", "UNCLAIMED", "LOSE", "REFUNDED"]);
export const GameSiteBets = pgTable("gameSiteBets", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  mainBetId: bigint('mainBetId', {mode: 'number'}), // Allow null initially
  kioskPlayerId: bigint('kioskPlayerId', {mode: 'number'}).references(() => UsersTable.id),
  gameSessionId: bigint('gameSessionId', {mode: 'number'}).references(() => GameSessionsTable.id), // Changed from bigserial to bigint
  gameSiteId: bigint('gameSiteId', {mode: 'number'}).references(() => GamingSitesTable.id).notNull(), // Changed from bigserial to bigint
  ticketId: varchar("ticketId", { length: 255 }),
  choice: text('choice'),
  amount: numeric('amount', { precision: 11, scale: 4 }),
  winAmount: numeric('winAmount', { precision: 11, scale: 4 }),
  status: gameSiteBetsTypeEnum('status').notNull().default('CREATED'),
  betType: betTypeEnum('betType').notNull().default('SINGLE'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const GameSiteTickets = pgTable("gameSiteTickets", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  gameSiteName: text('gameSiteName').notNull(),
  ticketId: varchar("ticketId", { length: 255 }),
  betTransactionId: bigint('betTransactionId', {mode: 'number'}).references(() => TransactionsTable.id),
  gameName: text('gameName'),
  choice: text('choice'),
  betType: betTypeEnum('betType').notNull().default('SINGLE'),
  totalNumberOfBets: integer('totalNumberOfBets'),
  totalBetAmount: numeric('totalBetAmount', { precision: 11, scale: 4 }),
  paymentAmount: numeric('paymentAmount', { precision: 11, scale: 4 }),
  changeAmount: numeric('changeAmount', { precision: 11, scale: 4 }),
  kioskPlayerId: bigint('kioskPlayerId', {mode: 'number'}).references(() => UsersTable.id),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  deletedAt: timestamp('deletedAt'),
});

export const UserSessionTable = pgTable("userSession", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  userId: bigserial('userId', {mode: 'number'}).references(() => UsersTable.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token", { length: 512 }).notNull(),
  deviceInfo: varchar("deviceInfo", { length: 255 }).default("unknown"),
  createdAt: timestamp("createdAt", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "string" }).defaultNow().notNull(),
});

export const ReferralHistoryTable = pgTable("referralHistory", {
  id: bigserial('id', {mode: 'number'}).primaryKey(),
  referralId: integer("referralId").notNull(),   // link back to ReferralsTable
  action: varchar("action", { length: 50 }).notNull(), // e.g. "player_joined", "rep2_assigned"
  userId: integer("user_id").notNull(),           // the actor
  details: varchar("details", { length: 255 }),   // optional extra context
  createdAt: timestamp("created_at").notNull().defaultNow(),
});