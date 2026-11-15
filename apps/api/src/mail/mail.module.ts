import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ConsoleMailTransport } from "./console-mail.transport.js";
import { MailService } from "./mail.service.js";
import { MAIL_TRANSPORT, type MailTransport } from "./mail.types.js";

@Module({
  providers: [
    ConsoleMailTransport,
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService, ConsoleMailTransport],
      useFactory: (
        config: ConfigService,
        consoleTransport: ConsoleMailTransport,
      ): MailTransport => {
        const transport = config.get<string>("MAIL_TRANSPORT") ?? "console";
        if (transport === "console") return consoleTransport;
        throw new Error(
          `Unsupported MAIL_TRANSPORT "${transport}". Implement MailTransport and register it in MailModule.`,
        );
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
