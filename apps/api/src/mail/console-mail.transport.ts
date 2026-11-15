import { Injectable, Logger } from "@nestjs/common";

import type { MailMessage, MailTransport } from "./mail.types.js";

/**
 * Development transport: writes the whole message to the API log.
 *
 * This is intentionally verbose so a developer can copy the invite link out of
 * the terminal without opening a mailbox.
 */
@Injectable()
export class ConsoleMailTransport implements MailTransport {
  private readonly logger = new Logger("Mail");

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      [
        "",
        "──────────── outgoing email (console transport) ────────────",
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "─────────────────────────────────────────────────────────────",
      ].join("\n"),
    );
  }
}
