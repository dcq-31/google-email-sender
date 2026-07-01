import { EmailRepository } from '../repositories/email.repository';
import { EmailIngestService } from './email-ingest.service';

describe('EmailIngestService', () => {
  let repo: { insertPending: jest.Mock };
  let service: EmailIngestService;

  const valid = {
    tenantId: 't1',
    tenantName: 'Acme',
    appName: 'billing',
    messageId: 'm-1',
    recipient: 'to@example.com',
    subject: 'Hi',
    body: '<p>x</p>',
  };

  beforeEach(() => {
    repo = { insertPending: jest.fn() };
    service = new EmailIngestService(repo as unknown as EmailRepository);
  });

  it('acks a newly stored message', async () => {
    repo.insertPending.mockResolvedValue({ created: true, id: 'id-1' });
    expect(await service.ingest(valid)).toBe('ack');
    expect(repo.insertPending).toHaveBeenCalledWith(valid);
  });

  it('acks a duplicate as a no-op (Inbox)', async () => {
    repo.insertPending.mockResolvedValue({ created: false, id: null });
    expect(await service.ingest(valid)).toBe('ack');
    expect(repo.insertPending).toHaveBeenCalledTimes(1);
  });

  it('drops a schema-invalid message without requeue (never persists)', async () => {
    expect(await service.ingest({ tenantId: 't1', not: 'valid' })).toBe('drop');
    expect(repo.insertPending).not.toHaveBeenCalled();
  });

  it('requeues on a transient persist error', async () => {
    repo.insertPending.mockRejectedValue(new Error('db down'));
    expect(await service.ingest(valid)).toBe('requeue');
  });
});
