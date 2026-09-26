Links and Resources
World ID for Agents documentation
http://sandbox.auth.world.org/docs
↗
AgentPlugin
https://github.com/worldcoin/world-id-agent-plugin
↗
World ID for Agents Portal
http://sandbox.auth.world.org/portal
↗
Links and Resources
Agent Pulgin
https://github.com/worldcoin/world-id-agent-plugin
↗
World ID for Agents Docs
http://sandbox.auth.world.org/docs


Skip to content
World ID
Open portal
↗
Human continuity for apps and agents.
Recognize the same human across accounts, devices, and agents through a private identifier unique to your service.

On this page

Human continuity
What you can build
Private recognition
Fresh authentication
Powered by World ID
Start building
Standards
01 / Human Continuity

A lasting relationship with every human.
Human Continuity gives your product a stable way to recognize the same human across their accounts, devices, and agents while preserving privacy.

Welcome people back, carry reputation forward, and create experiences that grow more valuable with every interaction.

02 / Possibilities

Continuity that creates lasting value.
Build durable reputation
Let credibility, contribution history, and community standing grow through a private, sector-specific identifier.

Protect scarce benefits
Apply eligibility, claim limits, and participation rules consistently across every interaction with the same human.

Power human-backed agents
Give agent experiences a persistent connection to the human who authorized them, with fresh authentication for important actions.

Recover established accounts
Reconnect a returning human to their service account from a new device through the same continuity identifier.

Enforce lasting consequences
Carry suspensions, bans, and trust decisions across accounts, devices, and agents linked to the same continuity relationship.

03 / Private recognition

Familiar to your service.
Private to every relationship.
Human Continuity gives each service relationship its own private identifier. The identifier stays stable over time, so your product can recognize a returning human and preserve their history.

One account, viewed by three apps
App A · relationship A
private-id-A
App B · relationship B
private-id-B
App C · authorized for relationship A
private-id-A
Illustrative values. App C shares private-id-A after the owner of relationship A publishes an HTTPS authorization document listing App C’s exact callback URL.

Each service receives a private identifier for its relationship with the human, giving every service a foundation for its own data practices.

04 / Fresh authentication

Fresh confidence for important moments.
Use fresh authentication when an experience calls for stronger assurance. It brings the human into the flow at the moment that matters and gives your product a current authentication signal.

Your product defines the experience around that signal, from permissions and eligibility to benefits and high-value actions.

Together, durable continuity and fresh authentication create a flexible trust layer for every stage of the relationship.

05 / Technology

Powered by World ID.
World ID uses zero-knowledge proofs so the same verified person can be recognized over time while preserving privacy. The Human Continuity IdP makes that recognition available to applications through OpenID Connect.

Applications integrate with the Human Continuity IdP through OpenID Connect (OIDC). OIDC calls the relationship scope a sector and delivers the private identifier as the pairwise sub (subject) claim. The application stores the issuer and subject together to recognize the same person over time.

For agent experiences, the application uses the same OIDC federation, binds the issuer and subject to its own account or grant, and issues credentials for its APIs or MCP server.

06 / Next steps

Start with the integration guide.
For application registration, manage your OIDC client in the portal. The public integration guides cover the supported flows, subject contract, and authentication requirements.

Connect your coding agent to the MCP server at /mcp and let it guide you through the integration.

07 / Standards

Built on open standards.
The service implements the following standards across its OIDC federation and MCP OAuth surfaces. Each environment’s discovery metadata presents its available flows and options.

OpenID Connect
OpenID Connect Core 1.0 — authorization code flow, ID tokens, authentication freshness, and pairwise subjects.
OpenID Connect Discovery 1.0 — issuer, endpoints, capabilities, and signing-key discovery.
OpenID Connect Dynamic Client Registration 1.0, sector validation — sector identifier documents for pairwise subjects.
OAuth
RFC 6749 · OAuth 2.0 — authorization code grants; refresh grants are available on the MCP OAuth surface.
RFC 6750 · Bearer Token Usage — MCP access tokens in the HTTP Authorization header.
RFC 7009 · Token Revocation — MCP access and refresh token revocation.
RFC 7523 · JWT Client Authentication — private_key_jwt authentication with RS256.
RFC 7636 · PKCE — S256 proof-key protection for authorization code flows.
RFC 8252 · OAuth for Native Apps — the loopback redirect port exception for MCP clients.
RFC 8414 · Authorization Server Metadata — MCP OAuth endpoint and capability discovery.
RFC 8628 · Device Authorization Grant — confidential-client device login with explicit human approval.
RFC 9207 · Authorization Response Issuer — issuer identification in MCP authorization responses.
RFC 9470 · Authentication Step Up — OIDC freshness controls and the downstream challenge-and-retry boundary.
RFC 9728 · Protected Resource Metadata — MCP resource, authorization-server, scope, and bearer-method discovery.
JOSE
RFC 7515 · JSON Web Signature, RFC 7517 · JSON Web Key, and RFC 7519 · JSON Web Token — RS256 ID tokens, client assertions, and public key sets.
RFC 7638 · JWK Thumbprint — stable key identifiers for the IdP signing keys.
MCP clients are discovered through the current OAuth Client ID Metadata Document draft.

World ID · Documentation
Back to top ↑
© World

https://github.com/worldcoin/world-id-agent-plugin

