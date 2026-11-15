import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { MAIL_TRANSPORT, type MailTransport } from "./mail.types.js";

export interface InvitationEmailInput {
  to: string;
  organizationName: string;
  roleName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
  message?: string | null;
}

@Injectable()
export class MailService {
  private readonly from: string;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    config: ConfigService,
  ) {
    this.from = config.get<string>("MAIL_FROM") ?? "Heddlio <no-reply@heddlio.local>";
  }

  /**
   * Never throws into the caller's transaction: the invitation row is already
   * committed and is still valid even if the provider is down. The API reports
   * `emailDelivered: false` so the UI can offer "resend".
   *
   * At higher volume this should move to a transactional outbox, so a mail
   * failure is retried instead of being approximated by a boolean.
   */
  async sendInvitation(input: InvitationEmailInput): Promise<boolean> {
    const expiry = input.expiresAt.toISOString();
    const note = input.message ? `\n\nMessage from ${input.inviterName}: ${input.message}` : "";

    try {
      await this.transport.send({
        to: input.to,
        subject: `${input.inviterName} invited you to ${input.organizationName} on Heddlio`,
        text: [
          `${input.inviterName} invited you to join ${input.organizationName} as ${input.roleName} on Heddlio.`,
          "",
          `Accept the invitation: ${input.acceptUrl}`,
          "",
          `This link expires at ${expiry}. If you were not expecting it, you can ignore this email.`,
          note,
          "",
          `— ${this.from}`,
        ].join("\n"),
      });
      return true;
    } catch {
      return false;
    }
  }
}
