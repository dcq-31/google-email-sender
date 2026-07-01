import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';
import { EmailStatus } from '../enums/email-status.enum';

/**
 * The Inbox table. One row per logical email received from RabbitMQ.
 * Column names are snake_case in Postgres; the entity exposes camelCase properties.
 * See specs/001-google-email-sender/data-model.md.
 */
@Entity('emails')
@Unique('uq_emails_tenant_message', ['tenantId', 'messageId'])
@Index('ix_emails_claimable', ['nextAttemptAt'], {
  where: `status = 'pending'`,
})
@Index('ix_emails_cleanup', ['sentAt'], { where: `status = 'success'` })
export class Email {
  /** UUID v7, generated app-side (PG17 has no native uuidv7()). */
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'tenant_name', type: 'text' })
  tenantName!: string;

  @Column({ name: 'app_name', type: 'text' })
  appName!: string;

  /** Producer Outbox id; dedupe key together with tenantId. */
  @Column({ name: 'message_id', type: 'text' })
  messageId!: string;

  @Column({ name: 'recipient', type: 'text' })
  recipient!: string;

  @Column({ name: 'subject', type: 'text' })
  subject!: string;

  @Column({ name: 'body', type: 'text' })
  body!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: EmailStatus,
    enumName: 'email_status',
    default: EmailStatus.Pending,
  })
  status!: EmailStatus;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  /** Earliest time the row may be claimed by a worker. */
  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ name: 'failure_count', type: 'integer', default: 0 })
  failureCount!: number;
}
