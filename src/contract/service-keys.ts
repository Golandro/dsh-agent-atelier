/**
 * Service keys this bundle registers under. Frozen constants: the host's
 * `cordis.patch.yml` and the plugin tests both read them verbatim.
 */

/**
 * Service key of the agent-definition registry.
 *
 * Deliberately NOT `agents`: the host already registers the live Agent registry
 * under that key (`ctx.agents`), and a bundle must not shadow a native service.
 */
export const AGENT_REGISTRY_SERVICE = 'agentRegistry'

/**
 * Service key of the alias and model registry.
 *
 * Same reasoning one layer over: `aliasRegistry` is descriptive and the native
 * host does not occupy it, so ticket 03 resolves through this bundle's own
 * service instead of reaching into a native one (ADR-0001).
 */
export const ALIAS_REGISTRY_SERVICE = 'aliasRegistry'

/**
 * Service key of the control core (ticket 11/12): the six-member write and
 * composition face. Provided by the `./core` host row and consumed by the
 * `./ui-host` row (the HTTP projection); the browser never holds this service,
 * only the wire client of ticket 12.
 */
export const AGENT_CONTROL_SERVICE = 'agentControl'
