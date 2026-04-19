import { Module } from "@nestjs/common";
import { PlatformDataModule } from "../../platform/data/data.module";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [PlatformDataModule],
  controllers: [UserController],
  providers: [UserService, AdminOnlyGuard],
  exports: [UserService]
})
export class UserModule {}
