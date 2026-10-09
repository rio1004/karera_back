CREATE TYPE "public"."iCoreTransactionType" AS ENUM('DEPOSIT', 'WITHDRAWAL');--> statement-breakpoint
CREATE TYPE "public"."transactionStatus" AS ENUM('in progress', 'completed', 'void');--> statement-breakpoint
CREATE TYPE "public"."transactiontypes" AS ENUM('bet', 'gift', 'withdraw', 'deposit', 'promo', 'credit');--> statement-breakpoint
CREATE TYPE "public"."UBankTransactionType" AS ENUM('DEPOSIT', 'WITHDRAW');--> statement-breakpoint
CREATE TYPE "public"."agentType" AS ENUM('super', 'master', 'agent', 'player');--> statement-breakpoint
CREATE TYPE "public"."attendanceStatus" AS ENUM('Present', 'Rest Day');--> statement-breakpoint
CREATE TYPE "public"."badge_type" AS ENUM('VIP', 'FRONT_RUNNER', 'LOYALTY', 'MASTER_GIVER');--> statement-breakpoint
CREATE TYPE "public"."chatSessionStatus" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."gameStatus" AS ENUM('enable', 'disable');--> statement-breakpoint
CREATE TYPE "public"."repType" AS ENUM('rep1', 'rep2');--> statement-breakpoint
CREATE TYPE "public"."roomStatus" AS ENUM('open', 'occupied', 'closed');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."ticketPriority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."ticketStatus" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."userType" AS ENUM('admin', 'moderator', 'player', 'csr', 'operator', 'super_operator', 'host', 'accounting', 'agent', 'cashier', 'host_monitoring', 'masteragent', 'site_betting_cashier', 'site_betting_staff', 'supervisor', 'treasury', 'verifier', 'superadmin', 'gamemaster', 'rep1', 'rep2');--> statement-breakpoint
CREATE TYPE "public"."walletStatus" AS ENUM('active', 'frozen', 'closed');--> statement-breakpoint
CREATE TYPE "public"."walletType" AS ENUM('game', 'commission', 'load');--> statement-breakpoint
CREATE TABLE "adminTrail" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agentType" "agentType" DEFAULT 'player' NOT NULL,
	"superReferrerId" bigserial NOT NULL,
	"masterReferrerId" bigserial NOT NULL,
	"agentReferrerId" bigserial NOT NULL,
	"referrerId" bigserial NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"date" date NOT NULL,
	"checkIn" timestamp with time zone,
	"checkOut" timestamp with time zone,
	"totalHours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"payableHours" numeric(5, 2) DEFAULT '8' NOT NULL,
	"status" "attendanceStatus" DEFAULT 'Rest Day' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"type" "badge_type" NOT NULL,
	"meta" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bannedPlayers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"systemId" bigint,
	"name" text,
	"nationality" text,
	"nameOrigin" text,
	"title" text,
	"listType" text,
	"unListType" text,
	"designation" text,
	"listedOn" text,
	"lastUpdate" text,
	"listedOnDate" timestamp,
	"lastUpdateDate" timestamp,
	"comments" text,
	"dataType" text,
	"gender" text,
	"age" integer,
	"affiliationGroup" text,
	"notice" text,
	"sanction" text,
	"city" text,
	"region" text,
	"contacts" text,
	"entity" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "betTickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"gameId" bigserial NOT NULL,
	"sessionId" bigserial NOT NULL,
	"choice" text,
	"amount" numeric(11, 4),
	"ticketNumber" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transactionId" bigserial NOT NULL,
	"gameSessionId" bigserial NOT NULL,
	"choice" text,
	"amount" numeric(11, 4) NOT NULL,
	"fee" numeric(11, 4) DEFAULT '0',
	"winAmount" numeric(11, 4) DEFAULT '0',
	"odds" numeric(11, 4),
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "chatMessages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sessionId" bigserial NOT NULL,
	"mobile" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatSessionTypes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chatSessionTypes_name_unique" UNIQUE("name"),
	CONSTRAINT "chatSessionTypes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "chatSessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mobile" varchar(255) NOT NULL,
	"typeId" bigserial NOT NULL,
	"status" "chatSessionStatus" DEFAULT 'open' NOT NULL,
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"commissionId" bigserial NOT NULL,
	"code" varchar(255) NOT NULL,
	"superReferrerId" bigserial NOT NULL,
	"masterReferrerId" bigserial NOT NULL,
	"agentReferrerId" bigserial NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"betId" bigserial NOT NULL,
	"operatorId" bigserial NOT NULL,
	"rep1Id" bigserial NOT NULL,
	"rep2Id" bigserial NOT NULL,
	"opAmount" numeric(11, 4) NOT NULL,
	"rep1Amount" numeric(11, 4) NOT NULL,
	"rep2Amount" numeric(11, 4) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transactionId" bigint,
	"mobile" varchar(255) NOT NULL,
	"meta" jsonb,
	"status" varchar(50),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "ekyc" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"status" text,
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"subject" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'unread' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT null
);
--> statement-breakpoint
CREATE TABLE "gameSessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"gameId" bigserial NOT NULL,
	"roomId" bigserial NOT NULL,
	"round" text,
	"status" varchar(50) DEFAULT 'in progress' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "gameSessions_round_unique" UNIQUE("round")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"choices" text[] NOT NULL,
	"commission" numeric(11, 4),
	"status" "gameStatus" DEFAULT 'enable' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "games_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "gamingSites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "gamingSites_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "gifts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transactionId" bigint,
	"receiverId" bigserial NOT NULL,
	"meta" jsonb,
	"status" varchar(50),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"birthDate" date,
	"zodiac" text,
	"talent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "hosts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "iCoreTransactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"operationId" uuid,
	"externalId" varchar(255) NOT NULL,
	"transactionType" "iCoreTransactionType" NOT NULL,
	"status" varchar(50) NOT NULL,
	"amount" numeric(11, 4) NOT NULL,
	"metadata" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iCoreTransactions_operationId_unique" UNIQUE("operationId"),
	CONSTRAINT "iCoreTransactions_externalId_unique" UNIQUE("externalId")
);
--> statement-breakpoint
CREATE TABLE "id" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ekycId" bigserial NOT NULL,
	"frontPath" text NOT NULL,
	"backPath" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"type" text,
	"firstName" text,
	"lastName" text,
	"gender" text,
	"birthplace" text,
	"birthdate" text,
	"nationality" text,
	"natureOfWork" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"hostId" bigserial NOT NULL,
	"createdAt" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moderators" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "moderators_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "operatorsCommissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"serviceFee" numeric(11, 4),
	"isFromOnline" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "otpCodes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"otp" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"used" text DEFAULT 'false' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passwordResetOtp" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"userName" text DEFAULT '' NOT NULL,
	"otp" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"used" text DEFAULT 'false' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"permanentAddress" text,
	"currentAddress" text,
	"birthDate" date,
	"birthPlace" text,
	"nationality" text,
	"gamingSite" text,
	"natureOfWork" text,
	"sourceOfIncome" text,
	"profilePicture" text,
	"profilePictureUrl" text,
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transactionId" bigint,
	"code" text NOT NULL,
	"meta" jsonb,
	"status" varchar(50),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "promos_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referralCodes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operatorId" bigserial NOT NULL,
	"code" varchar(255) NOT NULL,
	"pctOperator" numeric(5, 2) DEFAULT '0' NOT NULL,
	"pctRep1" numeric(5, 2) DEFAULT '0' NOT NULL,
	"pctRep2" numeric(5, 2) DEFAULT '0' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referralCodes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referralRepCodes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referralCodeId" bigserial NOT NULL,
	"repId" bigserial NOT NULL,
	"repType" "repType" NOT NULL,
	"recruitedUserId" bigint DEFAULT null,
	"code" varchar(255) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referralRepCodes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referralCodeId" bigserial NOT NULL,
	"operatorId" bigserial NOT NULL,
	"rep1Id" bigint DEFAULT null,
	"rep2Id" bigint DEFAULT null,
	"playerId" bigint DEFAULT null,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_playerId_unique" UNIQUE("playerId")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"gameId" bigserial NOT NULL,
	"hostId" bigint,
	"moderatorId" bigserial NOT NULL,
	"studioNo" text NOT NULL,
	"status" "roomStatus" DEFAULT 'open' NOT NULL,
	"createdByUserId" bigserial NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "selfie" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ekycId" bigserial NOT NULL,
	"filePath" text NOT NULL,
	"meta" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "sites_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "studios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"studioNo" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "studios_studioNo_unique" UNIQUE("studioNo")
);
--> statement-breakpoint
CREATE TABLE "ticketLogs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticketId" bigserial NOT NULL,
	"actorId" bigserial NOT NULL,
	"action" varchar(50) NOT NULL,
	"oldValue" varchar(255),
	"newValue" varchar(255),
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"assigneeId" bigserial NOT NULL,
	"subject" varchar(255) NOT NULL,
	"status" "ticketStatus" DEFAULT 'OPEN' NOT NULL,
	"priority" "ticketPriority" DEFAULT 'MEDIUM' NOT NULL,
	"messages" jsonb,
	"meta" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone,
	"closedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"type" "transactiontypes" NOT NULL,
	"status" "transactionStatus" DEFAULT 'in progress' NOT NULL,
	"amount" numeric(11, 4),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "UBankTransactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"senderRefId" varchar(255) NOT NULL,
	"transactionId" varchar(255) NOT NULL,
	"transactionType" "UBankTransactionType" NOT NULL,
	"status" varchar(50) NOT NULL,
	"amount" numeric(11, 4) NOT NULL,
	"metadata" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigint,
	"firstName" text,
	"lastName" text,
	"userName" text,
	"email" varchar(255),
	"mobile" varchar(255),
	"type" "userType" DEFAULT 'player' NOT NULL,
	"status" "status" DEFAULT 'active' NOT NULL,
	"birthDate" timestamp,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_userName_unique" UNIQUE("userName"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_mobile_unique" UNIQUE("mobile")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"pinHash" text,
	"balance" numeric(11, 4) DEFAULT '0' NOT NULL,
	"onHoldBalance" numeric(11, 4) DEFAULT '0' NOT NULL,
	"status" "walletStatus" DEFAULT 'active' NOT NULL,
	"type" "walletType" DEFAULT 'game' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "wins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sessionId" bigserial NOT NULL,
	"transactionId" bigserial NOT NULL,
	"choice" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transactionId" bigserial NOT NULL,
	"status" varchar(50),
	"meta" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "withdraws" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transactionId" bigserial NOT NULL,
	"status" varchar(50),
	"meta" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "adminTrail" ADD CONSTRAINT "adminTrail_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "betTickets" ADD CONSTRAINT "betTickets_gameId_games_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "betTickets" ADD CONSTRAINT "betTickets_sessionId_gameSessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."gameSessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_gameSessionId_gameSessions_id_fk" FOREIGN KEY ("gameSessionId") REFERENCES "public"."gameSessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatMessages" ADD CONSTRAINT "chatMessages_sessionId_chatSessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."chatSessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatSessions" ADD CONSTRAINT "chatSessions_typeId_chatSessionTypes_id_fk" FOREIGN KEY ("typeId") REFERENCES "public"."chatSessionTypes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_betId_bets_id_fk" FOREIGN KEY ("betId") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_operatorId_users_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rep1Id_users_id_fk" FOREIGN KEY ("rep1Id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rep2Id_users_id_fk" FOREIGN KEY ("rep2Id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ekyc" ADD CONSTRAINT "ekyc_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameSessions" ADD CONSTRAINT "gameSessions_gameId_games_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameSessions" ADD CONSTRAINT "gameSessions_roomId_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_receiverId_users_id_fk" FOREIGN KEY ("receiverId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iCoreTransactions" ADD CONSTRAINT "iCoreTransactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id" ADD CONSTRAINT "id_ekycId_ekyc_id_fk" FOREIGN KEY ("ekycId") REFERENCES "public"."ekyc"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_hostId_hosts_id_fk" FOREIGN KEY ("hostId") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operatorsCommissions" ADD CONSTRAINT "operatorsCommissions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referralCodes" ADD CONSTRAINT "referralCodes_operatorId_users_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referralRepCodes" ADD CONSTRAINT "referralRepCodes_referralCodeId_referralCodes_id_fk" FOREIGN KEY ("referralCodeId") REFERENCES "public"."referralCodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referralRepCodes" ADD CONSTRAINT "referralRepCodes_repId_users_id_fk" FOREIGN KEY ("repId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referralRepCodes" ADD CONSTRAINT "referralRepCodes_recruitedUserId_users_id_fk" FOREIGN KEY ("recruitedUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referralCodeId_referralCodes_id_fk" FOREIGN KEY ("referralCodeId") REFERENCES "public"."referralCodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_operatorId_users_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_rep1Id_users_id_fk" FOREIGN KEY ("rep1Id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_rep2Id_users_id_fk" FOREIGN KEY ("rep2Id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_playerId_users_id_fk" FOREIGN KEY ("playerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_studioNo_studios_studioNo_fk" FOREIGN KEY ("studioNo") REFERENCES "public"."studios"("studioNo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie" ADD CONSTRAINT "selfie_ekycId_ekyc_id_fk" FOREIGN KEY ("ekycId") REFERENCES "public"."ekyc"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticketLogs" ADD CONSTRAINT "ticketLogs_ticketId_tickets_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UBankTransactions" ADD CONSTRAINT "UBankTransactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins" ADD CONSTRAINT "wins_sessionId_gameSessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."gameSessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins" ADD CONSTRAINT "wins_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdraws" ADD CONSTRAINT "withdraws_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;