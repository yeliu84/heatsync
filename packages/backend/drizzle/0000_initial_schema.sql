CREATE TABLE "extraction_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pdf_id" uuid NOT NULL,
	"swimmer_name_normalized" varchar(255) NOT NULL,
	"swimmer_name_display" varchar(255) NOT NULL,
	"meet_name" varchar(500) NOT NULL,
	"session_date" timestamp NOT NULL,
	"meet_date_start" timestamp,
	"meet_date_end" timestamp,
	"venue" varchar(500),
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "extraction_pdf_swimmer_unique" UNIQUE("pdf_id","swimmer_name_normalized")
);
--> statement-breakpoint
CREATE TABLE "pdf_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checksum" varchar(32) NOT NULL,
	"source_url" text,
	"filename" varchar(255),
	"file_size_bytes" integer NOT NULL,
	"openai_file_id" varchar(255),
	"openai_file_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_accessed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "pdf_files_checksum_unique" UNIQUE("checksum")
);
--> statement-breakpoint
CREATE TABLE "result_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_code" varchar(12) NOT NULL,
	"extraction_id" uuid NOT NULL,
	"view_count" integer DEFAULT 0,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "result_links_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
ALTER TABLE "extraction_results" ADD CONSTRAINT "extraction_results_pdf_id_pdf_files_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."pdf_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_links" ADD CONSTRAINT "result_links_extraction_id_extraction_results_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extraction_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_extraction_pdf_swimmer" ON "extraction_results" USING btree ("pdf_id","swimmer_name_normalized");--> statement-breakpoint
CREATE INDEX "idx_pdf_files_checksum" ON "pdf_files" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "idx_result_links_code" ON "result_links" USING btree ("short_code");