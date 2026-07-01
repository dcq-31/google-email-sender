import { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the `email_status` enum and the `emails` Inbox table with dedupe + worker/cleanup indexes. */
export class CreateEmailsTable1751299200000 implements MigrationInterface {
  name = 'CreateEmailsTable1751299200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "email_status" AS ENUM ('pending', 'processing', 'success', 'fail')`,
    );

    await queryRunner.query(`
      CREATE TABLE "emails" (
        "id"                 uuid PRIMARY KEY,
        "tenant_id"          text NOT NULL,
        "tenant_name"        text NOT NULL,
        "app_name"           text NOT NULL,
        "message_id"         text NOT NULL,
        "recipient"          text NOT NULL,
        "subject"            text NOT NULL,
        "body"               text NOT NULL,
        "status"             "email_status" NOT NULL DEFAULT 'pending',
        "created_at"         timestamptz NOT NULL,
        "sent_at"            timestamptz,
        "next_attempt_at"    timestamptz NOT NULL,
        "last_error_message" text,
        "failure_count"      integer NOT NULL DEFAULT 0,
        CONSTRAINT "uq_emails_tenant_message" UNIQUE ("tenant_id", "message_id")
      )
    `);

    // Worker hot path: due, pending rows, oldest first.
    await queryRunner.query(
      `CREATE INDEX "ix_emails_claimable" ON "emails" ("next_attempt_at") WHERE status = 'pending'`,
    );
    // Cleanup hot path: prune old successes.
    await queryRunner.query(
      `CREATE INDEX "ix_emails_cleanup" ON "emails" ("sent_at") WHERE status = 'success'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_emails_cleanup"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_emails_claimable"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "emails"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "email_status"`);
  }
}
