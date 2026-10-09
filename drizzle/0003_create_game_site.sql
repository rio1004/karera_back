CREATE TYPE "public"."betType" AS ENUM('SINGLE', 'ADVANCED');--> statement-breakpoint
CREATE TYPE "public"."gameSiteBetsType" AS ENUM('CREATED', 'CLAIMED', 'UNCLAIMED', 'LOSE', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "gameSiteBets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mainBetId" bigint,
	"kioskPlayerId" bigint,
	"gameSessionId" bigint,
	"gameSiteId" bigint NOT NULL,
	"ticketId" varchar(255),
	"choice" text,
	"amount" numeric(11, 4),
	"winAmount" numeric(11, 4),
	"status" "gameSiteBetsType" DEFAULT 'CREATED' NOT NULL,
	"betType" "betType" DEFAULT 'SINGLE' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "gameSiteTickets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"gameSiteName" text NOT NULL,
	"ticketId" varchar(255),
	"betTransactionId" bigint,
	"gameName" text,
	"choice" text,
	"betType" "betType" DEFAULT 'SINGLE' NOT NULL,
	"totalNumberOfBets" integer,
	"totalBetAmount" numeric(11, 4),
	"paymentAmount" numeric(11, 4),
	"changeAmount" numeric(11, 4),
	"kioskPlayerId" bigint,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "gamingSites" ADD COLUMN "gameSiteId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gameSiteBets" ADD CONSTRAINT "gameSiteBets_kioskPlayerId_users_id_fk" FOREIGN KEY ("kioskPlayerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameSiteBets" ADD CONSTRAINT "gameSiteBets_gameSessionId_gameSessions_id_fk" FOREIGN KEY ("gameSessionId") REFERENCES "public"."gameSessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameSiteBets" ADD CONSTRAINT "gameSiteBets_gameSiteId_gamingSites_id_fk" FOREIGN KEY ("gameSiteId") REFERENCES "public"."gamingSites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameSiteTickets" ADD CONSTRAINT "gameSiteTickets_betTransactionId_transactions_id_fk" FOREIGN KEY ("betTransactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gameSiteTickets" ADD CONSTRAINT "gameSiteTickets_kioskPlayerId_users_id_fk" FOREIGN KEY ("kioskPlayerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamingSites" ADD CONSTRAINT "gamingSites_gameSiteId_unique" UNIQUE("gameSiteId");