export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const MAIL_TRANSPORT = Symbol("HEDDLIO_MAIL_TRANSPORT");

/**
 * Outbound email port.
 *
 * The console transport exists so invite flows are complete and testable
 * without provider credentials. Swapping in Resend/SES means implementing this
 * interface and selecting it in `MAIL_TRANSPORT`; no caller changes.
 */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}
