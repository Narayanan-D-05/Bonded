# VERIFY_FINDINGS: Phase 1 [VERIFY] research

Researched 2026-09-25. Every claim below comes from a primary source that was fetched: official docs pages, official GitHub source, npm registry metadata, or a live unauthenticated probe. Where a source was silent, the item is marked **UNCONFIRMED** and the missing piece is named. No code was written, no funds were spent, and no accounts were created. The only on-chain actions were read-only `eth_getCode`/`eth_call` on Sepolia and GraphQL reads on Sui testnet.

## Summary

| # | Item | Status | One-line answer |
|---|---|---|---|
| 1a | MultiBaas webhook payload and signature | CONFIRMED | Body is a JSON array of `{id, event, data}`. The signature is hex `HMAC-SHA256(secret, rawBody ‖ timestampDecimalString)`, sent in `X-MultiBaas-Signature` with `X-MultiBaas-Timestamp`. The docs give no replay-tolerance window. |
| 1b | MultiBaas contract link and event sync; Sepolia | CONFIRMED | Link through `POST /chains/ethereum/addresses/{addr}/contracts` with `startingBlock` (leaving it out disables indexing). Ethereum Sepolia (11155111) is "General Availability" with event indexing. |
| 1c | MultiBaas Cloud Wallets | CONFIRMED | These are **Azure Key Vault** EOAs. They need your own Azure account with a valid credit card or unexpired credits. Signing uses `signAndSubmit: true` on a contract call, or `POST /chains/ethereum/hsm/submit`. |
| 1d | MultiBaas TS SDK and base URL | CONFIRMED | `@curvegrid/multibaas-sdk@1.1.1`. Base URL is `https://<deployment>.multibaas.com/api/v0`. One docs page shows `/api/v1`; the SDK's base path is `/api/v0`. |
| 1e | MultiBaas manual provisioning | CONFIRMED | Console signup, then deployment (network fixed at creation), then API key (group-scoped), CORS, webhook, and Azure for Cloud Wallet. The free plan allows 1 cloud wallet and 5 active contracts, and indexing starts at most 100 blocks back. |
| 2a | ENSv2 on Sepolia | CONFIRMED | Deployed as "Sepolia (ENSv2 Beta)". The addresses are listed below, and all six I probed have bytecode on chainId `0xaa36a7`. Nothing needs self-deploying except your own resolver and registry proxies. |
| 2b | EAC scoped to text records | CONFIRMED | Use `grantSetterRoles(bytes setter, address account)` on the PermissionedResolver, with `ROLE_SET_TEXT = 1 << 4` scoped to `keccak256(bytes(key))`. **Resolver roles have no per-name scoping.** |
| 2c | Subname creation | CONFIRMED | `register(string label, address owner, IRegistry registry, address resolver, uint256 roleBitmap, uint64 expiry)` on a UserRegistry proxy (VerifiableFactory), wired in with `setSubregistry` on the parent. |
| 2d | ENSIP-25 / ENSIP-26 keys | CONFIRMED | `agent-registration[<ERC-7930 registry>][<agentId>]`, `agent-context`, `agent-endpoint[<protocol>]`. **Neither ENSIP defines a bond-history or reputation key.** |
| 2e | ENSv2 TS library | CONFIRMED | Reads: `viem >= 2.35.0` (latest 2.56.9). Writes: the docs say library support is "limited to preview releases (ENSjs v5)", so plain viem plus ABIs from `ensdomains/contracts-v2` is the documented path. No ENSv2 ABI npm package exists. |
| 3a | World OIDC discovery | CONFIRMED | Fetched live (fields below). Scope is exactly `openid`. The flows are code with S256 PKCE, and device code. There is no userinfo endpoint. |
| 3b | World RP client registration | CONFIRMED | Google-authenticated portal at `/portal`. Confidential clients only. The secret is shown once. **Sandbox callbacks must be HTTPS and match exactly; HTTP localhost is rejected.** |
| 3c | "Proofs are mocked" | PARTIAL | The sandbox UI says "Sandbox — Uses fake identities." The plugin README requires "the sandbox World ID app" and its "test proof-of-human flow". **UNCONFIRMED:** where to get the sandbox app, and the exact browser-flow error parameters for a denial. Device-flow errors are documented. |
| 3d | AgentPlugin repo | CONFIRMED | A Claude Code / Codex plugin: an MCP config pointing at `https://sandbox.auth.world.org/mcp` plus 4 skill markdown files. **It is not an SDK or library.** |
| 4 | x402 402 shape, packages, Sui | PARTIAL | v2 headers are `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`, each carrying base64 JSON. Packages are `@x402/*@2.27.0`. A Sui `exact` **spec exists**, but the **official TS SDK has no Sui mechanism**, and the x402.org and PayAI facilitators list no Sui network. |
| 5 | Intercepta example responses | PARTIAL | The docs publish **no example 200 bodies**, only OpenAPI schemas (field names below). `toxicScore` is a number with **no documented range**. Token `riskScore` is "Risk percentage" with example 70. The address parameter is "ETH address/ENS". |
| 6 | Sui USDSUI | CONFIRMED | 6 decimals, name "USD Sui Stablecoin", supply 43,000.000000. **Not freely mintable:** there is no public mint, and the `TreasuryCap` is owned by `0x916c7acc…f05a`. It is not an official coin or a faucet coin. |

---

## 1. MultiBaas (Curvegrid)

### 1a. Webhooks: payload, headers, and signature

Source: https://docs.curvegrid.com/multibaas/webhooks

- Event types: "`transaction.included`: Any Cloud Wallet transaction has been included in a block on the blockchain." and "`event.emitted`: A smart contract event has been emitted for any smart contract that has sync events enabled."
- Body: "The HTTP body contains a JSON array of blockchain events, in the following format:"
  ```
  [ { "id": "<event identifier>", "event": "<transaction.included|event.emitted>" "data": {} } ]
  ```
  "`transaction.included`: The same format as returned by the transaction receipt endpoint. `event.emitted`: The same format as returned by the list events API endpoint."
- Sample `event.emitted` element, abridged from the doc's full sample:
  ```json
  {"id":"952699ad-...","event":"event.emitted","data":{
    "triggeredAt":"2023-11-10T11:11:30+09:00",
    "event":{"name":"Mint","signature":"Mint(address,address,uint256)",
      "inputs":[{"name":"minter","value":"0xF945...","hashed":false,"type":"address"}, ...],
      "rawFields":"{\"address\":...,\"topics\":[...],\"data\":...,\"blockNumber\":\"0xa\",\"transactionHash\":...,\"logIndex\":\"0x0\",\"removed\":false}",
      "contract":{"address":"0x9deE...","addressLabel":"autotoken","name":"MltiToken","label":"mltitoken"},
      "indexInLog":0},
    "transaction":{"from":...,"txData":...,"txHash":...,"txIndexInBlock":0,"blockHash":...,"blockNumber":10,
      "contract":{...},"method":{"name":"mint","signature":"mint(uint256)","inputs":[...]}}}}
  ```
  The sample `transaction.included` `data` has these keys: `tx{type,chainId,nonce,to,gas,gasPrice,maxPriorityFeePerGas,maxFeePerGas,value,input,accessList,v,r,s,yParity,hash}`, `status:"included"`, `from`, `failed`, `blockNumber`, `blockHash`, `resubmissionAttempts`, `successfulResubmissions`, `createdAt`, `updatedAt`. Note that event `inputs[].value` is a decimal string such as `"123.456"`, with type conversions applied.
