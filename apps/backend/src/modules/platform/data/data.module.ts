import { Module } from "@nestjs/common";

// Transitional compatibility shell.
// Do not use this aggregate module for new wiring.
@Module({
  imports: [],
  exports: []
})
export class PlatformDataModule {}
