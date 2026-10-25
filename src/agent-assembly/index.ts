/**
 * Public entry of the agent-assembly layer (ticket 04): the pure planner and
 * the compat-mode runtime sink. The host row (`src/dsh/host/assembly.ts`) is
 * the only consumer inside this bundle; everything here reads the contract
 * layer only and never the host.
 */
export {
  DIGEST_CHANNEL_SECTION,
  FIRST_MESSAGE_CHANNEL_SECTION,
  MODEL_SYSTEM_SECTION,
  PERSONA_SECTION,
  PRE_STEP_CHANNEL_SECTION,
  SKILLS_SECTION,
  TOOLS_CHANNEL_SECTION,
  planAssembly,
} from './planner.ts'
export { createAssemblyService } from './sink.ts'
export type { AssemblyServiceOptions } from './sink.ts'
