import { Injectable } from "@nestjs/common";
import { Text2SqlV2ArtifactBuilder } from "./text2sql-v2-artifact-builder";

/**
 * @deprecated `Text2SqlV2StateMachine` only remains as a compatibility alias.
 * Prefer `Text2SqlV2ArtifactBuilder` for v2 artifact normalization/building.
 */
@Injectable()
export class Text2SqlV2StateMachine extends Text2SqlV2ArtifactBuilder {}
