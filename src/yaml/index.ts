/**
 * Public entry of the yaml text-surgery domain: line tools, scalar rules, and
 * the frontmatter-field table. Every wing that touches raw YAML text reads
 * from here; none of it imports node or the host.
 */
export * from './lines.ts'
export * from './scalar.ts'
export * from './frontmatter-fields.ts'
