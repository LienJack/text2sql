import { Type } from "class-transformer";
import { IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { ContextEnvelopeDto } from "./context-envelope.dto";

export class SendMessageDto {
  @IsString()
  @Length(1, 500)
  message!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContextEnvelopeDto)
  contextEnvelope?: ContextEnvelopeDto;
}