- Headers: "The `X-MultiBaas-Signature` header contains the HMAC (Hash-based Message Authentication Code) signature, and the `X-MultiBaas-Timestamp` header holds the timestamp." The sample request shows them as `X-Multibaas-Signature: 50942f...` (64 hex characters) and `X-Multibaas-Timestamp: 1699582292` (Unix seconds). Header names are case-insensitive.
- Algorithm: "The HMAC algorithm uses the SHA-256 hashing function and the provided secret key to create a unique signature for the combination of the request's body and the timestamp." The doc's Go source:
  ```go
  timestampStr := strconv.FormatInt(timestamp, 10)
  // The message is the data + timestamp (as a decimal string)
  mac := hmac.New(sha256.New, []byte(secret))
  mac.Write(data)
  mac.Write([]byte(timestampStr))
  signature := hex.EncodeToString(mac.Sum(nil))
  ```
  Verification therefore works like this: take the **raw request body bytes, unparsed**, append the `X-MultiBaas-Timestamp` header value exactly as received, compute HMAC-SHA256 with the webhook secret, hex-encode it (lowercase, as in the sample), and do a constant-time compare against `X-MultiBaas-Signature`.
- Where the secret comes from: in the SDK model `WebhookEndpoint`, the field `secret: string` is documented as "The secret key used to sign the webhook." It is returned by `POST /webhooks` and `GET /webhooks/{webhookID}` (source: https://github.com/curvegrid/multibaas-sdk-typescript/blob/HEAD/api.ts, `interface WebhookEndpoint`). **UNCONFIRMED:** where the console UI displays the secret. The webhooks doc page does not mention it.
- **UNCONFIRMED:** the allowed timestamp skew or replay window, and the retry schedule. The model exposes `nextAttempt`, `lastAttempt`, `failedCalls` and `lastError`, so retries exist, but the policy is not documented.

### 1b. Linking and syncing a contract; Sepolia

- Console (https://docs.curvegrid.com/multibaas/manage-contracts): "To link a contract, go to the Navigation bar and select Contracts. Then click on On-chain... choose Link Contract. Choose sync events and optionally adjust the starting block number." The ABI must first be in the Library, uploaded as an ABI or artifact, or found with "Contract from Address" via Blockscout, Etherscan or Sourcify.
- API, from SDK source `@curvegrid/multibaas-sdk@1.1.1`:
  - `POST /contracts/{contract}`: `createContract` (adds the ABI to the library).
  - `POST /chains/ethereum/addresses/{address-or-alias}/contracts`: `linkAddressContract(addressOrAlias, LinkAddressContractRequest)`, where `LinkAddressContractRequest = { label: string; version?: string; startingBlock?: string }`. The source comment on `startingBlock` reads: "The value can be `latest`..., an absolute block number..., or a relative block number (e.g. `-100`...). **If absent, event indexing will be disabled for this contract and events won't be synced.**"
  - `GET /chains/ethereum/addresses/{address-or-alias}/contracts/{contract}/status`: `getEventIndexingStatus`.
  - `GET /events`: `listEvents` (the source of the `event.emitted` data shape).
- Sepolia: the live network list at https://assets.multibaas.com/chains.json (the data behind https://docs.curvegrid.com/multibaas/networks/supported-networks) contains `{"chainName":"Ethereum Sepolia","chainId":11155111,...,"multiBaasSupport":{"eventIndexing":true,"status":"🟢 General Availability"}}`. There are 34 networks, all EVM, with no Sui entry. A deployment is "linked to a single blockchain" and "the network cannot be changed once set" (https://docs.curvegrid.com/multibaas/getting-started/account-and-deployment).
- Free-plan limit that matters here (https://www.curvegrid.com/pricing): "Event indexing is capped at 2 events per second starting up to 100 blocks back from the chain head." Link the contract with a recent `startingBlock` right after it is deployed.

### 1c. Cloud Wallets

- What they are (https://docs.curvegrid.com/multibaas/cloud-wallets): "MultiBaas' Cloud Wallet feature integrates smart contract function calls with externally owned accounts (EOAs) managed by **Microsoft Azure Key Vault**." Also: "When setting up Azure Key Vault, your Azure account's billing details **must be configured with a valid credit card, or have credits that have not yet expired**." Pricing FAQ: "wallets are created in your own cloud provider account (currently we support Azure Key Vault, more coming soon)." Keys can be software-protected (Standard SKU) or HSM-protected (Premium SKU, which costs extra). So they are KMS-backed, but only through Azure.
- Console setup needs Client ID, Client Secret, Tenant ID, Subscription ID, Resource Group, and Vault Name, all of which the doc's PowerShell quickstart produces. You then use Create Key or Import Key.
- Signing and sending (https://docs.curvegrid.com/multibaas/getting-started/build-a-backend): "Simply pass the `"signAndSubmit": true` parameter along with a smart contract function call that writes to the blockchain, and MultiBaas will have the Cloud Wallet sign the transaction, and automatically submit it." From the SDK source:
  - `POST /chains/ethereum/addresses/{address-or-alias}/contracts/{contract}/methods/{method}`: `callContractFunction(addressOrAlias, contract, method, PostMethodArgs)`. `PostMethodArgs` includes `args`, `from`, `signAndSubmit?: boolean` ("If the `from` address is an HSM address and this flag is set to `true`, the transaction will be automatically signed and submitted"), `nonceManagement?`, `signer?`, `contractOverride?`, and gas fields.
  - `POST /chains/ethereum/hsm/submit`: `signAndSubmitTransaction(CloudWalletTXToSign)`, where `CloudWalletTXToSign = { tx: CloudWalletTx }` and `type` is `'0'|'1'|'2'|'4'`.
  - `POST /chains/ethereum/hsm/sign`: `signData`. `GET /hsm/wallets`: `listHsmWallets`.
  - The backend doc says signing Cloud Wallet transactions needs an **Administrators**-group API key.
- Sepolia: Cloud Wallets are chain-agnostic EVM signing, and the deployment's network is Sepolia. **UNCONFIRMED:** no page says "Cloud Wallets on Sepolia" explicitly.
- SDK drift I found: the repo's `example/index.ts` calls `contractsApi.callContractFunction(chain, contractAddr, ...)` with 6 arguments. The published `1.1.1` `dist/api.d.ts` signature is `callContractFunction(addressOrAlias, contract, method, postMethodArgs, options?)`, with no `chain` argument. Follow the `.d.ts`, not the example.

### 1d. SDK package and base URL

- npm: `@curvegrid/multibaas-sdk`, `dist-tags.latest = 1.1.1`, published 2026-03-09 (https://registry.npmjs.org/@curvegrid/multibaas-sdk). The repo is https://github.com/curvegrid/multibaas-sdk-typescript and the only dependency is `axios ^1.13.5`. The docs link to it at https://docs.curvegrid.com/multibaas/sdks.
- Base URL: SDK `base.ts` has `BASE_PATH = 'https://your_deployment.multibaas.com/api/v0'`, and the README says "All URIs are relative to https://your_deployment.multibaas.com/api/v0". Usage: `new MultiBaas.Configuration({ basePath, accessToken })`. Auth is `Authorization: Bearer <API key>`.
- Discrepancy: https://docs.curvegrid.com/multibaas/api-keys shows `curl -X POST 'https://your-deployment.multibaas.com/api/v1/contract'`. The SDK, the frontend guide, and the SDK example all use `/api/v0`. **Treat `/api/v0` as authoritative**, and confirm with one live call after provisioning.

### 1e. Manual provisioning (MultiBaas)

The steps are in the checklist at the end. Source pages: account-and-deployment, api-keys, users-rbac, build-a-frontend (CORS), webhooks, cloud-wallets, and pricing (free plan: "3 users, 5 active contracts, 1 cloud wallet, and 30,000 API calls per month"; "up to two deployments for free").

---

## 2. ENSv2

### 2a. Deployed on Sepolia

- https://docs.ens.domains/ensv2/overview: "ENSv2 is deployed on the Sepolia testnet". https://docs.ens.domains/learn/deployments#sepolia-ensv2-beta: "Sepolia runs the ENSv2 contracts". The contracts are "not yet final and may change prior to mainnet deployment".
- Addresses from that table. ABIs and sources are pinned at `ensdomains/contracts-v2@71a3b7339dbc55ab47667abdfe8303bac4f4c24e`:

| Contract | Address |
|---|---|
| RootRegistry (PermissionedRegistry) | `0x9703dbd26dab89504490994138cf2c575251a9ce` |
| ETHRegistry (PermissionedRegistry) | `0x657ea849311d3d5823348dded7c2aaafb3ede09e` |
| ETHRegistrar | `0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca` |
| StandardRentPriceOracle | `0x9b0b9c65bdaf9794ff7697e4dcfb1f50581072bb` |
| VerifiableFactory | `0x9e726eb570beb6bceb495ab8cda7df517d4e841c` |
| PermissionedResolverImpl | `0x14f09fd05d4585759e54844dc9b00147131cf243` |
| UserRegistryImpl | `0xa80338aaa8d23831cea25e858d1774534abb0263` |
| UniversalResolverV2 | `0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3` |
| UpgradableUniversalResolverProxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| UniversalHelper | `0x33f571aa8a160a21b877cf6e0fb8806692b97df5` |
| PublicResolverV2 | `0xd7e590ad0e92a6ac1d81f4483a9b951d3585a50f` |
| MockUSDC (test, `mint` has no access control) | `0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e` |
| MockDAI | `0x278053acc97888e63ec81c80fec641bf0bf19664` |

  The deployments page lists further contracts (DNS*, migration, HCA*, and others).
- Live probe on Sepolia via `https://ethereum-sepolia-rpc.publicnode.com` (`eth_chainId` = `0xaa36a7`). `eth_getCode` returned non-empty bytecode for ETHRegistry, VerifiableFactory, PermissionedResolverImpl, UserRegistryImpl, ETHRegistrar and MockUSDC. Read-only `eth_call` results:
  - `StandardRentPriceOracle.isPaymentToken(MockUSDC)` returned `true`.
  - `isPaymentToken(MockDAI)` returned `true`.
  - MockUSDC `symbol()` returned `"USDC"` and `decimals()` returned `6`.
  - `ETHRegistrar.MIN_COMMITMENT_AGE()` returned `60`.
- The readiness page (https://docs.ens.domains/web/ensv2-readiness) says "The Sepolia deployment currently accepts USDC (both Circle's Sepolia USDC and a freely mintable test USDC) and a test DAI." MockERC20 source has `function mint(address to, uint256 amount) external { _mint(to, amount); }` with no access check (`contracts/test/mocks/MockERC20.sol` at the pinned commit).
- On PRD F.5: "Deploy ENSv2 registry/resolver contracts on Sepolia" is **not needed as written**. The protocol is already deployed. You deploy only your own **UserRegistry proxy** (for subnames) and **PermissionedResolver proxy/proxies** through the VerifiableFactory, then add those addresses to MultiBaas.

### 2b. Enhanced Access Control scoped to text records

- EAC write functions (https://docs.ens.domains/ensv2/enhanced-access-control): `grantRoles(resource, roleBitmap, account)`, `revokeRoles(resource, roleBitmap, account)`, `grantRootRoles(roleBitmap, account)`, `revokeRootRoles(roleBitmap, account)`. `ROOT_RESOURCE` is 0. Up to 15 holders per role per resource. The admin role is `role << 128`.
- Permissioned Resolver (https://docs.ens.domains/ensv2/permissioned-resolver): "The generic `grantRoles()` is disabled on the Permissioned Resolver and always reverts with `EACCannotGrantRoles`. Argument-scoped permissions (a single text key, coin type...) are granted with `grantSetterRoles(setter, account)`: setter is ABI-encoded calldata of the setter to authorize". The same text appears in source (`contracts/src/resolver/PermissionedResolver.sol` @71a3b73):
  ```solidity
  function grantSetterRoles(bytes calldata setter, address account) external returns (bool)
  function setText(bytes calldata name, string calldata key, string calldata value)
      external onlyRoles(PermissionedResolverLib.resource(key), PermissionedResolverLib.ROLE_SET_TEXT)
  function grantRoles(uint256 resource, uint256 roleBitmap, address account) public pure ... { revert EACCannotGrantRoles(...); }
  function initialize(Grant[] calldata grants, bytes[] calldata calls) external initializer
  ```
  Constants (`PermissionedResolverLib.sol`): `ROLE_SET_TEXT = 1 << 4` and `ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128`. The resource for a text key is `keccak256(bytes(key))`. You revoke with `revokeRoles(BigInt(keccak256(toHex(key))), ROLE_SET_TEXT, account)`.
  Doc example: `setter = encodeFunctionData({abi, functionName:'setText', args:['0x', 'avatar', '']})`, then `grantSetterRoles(setter, dappAddress)`.
- **Critical scoping caveat:** "There is no per-name scoping: a role holder can write the covered records on every name served by the resolver instance." Also: "Argument-scoped grants apply to every name served by the resolver instance... **To give an account access to records of specific names only, serve those names from their own resolver instance.**" For this project, scoping an agent to *its own* subname's text records therefore needs **one PermissionedResolver proxy per agent subname**, set with `setResolver` on the UserRegistry.
- Setters take the **DNS-encoded name** (`toHex(packetToBytes(name))` from `viem/ens`), not a namehash.
- Event useful for MultiBaas `event.emitted`: `TextUpdated(recordId, keyHash, key, value)`.

### 2c. Subname creation in the Permissioned Registry

- Source (`contracts/src/registry/PermissionedRegistry.sol` @71a3b73):
  ```solidity
  function register(string memory label, address owner, IRegistry registry, address resolver,
                    uint256 roleBitmap, uint64 expiry) public virtual returns (uint256)
  function setSubregistry(uint256 anyId, IRegistry registry) public virtual
  function setResolver(uint256 anyId, address resolver) public virtual
  function grantRoles(uint256 anyId, uint256 roleBitmap, address account) public ... returns (bool)
  ```
  The docs say: "If owner is address(0), the name is reserved instead of registered". `expiry` is "an absolute Unix timestamp, not a duration". `label` is "the subname label only (e.g., 'sub' for sub.nick.eth)". The caller needs `ROLE_REGISTRAR = 1 << 0` on ROOT_RESOURCE.
- The flow per https://docs.ens.domains/ensv2/tutorial-contract-developers and https://docs.ens.domains/ensv2/verifiable-factory:
  1. Own a parent name, e.g. `bonded.eth`, in the ETHRegistry. Register it through the ETHRegistrar with commit-reveal: wait at least 60 s, then pay in an approved ERC20 (MockUSDC works).
  2. Deploy a UserRegistry proxy: `VerifiableFactory.deployProxy(address implementation, uint256 salt, bytes data)` with `implementation = UserRegistryImpl`, `data = initialize((address account, uint256 roleBitmap)[] grants)`. The salt scheme is `keccak256(abi.encode(keccak256("UserRegistry"), namehash, version))`. "The bitmap must include at least ROLE_REGISTRAR_ADMIN and ROLE_RENEW_ADMIN" if roles will be granted later.
  3. On the ETHRegistry, call `setSubregistry(anyId, userRegistryAddress)`.
  4. On the UserRegistry, call `register("agent1", owner, IRegistry(address(0)), resolver, roleBitmap, expiry)`.
  5. Deploy the per-agent PermissionedResolver: `deployProxy(PermissionedResolverImpl, salt, initialize(grants, calls))` with the salt scheme `keccak256("OwnedResolver", owner, version)`.
- Registry role values (https://docs.ens.domains/ensv2/permissioned-registry): `ROLE_REGISTRAR 1<<0`, `ROLE_REGISTER_RESERVED 1<<4`, `ROLE_SET_PARENT 1<<8`, `ROLE_UNREGISTER 1<<12`, `ROLE_RENEW 1<<16`, `ROLE_SET_SUBREGISTRY 1<<20`, `ROLE_SET_RESOLVER 1<<24`, `ROLE_CAN_TRANSFER_ADMIN (1<<28)<<128`, `ROLE_SET_URI 1<<36`, `ROLE_UPGRADE 1<<124`.
- Caveat: token IDs change whenever roles change ("Mutable Token IDs"). Key caches by labelhash.

### 2d. ENSIP-25 and ENSIP-26

- ENSIP-25 (https://docs.ens.domains/ensip/25, status: draft), "AI Agent Registry ENS Name Verification". Key: `agent-registration[<registry>][<agentId>]`, where "`<registry>` is the ERC-7930 interoperable address of the registry contract (hexadecimal string with 0x prefix)" and `<agentId>` "MUST NOT contain the characters [ or ]". "Implementations SHOULD set the value to '1'... the presence of a non-empty value is interpreted as an attestation." Example: `agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][167]`. The record only makes sense if the agent is in an on-chain agent registry such as ERC-8004.
- ENSIP-26 (https://docs.ens.domains/ensip/26, status: draft), "Agent Text Records". Keys:
  - `agent-context`: "Any format suitable for agentic systems (plain text, Markdown, YAML, JSON, etc.)"
  - `agent-endpoint[<protocol>]`: "A URL". Protocols are `mcp`, `a2a` and `web`; "Additional protocol values MAY be used".
- **PRD mismatch (Part E, ENS row):** the PRD says "bond history in Agent Text Records (ENSIP-26)", but **ENSIP-26 defines no bond, history or reputation key.** The standard-compliant options are to embed bond history in the `agent-context` content, or to use a separate custom key that ENSIP-26 does not govern. The team needs to decide this before `ens/write-record.ts` is written.

### 2e. TS library

- https://docs.ens.domains/web/ensv2-readiness: "viem: >= v2.35.0", "ENSjs: >= v4.2.3" (reads). "At the time of writing, ENSv2 write support in libraries is limited to preview releases (ENSjs v5), so applications that write to ENS need to update these code paths themselves."
- npm, fetched live:
  - `viem` latest `2.56.9`, next `3.0.0-next.10`.
  - `@ensdomains/ensjs` latest `4.3.1`. Preview tags are `alpha: 5.0.0-alpha.1` and `sepolia-fix: 5.0.0-sepolia-fix.1`, both published 2026-05-26.
  - `@ensdomains/contracts-v2` returns "Not found" on npm.
- The ENS docs' own write examples all use **plain viem `writeContract` with `permissionedResolverAbi` / `permissionedRegistryAbi`**. The ABIs are the JSON files under `contracts/deployments/sepolia/*.json` in `ensdomains/contracts-v2` at the pinned commit, and the Foundry route is `forge install ensdomains/contracts-v2`. Recommendation from the docs: viem plus ABIs for writes. `ensjs@5` is a preview only.

---

## 3. World ID for Agents (sandbox)

### 3a. OIDC discovery (fetched live, HTTP 200)

`GET https://sandbox.auth.world.org/.well-known/openid-configuration`:
```json
{
 "issuer": "https://sandbox.auth.world.org",
 "authorization_endpoint": "https://sandbox.auth.world.org/api/v1/authorize",
 "token_endpoint": "https://sandbox.auth.world.org/api/v1/token",
 "device_authorization_endpoint": "https://sandbox.auth.world.org/api/v1/device_authorization",
 "token_endpoint_auth_methods_supported": ["client_secret_basic","client_secret_post","private_key_jwt"],
 "jwks_uri": "https://sandbox.auth.world.org/.well-known/jwks.json",
 "response_types_supported": ["code"], "response_modes_supported": ["query"],
 "grant_types_supported": ["authorization_code","urn:ietf:params:oauth:grant-type:device_code"],
 "scopes_supported": ["openid"],
 "claims_supported": ["iss","sub","aud","exp","iat","jti","nonce","auth_time","acr","amr"],
 "prompt_values_supported": ["none","login"],
 "acr_values_supported": ["https://world.org/oidc/acr/orb-v3"],
 "subject_types_supported": ["pairwise"],
 "id_token_signing_alg_values_supported": ["RS256"],
 "code_challenge_methods_supported": ["S256"],
 "request_uri_parameter_supported": false
}
```
There is no `userinfo_endpoint`. The guides live in the MCP server's public `get_idp_guide` tool (see https://sandbox.auth.world.org/llms.txt). I read `getting-started`, `oidc` and `step-up` through an unauthenticated MCP session. Key contract points from the `oidc` guide:
- "Configure the OIDC library to use exactly `scope=openid`, `response_type=code`, and query response mode."
- "Codes are single-use and last five minutes." "ID tokens last five minutes."
- "The response contains `id_token`, an opaque `access_token`, `token_type: "Bearer"`, and `expires_in: 300`; no refresh token is issued."
- "The ID token carries `iss`, `sub`, `aud`, `exp`, `iat`, `jti`, `auth_time`, `acr`, and `amr`... no email, name, or raw World proof."
- "Use `auth_time` for freshness, never `iat`." For step-up, use `max_age=0` or `prompt=login`. `acr` is `https://world.org/oidc/acr/orb-v3` and `amr` is `["pop"]`.

### 3b. Registering a relying-party client

- Portal: "Register a client through `https://sandbox.auth.world.org/portal`... Portal self-service registration is supported; OIDC dynamic client registration (DCR), CIMD registration, and public OIDC clients are not." Portal sign-in uses **Google**, not World ID. "`account_not_eligible` may require organizer/operator help, including for Gmail accounts... Registration can also be disabled or limited by the number of clients already owned."
- Secret: "Save the generated secret immediately in backend configuration: **it is shown only once**." You can use `private_key_jwt` instead (register a public JWKS). "The client authentication method and sector are immutable." The default method is `client_secret_basic`, per the plugin's developer skill.
- Redirect URIs: "**Use HTTPS callbacks for production and sandbox.** Local, test, and staging also accept registered HTTP loopback callbacks." The plugin README says: "**sandbox does not accept HTTP localhost callbacks**." "OIDC callbacks match exactly, including scheme, path, query, and port; there are no wildcard or variable-port callbacks. A device-only client still needs a registered redirect URI." The sector is the redirect hostname. Several hostnames require a `sector_identifier_uri`.
- An agent can stage registration over MCP with `request_oidc_client_registration`, but "Send the returned `portalUrl` to the human for approval... Requests expire after 20 minutes."
- PRD F.7 has both `WORLD_SANDBOX_CLIENT_ID` and `WORLD_SANDBOX_CLIENT_SECRET`, which is consistent with a confidential client.

### 3c. What "proofs are currently mocked" means

- The phrase "mocked" does **not** appear in any primary source I fetched. The closest statements:
  - The sandbox SPA bundle (`https://sandbox.auth.world.org/assets/index-B7TTCPa6.js`) contains `e==="sandbox.auth.world.org"?{name:"World ID Agents",noticeTitle:"Sandbox",noticeBody:"Uses fake identities."}`.
  - Plugin README (https://github.com/worldcoin/world-id-agent-plugin): "have the **sandbox World ID app** ready and complete its **test proof-of-human flow**. A staging or production verification is not a substitute for sandbox setup."
  - `getting-started` guide: "Test proof behavior in a non-production environment is not evidence of production verification."
  - The SPA's verify deep link accepts `https://*.world.org/verify` or the `worldidsandbox:` / `worldidstg:` URL schemes, plus the UI string "Keep this page open while we prepare the World ID app request".
- So the sandbox login does **not** accept the regular World App with a production credential. It needs a sandbox build of the World ID app with a test (fake) identity. **UNCONFIRMED:** where to download or install the sandbox World ID app. The protected `world-id-users` guide may say, but it requires World ID sign-in to read. **UNCONFIRMED:** whether any no-phone mock user exists.
- Denied or expired, device grant (documented): the token endpoint returns HTTP 400 with `authorization_pending` (keep waiting) or `slow_down` (add 5 s). You stop on `access_denied`, `expired_token` or `invalid_grant`. "The device code expires 20 minutes after creation." HTTP 503 means temporary unavailability and is "never approval".
- Denied or expired, browser code flow: the troubleshooting table lists `invalid_request`, `invalid_scope`, `invalid_client`, `invalid_grant`, `login_required`/`interaction_required` (with `prompt=none`) and `world_id_3_not_available`. SPA strings include "This sign-in request is invalid or has expired." and "This request is unavailable, expired, or belongs to another browser." **UNCONFIRMED:** the exact `error=` value redirected to the RP callback when the human denies in the browser flow. Standard OIDC would be `access_denied`, but the guides do not state it.
- Live probes with a bogus client (no account used):
  - `GET /api/v1/authorize?client_id=bogus...` returned 400 `{"error":"invalid_request"}`.
  - `POST /api/v1/token` returned 400 `{"error":"invalid_request"}`.
  - `POST /api/v1/device_authorization` returned 400 `{"error":"invalid_client"}`.
- **Architectural note for the Recovery Desk / "fresh verification at a moment that matters":** the documented primitive is OIDC step-up (`max_age=0` or `prompt=login`, then validate `auth_time`), or the device grant for headless agents. Both require a human with the sandbox World ID app at demo time.

### 3d. What the AgentPlugin repo provides

https://github.com/worldcoin/world-id-agent-plugin (default branch `main`, pushed 2026-09-23). The file tree is only:
- `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`: marketplace `world-id-demo` with plugin `world-id-sandbox`.
- `plugins/world-id-sandbox/.mcp.json`: `{"mcpServers":{"world-id-sandbox":{"type":"http","url":"https://sandbox.auth.world.org/mcp"}}}`.
- `plugin.json`: name `world-id-sandbox`, version `0.1.0+build.20260923021338`, author "Tools for Humanity".
- Four skills, as markdown instructions only:
  - `world-id-account`: call `get_world_id_account`, and report connected only if `status: active` and `world_id_verified: true`.
  - `world-id-benefits`.
  - `world-id-developer`: register or configure an OIDC client through MCP tools.
  - `world-id-sign-in`: relay the "Approval link".
- Install: `claude plugin marketplace add worldcoin/world-id-agent-plugin`, then `claude plugin install world-id-sandbox@world-id-demo`, then `claude mcp login plugin:world-id-sandbox:world-id-sandbox`.
- It contains **no SDK, no library code and no callback handler**. PRD F.0's "Identity SDK: World ID for Agents sandbox client" should be read as "a standard OIDC client against the discovery doc". The MCP tools it exposes are listed by `tools/list` on the live endpoint: `get_world_id_account`, `get_benefits`, `list_idp_guides`, `get_idp_guide`, `request_oidc_client_registration`, `get_portal_credential_request`, `list_oidc_clients`, `get_oidc_client`, `update_oidc_client`, and the secret, JWKS and membership tools. Per the tool descriptions, `get_world_id_account` "Confirms prior verification, not fresh human presence".

---

## 4. x402

Sources: https://docs.x402.org/core-concepts/http-402, https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md, https://docs.x402.org/getting-started/quickstart-for-sellers, https://docs.x402.org/core-concepts/network-and-token-support.

- v2 headers: "`PAYMENT-REQUIRED` | Server → Client | Base64-encoded `PaymentRequired` object", "`PAYMENT-SIGNATURE` | Client → Server | Base64-encoded `PaymentPayload` object", "`PAYMENT-RESPONSE` | Server → Client | Base64-encoded `SettlementResponse` object". "Response bodies are a server implementation concern. All x402 protocol information is communicated through headers."
- 402 challenge: `HTTP/1.1 402 Payment Required` with a `PAYMENT-REQUIRED` header that decodes to:
  ```json
  {"x402Version":2,"error":"PAYMENT-SIGNATURE header is required",
   "resource":{"url":"https://api.example.com/premium-data","description":"...","mimeType":"application/json"},
   "accepts":[{"scheme":"exact","network":"eip155:84532","amount":"10000",
               "asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e",
               "payTo":"0x2096...","maxTimeoutSeconds":60,"extra":{"name":"USDC","version":"2"}}]}
  ```
- Retry: the `PAYMENT-SIGNATURE` header carries `{"x402Version":2,"resource":{...},"accepted":{<one element of accepts>},"payload":{...scheme/network specific...}}`.
- Settlement: `PAYMENT-RESPONSE` returns `{"success":true,"transaction":"0x...","network":"eip155:84532","payer":"0x..."}` on success. On failure it returns 402 with `{"success":false,"errorReason":"insufficient_funds","transaction":"","network":...,"payer":...}`. Status mapping: 402 means payment required or failed, 400 means an invalid payment, 500 means a server error.
- npm (official `x402-foundation/x402` monorepo, fetched from the registry), all at `2.27.0`, published 2026-09-22: `@x402/core`, `@x402/fetch`, `@x402/axios`, `@x402/express`, `@x402/next`, `@x402/hono`, `@x402/evm`, `@x402/svm`. Quickstart install: `npm install @x402/express @x402/core @x402/evm @x402/svm @x402/avm`.
- **Sui:**
  - A spec exists. The docs say "The `exact` scheme has network specifications for EVM, SVM, AVM, Stellar, Aptos, Casper, Hedera, TON, Cardano, Keeta, **Sui**, Concordium, NEAR, and XRPL." The spec is at https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_sui.md. Payload is `{"signature": "<base64 user sig>", "transaction": "<base64 Sui tx bytes>"}`. The example `accepted.network` is `"sui:mainnet"` and `asset` is `"0x2::sui::SUI"`. For verification, the facilitator simulates the transaction and checks that `payTo` receives `amount` of `asset`. For settlement, the facilitator broadcasts the transaction. Optional sponsorship goes through `extra.gasStation`.
  - **No official implementation.** The official TS packages directory has `mechanisms/{aptos,avm,cardano,casper,concordium,evm,hedera,keeta,near,stellar,svm,tvm,xrpl}`, with **no `sui`**. `@x402/sui` is not on npm. The CAIP-2 list on network-and-token-support also omits Sui.
  - **No public facilitator.** A live `GET https://x402.org/facilitator/supported` lists `eip155:84532`, `solana:EtWT...`, `algorand:...`, `aptos:2`, `stellar:testnet`, `hedera:testnet`, `xrpl:1`, `base-sepolia`, `solana-devnet`, with no Sui. A live `GET https://facilitator.payai.network/supported` shows 33 kinds, none of them Sui.
  - Third-party: npm `x402-sui@2.0.1`, maintainer `toony1908`, repo `github.com/tony1908/x402-sui`, depending on `@mysten/sui ^1.0.0`. It is **not** listed in the docs' Third-Party SDKs page. I did not review it.
  - **UNCONFIRMED:** the CAIP-2 string for Sui *testnet*. The spec only shows `sui:mainnet`.
  - Consequence: x402 settling on Sui means self-facilitation (implementing the spec's verify and settle yourself) or an unvetted third-party package. The EVM path is fully supported.

---

## 5. Intercepta / Web3 Antivirus

Sources: the reference pages at https://docs.web3antivirus.io/reference/quick-scan-address, `/scan-address`, `/scan-token` and `/scan-message`. Each page embeds its OpenAPI 3.0.0 definition, which is also served as markdown at `<page>.md`, e.g. https://docs.web3antivirus.io/reference/quick-scan-address.md. Readme lists the source definitions as `/branches/2.0/apis/address-scanning.json` and others, and `https://docs.web3antivirus.io/openapi.json` returns 404.

- **Example 200 bodies: none are published.** The OAS for all four endpoints has a `schema` but no response `example`/`examples`. The only `example` values are request parameters (`address: 0x0d775e010f0b6c32c9468d43ba599ef47d596e47`) and one field-level example (`riskScore: 70`). A GitHub repo search for `web3antivirus` returned 0 repos. A live unauthenticated `GET .../account/<addr>/quick-scan` returned `403 {"status":403,"response":"This authentication key is incorrect or doesn’t exist","errors":[{"field":"","message":"This authentication key is incorrect or doesn’t exist"}]}`.
- Server `https://api.web3antivirus.io`, auth header `X-API-KEY`.
- **Quick Scan Address**: `GET /api/public/v2/extension/account/{address}/quick-scan`. **Deep Scan Address**: `GET /api/public/v2/extension/account/{address}/toxic-score`. The address parameter's description is "**ETH address/ENS**", and there is no chainId parameter. Per the OAS, **both return the same schema, `ToxicScoreShortResponseV2`**:
  - `toxicScore: number` (required): "Evaluates and indicates the risk level of a wallet before interaction." **No min, max or range is documented.**
  - `traits: ToxicScoreTraitV2[]` (required), with fields:
    - `risk: number`: "Risk level of the trait", no range given.
    - `name: enum` of `known_scammer, initiator_scam_transactions, sanction_address_communication, suspicious_dex_pair_deployer, suspicious_deployer, attack_money_target, zero_address_risk, sanction_address, fake_phishing_transfer, non_kyc_transfers, mixer_transfers, fake_phishing_contract_communication, rug_pull, rug_pull_trader, blacklist`.
    - `txsCount: number`.
    - `description: string`.
- **Scan Token**: `GET /api/public/v2/extension/token-intelligence/token/{address}/risks?chainId=`. The `chainId` enum is `1868, 7777777, 1, 8453, 130, 146, 56, 137, 10, 42161, 480, 42220, 43114, 324, 81457, 59144, 999, 33139, solana, 57073`: **no Sui and no Sepolia**. The response is `TokenRiskAnalysisV2Response`, with required fields:
  - `apiVersion`, `saleTax`, `buyTax`.
  - `riskScore: number` ("**Risk percentage**", `example: 70`).
  - `riskLevel: enum neutral|low|medium|high`.
  - `category: enum malicious|restricted|suspicious|availability|sanctioned|unverified|info`.
  - `trust: enum whitelist|blocklist|neutral`.
  - `action: enum block|warn|info`.
  - `detectors: [{code, description}]`, where `code` includes `KNOWN_MALICIOUS, HONEYPOT, FAKE_TOKEN, SCAM_AIRDROP_TOKEN, SANCTIONED_TOKEN, HIGH_REPUTATION_TOKEN, ...` and 28 others.
  - `token: TokenDetails`.
- **Scan Message**: `POST /api/public/v2/extension/analysis/signature`.
  - Body `AnalyzeSignatureRequestDTO`: `from` (required), `message` (required, JSON string), `website`, and `chainId` from an EVM-only enum.
  - "Endpoint for analyzing **EIP-712** messages." `messageType` is one of `Permit, PermitSingle, PermitBatch, PermitForAll, PermitTransferFrom, PermitBatchTransferFrom`.
  - Response `SignatureAnalysisResponseDTO` has required fields `from`, `detectors[{code,description}]`, `riskGroup` (`Low|Medium|High`) and `addresses[{address,type,detectors[]}]`, plus optional `domain` and `assetsMovement.approve[]`.
  - A Sui x402 payment is not an EIP-712 message, so this endpoint cannot score it.
- Score scale, reporting only what the sources show:
  - Address `toxicScore`: numeric, range **UNCONFIRMED**.
  - Token `riskScore`: "percentage", which implies 0–100 but no bound is stated, with example 70.
  - Token `riskLevel`: bands `neutral/low/medium/high`.
  - Message `riskGroup`: bands `Low/Medium/High`.
  - Settling the `toxicScore` range needs one live keyed call. Until then, `riskToStakeMultiplierBps` must not assume a scale.
- The local file `docs/reference/intercepta-api-docs.md` is mostly x402 quickstart text and contains no Web3 Antivirus response examples.
- **Note added 2026-09-26 (later), after the build moved on; the findings above are unchanged.** Because the address endpoints take "ETH address/ENS", the build now screens the payee's *claimed EVM identity* (`VendorTruth.evmAddress`, claimed on the invoice), not the 32-byte Sui payout address. `parseScreeningSubject` still rejects Sui addresses, as before. The premise is `payment.payTo.traitCount lte 0` (any documented trait is a hard refuse), which uses the documented `traits[]` array and avoids the undocumented `toxicScore` range entirely; no score threshold is set anywhere. The spoofed invoice claims Lazarus Group `0x098b716b8aaf21512996dc57eb0615e2383e2f96` (OFAC SDN entry 27307, DPRK3, added 2022-04-14). What this assumes and has not yet confirmed: that Deep Scan returns at least one trait (e.g. `sanction_address`) for that address. No keyed call has been made yet; it needs `INTERCEPTA_API_KEY`, and the pinned test addresses from Intercepta's Discord are still not on hand. Scan Token and Scan Message are still not used for Sui, for the reasons above.

---

## 6. Sui USDSUI

- Live `POST https://graphql.testnet.sui.io/graphql`, query `{ chainIdentifier coinMetadata(coinType: "0x832f93729a8b1dfe9dd8067536dfa35231cf019f9401afe04a398df6d18c54cb::usdsui::USDSUI") { decimals name symbol description iconUrl supply address } }`, returned:
  ```json
  {"chainIdentifier":"69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
   "coinMetadata":{"decimals":6,"name":"USD Sui Stablecoin","symbol":"USDSUI",
     "description":"Stablecoin pegged 1:1 to USD, issued on the Sui network.","iconUrl":null,
     "supply":"43000000000","address":"0xba80769763779f3fb9d6fbea05e6a5eee5935932bb828b25c2cbb81bbd12657f"}}
  ```
  Total supply is 43,000 USDSUI at 6 decimals.
- Package `0x832f…54cb`, version 1, was published in tx `7EucJU3QQtm4TiqNLyHkgp7tHXeUSCLKeRE6u51yVYVc` by `0x916c7accd3308e4a8ec896b51b2a0bbcd510abff0579c059455b7e30d147f05a` at 2026-06-21T14:42:59Z. Its modules are `covenant` (a milestone-escrow app using `ArcaCap`/`ClientCap`, with `create_covenant` taking `Coin<USDSUI>`), `errors`, `proof`, `reputation` and `usdsui`. **The `usdsui` module has only a `PRIVATE init`, and no public mint or faucet function.**
- The TreasuryCap query (`objects(filter:{type:"0x2::coin::TreasuryCap<…::usdsui::USDSUI>"})`) returned object `0x9de96939…316b`, **owned by `AddressOwner` `0x916c7acc…f05a`**, which is the publisher.
- Conclusion: **not freely mintable and not a faucet coin.** Only the holder of `0x916c7acc…` can mint, using `0x2::coin::mint` with the TreasuryCap. It is a coin bundled inside a third-party package, not an official or Circle stablecoin.
- `docs/THREATMODEL.md` says it is "already held by the project's testnet address". **UNCONFIRMED here:** whether `0x916c7acc…` is the project's own address. I did not read keystores, per instructions. If it is not, the only USDSUI supply is whatever that address has already sent out.
- Related, for PRD Part O item 1: npm `@mysten/sui` latest is `2.33.1` (2026-09-25). Its exports include `./graphql`, `./grpc`, `./jsonRpc`, `./transactions`, `./faucet`, `./keypairs/ed25519`.

---

## PRD items this research contradicts or sharpens

These are stated plainly, per CLAUDE.md ("say so directly"). Nothing here has been acted on.

1. **Part E / F.0 (ENS "bond history in ENSIP-26")**: ENSIP-26 has only `agent-context` and `agent-endpoint[...]`. A bond-history key would be custom (see 2d).
2. **Part E / F.5 (EAC "scoped to specific text records")**: text-key grants cover **every name on that resolver instance**. Per-agent isolation needs one PermissionedResolver proxy per agent (see 2b).
3. **Part F.5 ("Deploy ENSv2 registry/resolver contracts on Sepolia")**: the protocol is already live on Sepolia. You deploy only proxies through the VerifiableFactory (see 2a).
4. **CLAUDE.md rule 3 / F.5 (Cloud Wallet as the oracle relayer)**: Cloud Wallet means **Azure Key Vault in the user's own Azure account, with a credit card or credits on file**. The free plan allows 1 cloud wallet. The alternative the docs name is to sign with a private key held elsewhere (build-a-backend "Seed phrases or private keys"), which would conflict with rule 3.
5. **Part G (x402 "HTTP 402 challenge/response shape")**: EVM is fully supported. For Sui there is a spec but **no official SDK mechanism and no public facilitator** (see 4).
6. **Part G / Part C (Intercepta on every transaction)**: address scans take "ETH address/ENS", Scan Token has no Sui chainId, and Scan Message is EIP-712 only. Intercepta cannot directly score a Sui address, a Sui coin type or a Sui payment. This matches the existing THREATMODEL entry.
7. **Part O item 2 (World "mocked-proof callback shape")**: there is no special mock callback. It is standard OIDC code + PKCE (or device grant) against the discovery doc, with fake identities through a sandbox World ID app. Callbacks must be **HTTPS**, so a localhost dev loop needs an HTTPS tunnel or a deployed URL.
8. **Part O item 4 (MultiBaas Sepolia)**: Ethereum Sepolia is GA with event indexing (live chains.json). The PRD's "confirm per-deployment" still applies, because the network is fixed at deployment creation.

---

## What the user must provision manually

Nothing below was done by this research. Each item needs a human, because it involves a login, a UI approval, a secret, or money.

**MultiBaas (Curvegrid)**
- [ ] Sign up at https://console.curvegrid.com/ with Google, GitHub, Microsoft, or email/password. No payment info is needed for the free plan.
- [ ] Click **New Deployment**, choose Network **Ethereum Sepolia (11155111)**, and pick a label (immutable). Note the deployment URL `https://<id>.multibaas.com`, which goes in `MULTIBAAS_DEPLOYMENT_URL`.
- [ ] Create an API key under **Admin → API Keys → New Key**. It is shown only once.
  - For a backend key that links contracts, creates webhooks, or signs Cloud Wallet transactions, choose the **Administrators** group.
  - For any browser-embedded key, create a separate **DApp User**-group key.
  - The backend key goes in `MULTIBAAS_API_KEY`.
- [ ] If the browser calls MultiBaas directly: under **CORS → Add Origin**, add `http://localhost:3000` and the production URL.
- [ ] Add the ENSv2 contract ABIs to **Contracts → Library** (PermissionedResolver and UserRegistry, from the `ensdomains/contracts-v2` Sepolia deployment JSONs). Then use **On-chain → Link Contract** for each proxy you deploy, with **sync events** enabled and a recent starting block. The free plan indexes at most 100 blocks back.
- [ ] Under **Blockchain → Webhooks → +**, add a label and a public **HTTPS** endpoint URL, and subscribe to `event.emitted` (and `transaction.included` if Cloud Wallet is used). Retrieve the webhook `secret` via `GET /api/v0/webhooks/{id}` or the console, and store it as `MULTIBAAS_WEBHOOK_SIGNING_SECRET`. The receiver must be reachable from the internet, so localhost needs a tunnel.
- [ ] **Decision needed (costs money or needs credits):** Cloud Wallet requires a Microsoft Azure account with billing set up (a credit card or unexpired credits).
  - Run the doc's PowerShell quickstart to create a service principal, resource group and Key Vault (Standard SKU; HSM needs Premium at extra cost).
  - Enter Client ID, Client Secret, Tenant ID, Subscription ID, Resource Group and Vault Name under **Cloud Wallets → Configuration**, then **Add Key → Create Key**.
  - Put the resulting address in `ORACLE_RELAYER_CLOUD_WALLET_ID`, and fund it with Sepolia ETH.
- [ ] Before Day 1 ends, make one live call to confirm the `/api/v0` base path. The docs disagree with themselves (v0 vs v1).

**ENSv2 (Sepolia)**
- [ ] A Sepolia EOA with Sepolia ETH for gas. This could be the Cloud Wallet, or a wallet the user controls.
- [ ] Mint test USDC to that address by calling `mint(address,uint256)` on `0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e`. It has no access control, and the call costs only gas.
- [ ] Register a parent `.eth` name on the Sepolia ETHRegistrar `0xabe76f6c…94ca`: approve USDC, `commit`, wait at least 60 s, `register`. Alternatively use the ENS App at https://app.ens.dev.
- [ ] Deploy a UserRegistry proxy and one PermissionedResolver proxy per agent through the VerifiableFactory `0x9e726eb5…41c`, then call `setSubregistry` on the parent. These are code steps, but they spend Sepolia ETH, so the signer must be funded.
- [ ] **Decision needed:** which text key carries bond history, since ENSIP-26 has none (see PRD mismatch 1).
- [ ] Sepolia RPC URL for `ENS_SEPOLIA_RPC_URL`. The public `https://ethereum-sepolia-rpc.publicnode.com` answered, or use a keyed provider.

**World ID for Agents (sandbox)**
- [ ] Sign in to https://sandbox.auth.world.org/portal with a Google account, and confirm it is not `account_not_eligible`. If it is, the event organizer must help.
- [ ] Register an OIDC client with:
  - an exact **HTTPS** callback URL (sandbox rejects `http://localhost`), so a deployed URL or HTTPS tunnel is needed first;
  - auth method `client_secret_basic` (default) or `client_secret_post`;
  - optionally a logo.
- [ ] Copy the client secret **the one time it is shown** into backend config (`WORLD_SANDBOX_CLIENT_SECRET`). Put the client ID in `WORLD_SANDBOX_CLIENT_ID`.
- [ ] Get and install the **sandbox World ID app** and complete its test proof-of-human flow on a phone. **UNCONFIRMED** where it is distributed; ask the organizers. Production World App credentials do not substitute.
- [ ] Optional: install the plugin with `claude plugin marketplace add worldcoin/world-id-agent-plugin` and `claude plugin install world-id-sandbox@world-id-demo`, then `claude mcp login plugin:world-id-sandbox:world-id-sandbox`.

**Intercepta / Web3 Antivirus**
- [ ] Obtain an API key (`X-API-KEY`) and store it as `INTERCEPTA_API_KEY`. The docs do not describe the signup path.
- [ ] With the key, make **one live call** each to quick-scan and toxic-score, and record the real 200 bodies in `FEEDBACK/`. This is the only way to learn the `toxicScore` range, which the docs do not publish.

**x402 on Sui**
- [ ] **Decision needed:** there is no official Sui x402 mechanism and no public Sui facilitator. Choose one of:
  - (a) self-facilitate by implementing `scheme_exact_sui.md`'s verify and settle in the seller;
  - (b) vet the third-party `x402-sui@2.0.1`;
  - (c) run the x402 leg on EVM (Base Sepolia via `https://x402.org/facilitator`) and keep only the bond on Sui.

**Sui**
- [ ] Confirm that the project's Sui testnet address is `0x916c7accd3308e4a8ec896b51b2a0bbcd510abff0579c059455b7e30d147f05a`, the USDSUI TreasuryCap holder. If it is not, secure enough USDSUI from that holder, or switch to a coin the project can mint. USDSUI is not freely mintable and has no faucet.
- [ ] Get testnet SUI for gas (`@mysten/sui` exposes `./faucet`). Set `SUI_RPC_URL` to a GraphQL endpoint such as `https://graphql.testnet.sui.io/graphql`, since public JSON-RPC is deprecated.
