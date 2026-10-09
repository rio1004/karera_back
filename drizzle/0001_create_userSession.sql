CREATE TABLE "userSession" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" bigserial NOT NULL,
	"token" varchar(512) NOT NULL,
	"deviceInfo" varchar(255) DEFAULT 'unknown',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "userSession" ADD CONSTRAINT "userSession_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;