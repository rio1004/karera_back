CREATE TABLE "referralHistory" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referralId" integer NOT NULL,
	"action" varchar(50) NOT NULL,
	"user_id" integer NOT NULL,
	"details" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
