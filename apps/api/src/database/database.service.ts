import {
  Injectable,
  OnModuleDestroy
} from "@nestjs/common"

import { ConfigService } from "@nestjs/config"
import { Pool } from "pg"

import {
  createDb
} type Database from "@monorepo-blog/db"