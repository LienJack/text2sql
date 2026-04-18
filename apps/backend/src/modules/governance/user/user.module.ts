import { Module } from "@nestjs/common";
import { DataModule } from "../../data/data.module";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [DataModule],
  controllers: [UserController],
  providers: [UserService, AdminOnlyGuard],
  exports: [UserService]
})
export class UserModule {}
