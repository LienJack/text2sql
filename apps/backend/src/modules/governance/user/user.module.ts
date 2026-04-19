import { Module } from "@nestjs/common";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [PlatformDataPersistenceModule],
  controllers: [UserController],
  providers: [UserService, AdminOnlyGuard],
  exports: [UserService]
})
export class UserModule {}
