import { Module } from "@nestjs/common";

// Transitional compatibility shell.
// Use GovernanceAccessModule for policy services.
@Module({
  imports: [],
  exports: []
})
export class PlatformDataAccessModule {}
