import {
  Injectable,
  OnModuleDestroy
} from "@nestjs/common"

import { ConfigService } from "@nestjs/config"
import { Pool } from "pg"

import { createDb, type Database } from "@monorepo-blog/db"


@Injectable()
export class DatabaseService implements OnModuleDestroy{
  private readonly pool: Pool;

  readonly db: Database;

  constructor(private readonly configService: ConfigService) {
    this.pool = new Pool({
      
      connectionString: this.configService.getOrThrow<string>(
        "DATABASE_URL"
      ),
      max: 10,

      idleTimeoutMillis: 300000,

      connectionTimeoutMillis: 5000
    
    })

    this.db = createDb(this.pool)
    
  }

  async onModuleDestroy() {
    await this.pool.end()
  }

  async healthCheck() {
    await this.pool.query("SELECT 1")
    return true
  }
}
