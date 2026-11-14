/** client 界面翼公共入口；dsh/client 的 slots 适配只消费这一份。 */
export { AgentControlPage } from './features/agent-control-page.tsx'
export type { AgentControlPageProps } from './features/agent-control-page.tsx'
export { AgentControlIcon } from './ui-react/agent-control-icon.tsx'
export type {
  ScopeSource,
  SessionListLike,
  WorkspaceListLike,
  WriteOnceStorage,
} from './ui-core/workspace-scope.ts'
