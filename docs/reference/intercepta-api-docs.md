Get a free API key
https://intercepta.io/ethglobal
↗
x402 quickstart for buyers
https://docs.x402.org/getting-started/quickstart-for-buyers
↗
x402 quickstart for sellers
https://docs.x402.org/getting-started/quickstart-for-sellers
↗
Scan Message: check the payment authorization
https://docs.web3antivirus.io/reference/scan-message
↗
Quick Scan Address: fast check on payTo or payer
https://docs.web3antivirus.io/reference/quick-scan-address
↗
Deep Scan Address: sanctions, AML and scam exposure
https://docs.web3antivirus.io/reference/scan-address
↗
Scan Token: real USDC or a lookalike
https://docs.web3antivirus.io/reference/scan-token
↗


Getting Started
Quickstart for Buyers
This guide walks you through how to use x402 to interact with services that require payment. By the end of this guide, you will be able to programmatically discover payment requirements, complete a payment, and access a paid resource.

​
Prerequisites
Before you begin, ensure you have:
A crypto wallet with USDC (any EVM or SVM compatible wallet)
Node.js and npm, Go, or Python and pip
A service that requires payment via x402
Note
There are pre-configured examples available in the x402 repo, including examples for fetch, Axios, Go, and MCP.
​

1. Install Dependencies
   Node.js
   Go
   Python
   Install the x402 client packages:

# For fetch-based clients

npm install @x402/fetch @x402/evm

# For axios-based clients

npm install @x402/axios @x402/evm

# For Solana support, also add:

npm install @x402/svm

# For Algorand support, also add:

npm install @x402/avm

# For Aptos support, also add:

npm install @x402/aptos

# For Stellar support, also add:

npm install @x402/stellar

# For Keeta support, also add:

npm install @x402/keeta

# For Hedera support, also add:

npm install @x402/hedera

# For Concordium support, also add:

npm install @x402/concordium

# For TON (TVM) support, also add:

npm install @x402/tvm

# For NEAR support, also add:

npm install @x402/near

# For XRPL support, also add:

npm install @x402/xrpl
​ 2. Create a Wallet Signer
Node.js (viem)
Go
Python (eth-account)
Install the required package:
npm install viem
Then instantiate the wallet signer:
import { privateKeyToAccount } from "viem/accounts";

// Create a signer from private key (use environment variable)
const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
​
Solana (SVM)
Use SolanaKit to instantiate a signer:
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

// 64-byte base58 secret key (private + public)
const svmSigner = await createKeyPairSignerFromBytes(
base58.decode(process.env.SVM_PRIVATE_KEY!)
);
​
Aptos
Use the Aptos TypeScript SDK to instantiate a signer:
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

// Create account from private key
const privateKey = new Ed25519PrivateKey(process.env.APTOS_PRIVATE_KEY!);
const aptosSigner = Account.fromPrivateKey({ privateKey });
​
Algorand (AVM)
Use the @x402/avm package to instantiate a signer:
import { toClientAvmSigner } from "@x402/avm";

// Create signer from Base64-encoded private key (64-byte: seed + pubkey)
const avmSigner = toClientAvmSigner(process.env.AVM_PRIVATE_KEY!);
​
Stellar
Use the Stellar SDK to instantiate a signer:
import { createEd25519Signer } from "@x402/stellar";

// Create signer from private key (S... format)
const stellarSigner = createEd25519Signer(
process.env.STELLAR_PRIVATE_KEY!,
"stellar:testnet"
);
​
Keeta
Use the Keeta SDK to instantiate a signer:
import \* as KeetaNet from "@keetanetwork/keetanet-client";
import { toClientKeetaSigner } from "@x402/keeta";

// Derive account from mnemonic
const account = KeetaNet.lib.Account.fromSeed(
await KeetaNet.lib.Account.seedFromPassphrase(process.env.KEETA_MNEMONIC!),
0,
);
const keetaSigner = toClientKeetaSigner(account);
​
Hedera
Use @x402/hedera to instantiate a signer:
import { createClientHederaSigner } from "@x402/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";

const hederaSigner = createClientHederaSigner(
process.env.HEDERA_ACCOUNT_ID!,
PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY!),
{ network: "hedera:testnet" },
);
​
Concordium
Use @x402/concordium with the Concordium web SDK to instantiate a signer:
import { buildBasicAccountSigner, AccountAddress } from "@concordium/web-sdk";

const concordiumSigner = {
accountAddress: AccountAddress.fromBase58(process.env.CCD_ADDRESS!),
signer: buildBasicAccountSigner(process.env.CCD_PRIVATE_KEY!),
};
​
TON (TVM)
Use @x402/tvm to instantiate a signer:
import { toClientTvmSigner } from "@x402/tvm";
import { mnemonicToPrivateKey } from "@ton/crypto";

const keyPair = await mnemonicToPrivateKey(process.env.TVM_MNEMONIC!.split(" "));
const tvmSigner = toClientTvmSigner(keyPair, {
network: "tvm:-3",
apiKey: process.env.TONCENTER_API_KEY,
});
​
NEAR
Use @x402/near to instantiate a signer:
import { createClientNearSigner } from "@x402/near";

const nearSigner = createClientNearSigner({
accountId: "alice.testnet",
secretKey: process.env.NEAR_SECRET_KEY!, // ed25519:... full-access key
});
​
XRPL
Use @x402/xrpl to instantiate a signer:
import { Wallet } from "xrpl";
import { createXrplWalletSigner } from "@x402/xrpl";

const xrplSigner = createXrplWalletSigner(Wallet.fromSeed(process.env.XRPL_SEED!));
​ 3. Make Paid Requests Automatically
Fetch
Axios
Go
Python (httpx)
Python (requests)
@x402/fetch extends the native fetch API to handle 402 responses and payment headers for you. Full example here
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Create signer
const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);

// Create x402 client and register EVM scheme
const client = new x402Client();
client.register("eip155:\*", new ExactEvmScheme(signer));

// Wrap fetch with payment handling
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

// Make request - payment is handled automatically
const response = await fetchWithPayment("https://api.example.com/paid-endpoint", {
method: "GET",
});

// Parse the payment result (status, body, and decoded payment header)
const result = await httpClient.processResponse(response);
console.log("Response:", result.body);

if (result.paymentStatus === "settled") {
console.log("Payment settled:", result.header);
} else if (result.paymentStatus === "settle_failed") {
console.error("Settlement failed:", result.header);
}
​
Multi-Network Client Setup
You can register multiple payment schemes to handle different networks:
TypeScript
Go
Python
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

// Create signers
const evmSigner = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const svmSigner = await createKeyPairSignerFromBytes(
base58.decode(process.env.SVM_PRIVATE_KEY!)
);

// Create client with multiple schemes
const client = new x402Client();
client.register("eip155:_", new ExactEvmScheme(evmSigner));
client.register("solana:_", new ExactSvmScheme(svmSigner));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Now handles both EVM and Solana networks automatically!

// For Aptos support, also add:
import { ExactAptosScheme } from "@x402/aptos/exact/client";
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const aptosPrivateKey = new Ed25519PrivateKey(process.env.APTOS_PRIVATE_KEY!);
const aptosSigner = Account.fromPrivateKey({ privateKey: aptosPrivateKey });
client.register("aptos:\*", new ExactAptosScheme(aptosSigner));

// For Algorand support, also add:
import { ExactAvmScheme, toClientAvmSigner } from "@x402/avm";

const avmSigner = toClientAvmSigner(process.env.AVM_PRIVATE_KEY!);
client.register("algorand:\*", new ExactAvmScheme(avmSigner));

// For Stellar support, also add:
import { ExactStellarScheme, createEd25519Signer } from "@x402/stellar";

const stellarSigner = createEd25519Signer(
process.env.STELLAR_PRIVATE_KEY!,
"stellar:testnet"
);
client.register("stellar:\*", new ExactStellarScheme(stellarSigner));

// For Keeta support, also add:
import \* as KeetaNet from "@keetanetwork/keetanet-client";
import { ExactKeetaScheme, toClientKeetaSigner } from "@x402/keeta";

const keetaAccount = KeetaNet.lib.Account.fromSeed(
await KeetaNet.lib.Account.seedFromPassphrase(process.env.KEETA_MNEMONIC!),
0,
);
client.register("keeta:\*", new ExactKeetaScheme(toClientKeetaSigner(keetaAccount)));

// For Hedera support, also add:
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";

const hederaSigner = createClientHederaSigner(
process.env.HEDERA_ACCOUNT_ID!,
PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY!),
{ network: "hedera:testnet" },
);
client.register("hedera:\*", new ExactHederaScheme(hederaSigner));

// For Concordium support, also add:
import { ExactConcordiumScheme } from "@x402/concordium/exact/client";
import { buildBasicAccountSigner, AccountAddress } from "@concordium/web-sdk";

const concordiumSigner = {
accountAddress: AccountAddress.fromBase58(process.env.CCD_ADDRESS!),
signer: buildBasicAccountSigner(process.env.CCD_PRIVATE_KEY!),
};
client.register("ccd:\*", new ExactConcordiumScheme(concordiumSigner));

// For TON (TVM) support, also add:
import { ExactTvmScheme } from "@x402/tvm/exact/client";
import { toClientTvmSigner } from "@x402/tvm";
import { mnemonicToPrivateKey } from "@ton/crypto";

const tvmKeyPair = await mnemonicToPrivateKey(process.env.TVM_MNEMONIC!.split(" "));
client.register(
"tvm:\*",
new ExactTvmScheme(
toClientTvmSigner(tvmKeyPair, {
network: "tvm:-3",
apiKey: process.env.TONCENTER_API_KEY,
}),
),
);

// For NEAR support, also add:
import { ExactNearScheme, createClientNearSigner } from "@x402/near";

const nearSigner = createClientNearSigner({
accountId: "alice.testnet",
secretKey: process.env.NEAR_SECRET_KEY!, // ed25519:... full-access key
});
client.register("near:\*", new ExactNearScheme(nearSigner));

// For XRPL support, also add:
import { Wallet } from "xrpl";
import { createXrplWalletSigner } from "@x402/xrpl";
import { ExactXrplScheme } from "@x402/xrpl/exact/client";

const xrplSigner = createXrplWalletSigner(Wallet.fromSeed(process.env.XRPL_SEED!));
client.register("xrpl:\*", new ExactXrplScheme(xrplSigner));
​
Spend Controls
By default, the x402 client only pays recognized USD-pegged assets (e.g. USDC) and caps each payment at $1. You can adjust these limits when creating the client:
TypeScript
Go
Python
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const client = x402Client.fromConfig({
schemes: [
{ network: "eip155:*", client: new ExactEvmScheme(signer) },
],
spendControls: {
maxAmountPerPayment: "$5", // raise the USD cap (default: "$1")
allowedAssets: [
// opt into a non-default token with an atomic cap
{ network: "eip155:8453", asset: "0xCustomToken", maxAmountPerPayment: "2000000" },
],
},
});
Option TypeScript Go Python Description
Disable all controls spendControls: false client.DisableSpendControls() spend_controls=False Any asset, no caps.
maxAmountPerPayment / MaxAmountPerPayment / max_amount_per_payment "$1" default "$1" default "$1" default USD ceiling on recognized USD-pegged assets. Set to false/DisableMaxAmountPerPayment: true/False to remove the cap.
allowedAssets / AllowedAssets / allowed_assets list or true list or AllowAnyAsset: true list or True Opt into non-default tokens. Omit for default assets only; or a list of { network, asset } entries with an optional atomic per-payment cap.
Spend controls run before any custom policies and before the payment payload is signed. For interactive approval flows (e.g. prompting the user), use onBeforePaymentCreation hooks instead.
​
Payment Schemes
The examples above use the simplest fixed-price scheme. If a resource advertises a different scheme in its 402 response, register that scheme for the same network namespace:
exact: fixed-price payments.
upto: usage-based payments where you authorize a maximum and the seller charges actual usage.
batch-settlement: high-volume payments where the client deposits into escrow, signs off-chain vouchers, and the seller claims value onchain in batches.
​ 4. Discover Available Services (Optional)
Instead of hardcoding endpoints, you can use the x402 Bazaar to dynamically discover available services. This is especially powerful for building autonomous agents.
// Fetch available services from the Bazaar API
const response = await fetch(
"https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources"
// "https://facilitator.payai.network/discovery/resources" // Bazaar from another facilitator
);
const services = await response.json();

// Filter services by criteria
const affordableServices = services.items.filter((item) =>
item.accepts.some((req) => Number(req.amount) < 100000) // Under $0.10
);

console.log("Available services:", affordableServices);
Learn more about service discovery in the Bazaar documentation.
​ 5. Error Handling
Clients will throw errors if:
No scheme is registered for the required network
The request configuration is missing
A payment has already been attempted for the request
There is an error creating the payment header
Common error handling:
try {
const response = await fetchWithPayment(url, { method: "GET" });
// Handle success
} catch (error) {
if (error.message.includes("No scheme registered")) {
console.error("Network not supported - register the appropriate scheme");
} else if (error.message.includes("Payment already attempted")) {
console.error("Payment failed on retry");
} else {
console.error("Request failed:", error);
}
}
​
Summary
Install x402 client packages (@x402/fetch or @x402/axios) and mechanism packages (@x402/evm, @x402/svm, @x402/tvm, @x402/aptos, @x402/keeta, @x402/near, @x402/xrpl)
Create a wallet signer
Create an x402Client and register payment schemes (exact for fixed-price, upto for usage-based billing, batch-settlement for batched EVM micropayments when the server advertises it)
Use the provided wrapper/interceptor to make paid API requests
(Optional) Use the x402 Bazaar to discover services dynamically
Payment flows are handled automatically for you — including upto where you only pay the actual usage
Next Steps:
Explore Advanced Concepts like lifecycle hooks for custom logic before/after verification/settlement
Explore Extensions like Bazaar for service discovery
References:
@x402/fetch on npm
@x402/axios on npm
@x402/evm on npm
x402 Go module
For questions or support, join our Slack.

> ## Documentation Index
>
> Fetch the complete documentation index at: https://docs.x402.org/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart for Sellers

> This guide walks you through integrating with **x402** to enable payments for your API or service. By the end, your API will be able to charge buyers and AI agents for access.

**Note:** This quickstart begins with testnet configuration for safe testing. When you're ready for production, see [Running on Mainnet](#running-on-mainnet) for the simple changes needed to accept real payments on Base (EVM) and Solana networks.

### Prerequisites

Before you begin, ensure you have:

- A crypto wallet to receive funds (any EVM or SVM compatible wallet)
- [Node.js](https://nodejs.org/en) and npm, [Go](https://go.dev/), or Python and pip installed
- An existing API or server

**Note**\
There are pre-configured examples available in the x402 repo for both [Node.js](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers) and [Go](https://github.com/x402-foundation/x402/tree/main/examples/go/servers). There is also an [advanced example](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/advanced) that shows how to use the x402 SDKs to build a more complex payment flow.

### 1. Install Dependencies

<Tabs>
  <Tab title="Express">
    Install the [x402 Express middleware package](https://www.npmjs.com/package/@x402/express).

    ```bash theme={null}
    npm install @x402/express @x402/core @x402/evm @x402/svm @x402/avm
    ```

  </Tab>

  <Tab title="Next.js">
    Install the [x402 Next.js middleware package](https://www.npmjs.com/package/@x402/next).

    ```bash theme={null}
    npm install @x402/next @x402/core @x402/evm @x402/svm @x402/avm
    ```

  </Tab>

  <Tab title="Hono">
    Install the [x402 Hono middleware package](https://www.npmjs.com/package/@x402/hono).

    ```bash theme={null}
    npm install @x402/hono @x402/core @x402/evm @x402/svm @x402/avm
    ```

  </Tab>

  <Tab title="Fastify">
    Install the [x402 Fastify middleware package](https://www.npmjs.com/package/@x402/fastify).

    ```bash theme={null}
    npm install @x402/fastify @x402/core @x402/evm @x402/svm @x402/avm
    ```

  </Tab>

  <Tab title="Go (Gin)">
    Add the x402 Go module to your project:

    ```bash theme={null}
    go get github.com/x402-foundation/x402/go/v2
    ```

  </Tab>

  <Tab title="Go (Echo)">
    Add the x402 Go module to your project:

    ```bash theme={null}
    go get github.com/x402-foundation/x402/go/v2
    ```

  </Tab>

  <Tab title="FastAPI">
    [Install the x402 Python package](https://pypi.org/project/x402/) with FastAPI support:

    ```bash theme={null}
    pip install "x402[fastapi]"

    # For Solana support, also add:
    pip install "x402[svm]"
    ```

  </Tab>

  <Tab title="Flask">
    [Install the x402 Python package](https://pypi.org/project/x402/) with Flask support:

    ```bash theme={null}
    pip install "x402[flask]"

    # For Solana support, also add:
    pip install "x402[svm]"
    ```

  </Tab>
</Tabs>

### 2. Add Payment Middleware

Integrate the payment middleware into your application. You will need to provide:

- The Facilitator URL or facilitator client. For testing, use `https://x402.org/facilitator` which works on Base Sepolia and Solana devnet.
  - For mainnet setup, see [Running on Mainnet](#running-on-mainnet)
- The routes you want to protect.
- Your receiving wallet address.

<Tabs>
  <Tab title="Express">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/express).

    ```typescript theme={null}
    import express from "express";
    import { paymentMiddleware, x402ResourceServer } from "@x402/express";
    import { ExactEvmScheme } from "@x402/evm/exact/server";
    import { ExactSvmScheme } from "@x402/svm/exact/server";
    import { ExactAvmScheme } from "@x402/avm/exact/server";
    import { HTTPFacilitatorClient } from "@x402/core/server";

    const app = express();

    // Your receiving wallet addresses
    const evmAddress = "0xYourEvmAddress";
    const svmAddress = "YourSolanaAddress";
    const avmAddress = "YourAlgorandAddress";

    // Create facilitator client (testnet)
    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator"
    });

    app.use(
      paymentMiddleware(
        {
          "GET /weather": {
            accepts: [
              {
                scheme: "exact",
                price: "$0.001",
                network: "eip155:84532", // Base Sepolia
                payTo: evmAddress,
              },
              {
                scheme: "exact",
                price: "$0.001",
                network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Solana Devnet
                payTo: svmAddress,
              },
              {
                scheme: "exact",
                price: "$0.001",
                network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe", // Algorand Testnet
                payTo: avmAddress,
              },
            ],
            description: "Weather data",
            mimeType: "application/json",
          },
        },
        new x402ResourceServer(facilitatorClient)
          .register("eip155:84532", new ExactEvmScheme())
          .register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", new ExactSvmScheme())
          .register("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe", new ExactAvmScheme()),
      ),
    );

    app.get("/weather", (req, res) => {
      res.send({
        report: {
          weather: "sunny",
          temperature: 70,
        },
      });
    });

    app.listen(4021, () => {
      console.log(`Server listening at http://localhost:4021`);
    });
    ```

  </Tab>

  <Tab title="Next.js">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/typescript/fullstack/next).

    Next.js offers two approaches: `paymentProxy` for protecting page routes (or multiple routes at once), and `withX402` for wrapping individual API route handlers. The key difference is that `withX402` only settles payment after a successful response (status \< 400), making it the recommended approach for API routes.

    **Option A: `paymentProxy`** — best for page routes or protecting multiple routes with a single config:

    ```typescript theme={null}
    // proxy.ts
    import { paymentProxy } from "@x402/next";
    import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
    import { ExactEvmScheme } from "@x402/evm/exact/server";
    import { ExactSvmScheme } from "@x402/svm/exact/server";

    export const evmAddress = "0xYourEvmAddress";
    export const svmAddress = "YourSolanaAddress";

    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator"
    });

    export const server = new x402ResourceServer(facilitatorClient);
    server.register("eip155:*", new ExactEvmScheme());
    server.register("solana:*", new ExactSvmScheme());

    export const proxy = paymentProxy(
      {
        "/protected": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.001",
              network: "eip155:84532", // Base Sepolia
              payTo: evmAddress,
            },
            {
              scheme: "exact",
              price: "$0.001",
              network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Solana Devnet
              payTo: svmAddress,
            },
          ],
          description: "Premium content",
          mimeType: "text/html",
        },
      },
      server,
    );

    export const config = {
      matcher: ["/protected/:path*"],
    };
    ```

    **Option B: `withX402`** — recommended for API routes, settles payment only after a successful response:

    ```typescript theme={null}
    // app/api/weather/route.ts
    import { NextRequest, NextResponse } from "next/server";
    import { withX402 } from "@x402/next";
    import { server, evmAddress, svmAddress } from "../../../proxy";

    const handler = async (_: NextRequest) => {
      return NextResponse.json(
        {
          report: {
            weather: "sunny",
            temperature: 72,
          },
        },
        { status: 200 },
      );
    };

    export const GET = withX402(
      handler,
      {
        "/api/weather": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.001",
              network: "eip155:84532", // Base Sepolia
              payTo: evmAddress,
            },
            {
              scheme: "exact",
              price: "$0.001",
              network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Solana Devnet
              payTo: svmAddress,
            },
          ],
          description: "Access to weather API",
          mimeType: "application/json",
        },
      },
      server,
    );
    ```

    The second argument to `withX402` is a `RoutesConfig`. Key the config by the route's path pattern (e.g. `{ "/api/weather": config }`) so that Bazaar discovery indexes the resource with the correct path. The pattern must match the request path exactly as served (including any `basePath`). If the pattern does not match, the handler runs without payment protection and a warning is logged once.

  </Tab>

  <Tab title="Hono">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/hono).

    ```typescript theme={null}
    import { Hono } from "hono";
    import { serve } from "@hono/node-server";
    import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
    import { ExactEvmScheme } from "@x402/evm/exact/server";
    import { ExactSvmScheme } from "@x402/svm/exact/server";
    import { HTTPFacilitatorClient } from "@x402/core/server";

    const app = new Hono();
    const evmAddress = "0xYourEvmAddress";
    const svmAddress = "YourSolanaAddress";

    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator"
    });

    app.use(
      paymentMiddleware(
        {
          "GET /weather": {
            accepts: [
              {
                scheme: "exact",
                price: "$0.001",
                network: "eip155:84532", // Base Sepolia
                payTo: evmAddress,
              },
              {
                scheme: "exact",
                price: "$0.001",
                network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Solana Devnet
                payTo: svmAddress,
              },
            ],
            description: "Weather data",
            mimeType: "application/json",
          },
        },
        new x402ResourceServer(facilitatorClient)
          .register("eip155:84532", new ExactEvmScheme())
          .register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", new ExactSvmScheme()),
      ),
    );

    app.get("/weather", (c) => {
      return c.json({
        report: {
          weather: "sunny",
          temperature: 70,
        },
      });
    });

    serve({ fetch: app.fetch, port: 4021 });
    ```

  </Tab>

  <Tab title="Fastify">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/fastify).

    ```typescript theme={null}
    import Fastify from "fastify";
    import { paymentMiddleware, x402ResourceServer } from "@x402/fastify";
    import { ExactEvmScheme } from "@x402/evm/exact/server";
    import { ExactSvmScheme } from "@x402/svm/exact/server";
    import { HTTPFacilitatorClient } from "@x402/core/server";

    const app = Fastify();
    const evmAddress = "0xYourEvmAddress";
    const svmAddress = "YourSolanaAddress";

    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator"
    });

    paymentMiddleware(
      app,
      {
        "GET /weather": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.001",
              network: "eip155:84532", // Base Sepolia
              payTo: evmAddress,
            },
            {
              scheme: "exact",
              price: "$0.001",
              network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Solana Devnet
              payTo: svmAddress,
            },
          ],
          description: "Weather data",
          mimeType: "application/json",
        },
      },
      new x402ResourceServer(facilitatorClient)
        .register("eip155:84532", new ExactEvmScheme())
        .register("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", new ExactSvmScheme()),
    );

    app.get("/weather", async () => {
      return {
        report: {
          weather: "sunny",
          temperature: 70,
        },
      };
    });

    app.listen({ port: 4021 });
    ```

  </Tab>

  <Tab title="Go (Gin)">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/go/servers/gin).

    ```go theme={null}
    package main

    import (
        "net/http"
        "time"

        x402 "github.com/x402-foundation/x402/go/v2"
        x402http "github.com/x402-foundation/x402/go/v2/http"
        ginmw "github.com/x402-foundation/x402/go/v2/http/gin"
        evm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
        svm "github.com/x402-foundation/x402/go/v2/mechanisms/svm/exact/server"
        "github.com/gin-gonic/gin"
    )

    func main() {
        evmAddress := "0xYourEvmAddress"
        svmAddress := "YourSolanaAddress"
        evmNetwork := x402.Network("eip155:84532")                              // Base Sepolia
        svmNetwork := x402.Network("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")  // Solana Devnet

        r := gin.Default()

        // Create facilitator client
        facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
            URL: "https://x402.org/facilitator",
        })

        // Apply x402 payment middleware
        r.Use(ginmw.X402Payment(ginmw.Config{
            Routes: x402http.RoutesConfig{
                "GET /weather": {
                    Accepts: x402http.PaymentOptions{
                        {
                            Scheme:  "exact",
                            Price:   "$0.001",
                            Network: "eip155:84532",
                            PayTo:   evmAddress,
                        },
                        {
                            Scheme:  "exact",
                            Price:   "$0.001",
                            Network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                            PayTo:   svmAddress,
                        },
                    },
                    Description: "Get weather data for a city",
                    MimeType:    "application/json",
                },
            },
            Facilitator: facilitatorClient,
            Schemes: []ginmw.SchemeConfig{
                {Network: evmNetwork, Server: evm.NewExactEvmScheme()},
                {Network: svmNetwork, Server: svm.NewExactSvmScheme()},
            },
            Timeout: 30 * time.Second,
        }))

        // Protected endpoint
        r.GET("/weather", func(c *gin.Context) {
            c.JSON(http.StatusOK, gin.H{
                "weather":     "sunny",
                "temperature": 70,
            })
        })

        r.Run(":4021")
    }
    ```

  </Tab>

  <Tab title="Go (net/http)">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/go/servers/nethttp).

    ```go theme={null}
    package main

    import (
        "encoding/json"
        "net/http"
        "time"

        x402 "github.com/x402-foundation/x402/go/v2"
        x402http "github.com/x402-foundation/x402/go/v2/http"
        nethttpmw "github.com/x402-foundation/x402/go/v2/http/nethttp"
        evm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
        svm "github.com/x402-foundation/x402/go/v2/mechanisms/svm/exact/server"
    )

    func main() {
        evmAddress := "0xYourEvmAddress"
        svmAddress := "YourSolanaAddress"
        evmNetwork := x402.Network("eip155:84532")                              // Base Sepolia
        svmNetwork := x402.Network("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")  // Solana Devnet

        // Create facilitator client
        facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
            URL: "https://x402.org/facilitator",
        })

        // Configure routes
        routes := x402http.RoutesConfig{
            "GET /weather": {
                Accepts: x402http.PaymentOptions{
                    {
                        Scheme:  "exact",
                        Price:   "$0.001",
                        Network: "eip155:84532",
                        PayTo:   evmAddress,
                    },
                    {
                        Scheme:  "exact",
                        Price:   "$0.001",
                        Network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                        PayTo:   svmAddress,
                    },
                },
                Description: "Get weather data for a city",
                MimeType:    "application/json",
            },
        }

        // Create ServeMux and register handlers
        mux := http.NewServeMux()

        // Protected endpoint
        mux.HandleFunc("GET /weather", func(w http.ResponseWriter, r *http.Request) {
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusOK)
            json.NewEncoder(w).Encode(map[string]interface{}{
                "weather":     "sunny",
                "temperature": 70,
            })
        })

        // Apply x402 payment middleware
        handler := nethttpmw.X402Payment(nethttpmw.Config{
            Routes:      routes,
            Facilitator: facilitatorClient,
            Schemes: []nethttpmw.SchemeConfig{
                {Network: evmNetwork, Server: evm.NewExactEvmScheme()},
                {Network: svmNetwork, Server: svm.NewExactSvmScheme()},
            },
            Timeout: 30 * time.Second,
        })(mux)

        http.ListenAndServe(":4021", handler)
    }
    ```

  </Tab>

  <Tab title="Go (Echo)">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/go/servers/echo).

    ```go theme={null}
    package main

    import (
        "net/http"
        "time"

        x402 "github.com/x402-foundation/x402/go/v2"
        x402http "github.com/x402-foundation/x402/go/v2/http"
        echomw "github.com/x402-foundation/x402/go/v2/http/echo"
        evm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
        svm "github.com/x402-foundation/x402/go/v2/mechanisms/svm/exact/server"
        "github.com/labstack/echo/v4"
    )

    func main() {
        evmAddress := "0xYourEvmAddress"
        svmAddress := "YourSolanaAddress"
        evmNetwork := x402.Network("eip155:84532")                              // Base Sepolia
        svmNetwork := x402.Network("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")  // Solana Devnet

        e := echo.New()

        // Create facilitator client
        facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
            URL: "https://x402.org/facilitator",
        })

        // Apply x402 payment middleware
        e.Use(echomw.X402Payment(echomw.Config{
            Routes: x402http.RoutesConfig{
                "GET /weather": {
                    Accepts: x402http.PaymentOptions{
                        {
                            Scheme:  "exact",
                            Price:   "$0.001",
                            Network: "eip155:84532",
                            PayTo:   evmAddress,
                        },
                        {
                            Scheme:  "exact",
                            Price:   "$0.001",
                            Network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                            PayTo:   svmAddress,
                        },
                    },
                    Description: "Get weather data for a city",
                    MimeType:    "application/json",
                },
            },
            Facilitator: facilitatorClient,
            Schemes: []echomw.SchemeConfig{
                {Network: evmNetwork, Server: evm.NewExactEvmScheme()},
                {Network: svmNetwork, Server: svm.NewExactSvmScheme()},
            },
            Timeout: 30 * time.Second,
        }))

        // Protected endpoint
        e.GET("/weather", func(c echo.Context) error {
            return c.JSON(http.StatusOK, map[string]interface{}{
                "weather":     "sunny",
                "temperature": 70,
            })
        })

        e.Start(":4021")
    }
    ```

  </Tab>

  <Tab title="FastAPI">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/python/servers/fastapi).

    ```python theme={null}
    from typing import Any

    from fastapi import FastAPI

    from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
    from x402.http.middleware.fastapi import PaymentMiddlewareASGI
    from x402.http.types import RouteConfig
    from x402.mechanisms.evm.exact import ExactEvmServerScheme
    from x402.mechanisms.svm.exact import ExactSvmServerScheme
    from x402.schemas import Network
    from x402.server import x402ResourceServer

    app = FastAPI()

    # Your receiving wallet addresses
    evm_address = "0xYourEvmAddress"
    svm_address = "YourSolanaAddress"
    EVM_NETWORK: Network = "eip155:84532"  # Base Sepolia
    SVM_NETWORK: Network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"  # Solana Devnet

    # Create facilitator client (testnet)
    facilitator = HTTPFacilitatorClient(
        FacilitatorConfig(url="https://x402.org/facilitator")
    )

    # Create resource server and register schemes
    server = x402ResourceServer(facilitator)
    server.register(EVM_NETWORK, ExactEvmServerScheme())
    server.register(SVM_NETWORK, ExactSvmServerScheme())

    # Define protected routes
    routes: dict[str, RouteConfig] = {
        "GET /weather": RouteConfig(
            accepts=[
                PaymentOption(
                    scheme="exact",
                    pay_to=evm_address,
                    price="$0.001",
                    network=EVM_NETWORK,
                ),
                PaymentOption(
                    scheme="exact",
                    pay_to=svm_address,
                    price="$0.001",
                    network=SVM_NETWORK,
                ),
            ],
            mime_type="application/json",
            description="Weather report",
        ),
    }

    # Add payment middleware
    app.add_middleware(PaymentMiddlewareASGI, routes=routes, server=server)


    @app.get("/weather")
    async def get_weather() -> dict[str, Any]:
        return {
            "report": {
                "weather": "sunny",
                "temperature": 70,
            }
        }


    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=4021)
    ```

  </Tab>

  <Tab title="Flask">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/python/servers/flask).

    ```python theme={null}
    from flask import Flask, jsonify

    from x402.http import FacilitatorConfig, HTTPFacilitatorClientSync, PaymentOption
    from x402.http.middleware.flask import payment_middleware
    from x402.http.types import RouteConfig
    from x402.mechanisms.evm.exact import ExactEvmServerScheme
    from x402.mechanisms.svm.exact import ExactSvmServerScheme
    from x402.schemas import Network
    from x402.server import x402ResourceServerSync

    app = Flask(__name__)

    # Your receiving wallet addresses
    evm_address = "0xYourEvmAddress"
    svm_address = "YourSolanaAddress"
    EVM_NETWORK: Network = "eip155:84532"  # Base Sepolia
    SVM_NETWORK: Network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"  # Solana Devnet

    facilitator = HTTPFacilitatorClientSync(
        FacilitatorConfig(url="https://x402.org/facilitator")
    )

    server = x402ResourceServerSync(facilitator)
    server.register(EVM_NETWORK, ExactEvmServerScheme())
    server.register(SVM_NETWORK, ExactSvmServerScheme())

    routes: dict[str, RouteConfig] = {
        "GET /weather": RouteConfig(
            accepts=[
                PaymentOption(
                    scheme="exact",
                    pay_to=evm_address,
                    price="$0.001",
                    network=EVM_NETWORK,
                ),
                PaymentOption(
                    scheme="exact",
                    pay_to=svm_address,
                    price="$0.001",
                    network=SVM_NETWORK,
                ),
            ],
            mime_type="application/json",
            description="Weather report",
        ),
    }

    payment_middleware(app, routes=routes, server=server)


    @app.route("/weather")
    def get_weather():
        return jsonify({
            "report": {
                "weather": "sunny",
                "temperature": 70,
            }
        })


    if __name__ == "__main__":
        app.run(host="0.0.0.0", port=4021)
    ```

  </Tab>
</Tabs>

**Route Configuration Interface:**

```typescript theme={null}
interface RouteConfig {
  accepts: Array<{
    scheme: string; // Payment scheme: "exact", "upto", or "batch-settlement"
    price: string; // For "exact": the fixed price. For "upto" / "batch-settlement": the per-request maximum authorized amount.
    network: string; // Network in CAIP-2 format (e.g., "eip155:84532" or "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")
    payTo: string; // Your wallet address
  }>;
  description?: string; // Description of the resource
  mimeType?: string; // MIME type of the response
  extensions?: object; // Optional extensions (e.g., Bazaar)
}
```

When a request is made to these routes without payment, your server will respond with the HTTP 402 Payment Required code and payment instructions.

### Payment Schemes: Exact, Upto, and Batch Settlement

x402 supports several payment schemes that control how charges are calculated:

**`exact`** (default) — The client pays the exact advertised price. This is the simplest scheme and works on all supported networks — see [Networks & Token Support](/core-concepts/network-and-token-support). TypeScript supports every network; Go and Python support a subset — see [SDK Features](/sdk-features). Best for fixed-price endpoints where the cost is known upfront.

**`upto`** — The client authorizes a **maximum** amount, but the server settles **only what was actually used**. This enables usage-based billing where the final charge depends on work performed (LLM token count, compute time, bytes served, etc.). Available on EVM networks (Permit2) in TypeScript, Go, and Python SDKs, and on Solana (SVM) in TypeScript and Go SDKs.

**`batch-settlement`** — For high-frequency or repeated micropayment traffic, the buyer funds a channel once, signs off-chain vouchers per request, and the seller settles onchain in batches (not every request). Each call still advertises a per-request maximum (`price`); you can charge actual usage up to that cap using the same **`setSettlementOverrides`** pattern as `upto`. See **[Batch settlement](/schemes/batch-settlement)** and the [Payment Schemes overview](/schemes/overview).

The examples in step 2 above all use the `exact` scheme. To use `upto` instead, there are two key differences:

1. Set `scheme: "upto"` in your route config, where `price` becomes the **maximum** the client authorizes
2. Call `setSettlementOverrides` in your handler to specify the **actual** amount to charge

<Tabs>
  <Tab title="Express">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/upto).

    ```typescript theme={null}
    import express from "express";
    import { paymentMiddleware, setSettlementOverrides, x402ResourceServer } from "@x402/express";
    import { UptoEvmScheme } from "@x402/evm/upto/server";
    import { HTTPFacilitatorClient } from "@x402/core/server";

    const app = express();
    const evmAddress = "0xYourEvmAddress";

    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator"
    });

    const maxPrice = "$0.10"; // Maximum the client authorizes (10 cents)

    app.use(
      paymentMiddleware(
        {
          "GET /api/generate": {
            accepts: {
              scheme: "upto",
              price: maxPrice,
              network: "eip155:84532", // Base Sepolia
              payTo: evmAddress,
            },
            description: "AI text generation — billed by token usage",
            mimeType: "application/json",
          },
        },
        new x402ResourceServer(facilitatorClient)
          .register("eip155:84532", new UptoEvmScheme()),
      ),
    );

    app.get("/api/generate", (req, res) => {
      // Simulate variable-cost work (LLM tokens, compute time, etc.)
      const maxAmountAtomic = 100000; // 10 cents in 6-decimal USDC atomic units
      const actualUsage = Math.floor(Math.random() * (maxAmountAtomic + 1));

      // Settle only the actual usage — the client is never charged more than this
      setSettlementOverrides(res, { amount: String(actualUsage) });

      res.json({
        result: "Here is your generated text...",
        usage: {
          authorizedMaxAtomic: String(maxAmountAtomic),
          actualChargedAtomic: String(actualUsage),
        },
      });
    });

    app.listen(4021, () => {
      console.log("Server listening at http://localhost:4021");
    });
    ```

  </Tab>

  <Tab title="Go (Gin)">
    Full example in the repo [here](https://github.com/x402-foundation/x402/tree/main/examples/go/servers/upto).

    ```go theme={null}
    package main

    import (
        "fmt"
        "math/rand"
        "net/http"
        "time"

        x402 "github.com/x402-foundation/x402/go/v2"
        x402http "github.com/x402-foundation/x402/go/v2/http"
        ginmw "github.com/x402-foundation/x402/go/v2/http/gin"
        uptoevm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/upto/server"
        "github.com/gin-gonic/gin"
    )

    func main() {
        evmAddress := "0xYourEvmAddress"
        evmNetwork := x402.Network("eip155:84532") // Base Sepolia

        r := gin.Default()

        facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
            URL: "https://x402.org/facilitator",
        })

        maxPrice := "$0.10" // Maximum the client authorizes

        r.Use(ginmw.X402Payment(ginmw.Config{
            Routes: x402http.RoutesConfig{
                "GET /api/generate": {
                    Accepts: x402http.PaymentOptions{
                        {
                            Scheme:  "upto",
                            Price:   maxPrice,
                            Network: evmNetwork,
                            PayTo:   evmAddress,
                        },
                    },
                    Description: "AI text generation - billed by token usage",
                    MimeType:    "application/json",
                },
            },
            Facilitator: facilitatorClient,
            Schemes: []ginmw.SchemeConfig{
                {Network: evmNetwork, Server: uptoevm.NewUptoEvmScheme()},
            },
            Timeout: 30 * time.Second,
        }))

        r.GET("/api/generate", func(c *gin.Context) {
            // Simulate variable-cost work (LLM tokens, compute time, etc.)
            maxAmountAtomic := 100000 // 10 cents in 6-decimal USDC atomic units
            actualUsage := rand.Intn(maxAmountAtomic + 1)

            // Settle only the actual usage
            ginmw.SetSettlementOverrides(c, &x402.SettlementOverrides{
                Amount: fmt.Sprintf("%d", actualUsage),
            })

            c.JSON(http.StatusOK, gin.H{
                "result": "Here is your generated text...",
                "usage": gin.H{
                    "authorizedMaxAtomic": fmt.Sprintf("%d", maxAmountAtomic),
                    "actualChargedAtomic": fmt.Sprintf("%d", actualUsage),
                },
            })
        })

        r.Run(":4021")
    }
    ```

  </Tab>

  <Tab title="FastAPI">
    ```python theme={null}
    import random
    from typing import Any

    from fastapi import FastAPI
    from starlette.responses import Response

    from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
    from x402.http.middleware.fastapi import PaymentMiddlewareASGI, set_settlement_overrides
    from x402.http.types import RouteConfig
    from x402.mechanisms.evm.upto import UptoEvmServerScheme
    from x402.schemas import Network
    from x402.server import x402ResourceServer

    app = FastAPI()

    evm_address = "0xYourEvmAddress"
    EVM_NETWORK: Network = "eip155:84532"  # Base Sepolia

    facilitator = HTTPFacilitatorClient(
        FacilitatorConfig(url="https://x402.org/facilitator")
    )

    server = x402ResourceServer(facilitator)
    server.register(EVM_NETWORK, UptoEvmServerScheme())

    max_price = "$0.10"  # Maximum the client authorizes (10 cents)

    routes: dict[str, RouteConfig] = {
        "GET /api/generate": RouteConfig(
            accepts=[
                PaymentOption(
                    scheme="upto",
                    pay_to=evm_address,
                    price=max_price,
                    network=EVM_NETWORK,
                ),
            ],
            mime_type="application/json",
            description="AI text generation — billed by token usage",
        ),
    }

    app.add_middleware(PaymentMiddlewareASGI, routes=routes, server=server)


    @app.get("/api/generate")
    async def generate(response: Response) -> dict[str, Any]:
        # Simulate variable-cost work (LLM tokens, compute time, etc.)
        max_amount_atomic = 100000  # 10 cents in 6-decimal USDC atomic units
        actual_usage = random.randint(0, max_amount_atomic)

        # Settle only the actual usage — the client is never charged more than this
        set_settlement_overrides(response, {"amount": str(actual_usage)})

        return {
            "result": "Here is your generated text...",
            "usage": {
                "authorizedMaxAtomic": str(max_amount_atomic),
                "actualChargedAtomic": str(actual_usage),
            },
        }


    if __name__ == "__main__":
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=4021)
    ```

  </Tab>
</Tabs>

The `setSettlementOverrides` amount supports three formats:

- **Raw atomic units** — e.g., `"1000"` settles exactly 1,000 atomic units of the token (for USDC with 6 decimals, `"1000"` = \$0.001)
- **Percentage of authorized maximum** — e.g., `"50%"` settles 50% of `PaymentRequirements.amount`. Supports up to two decimal places (e.g., `"33.33%"`). The result is floored to the nearest atomic unit.
- **Dollar price** — e.g., `"$0.05"` converts a USD-denominated price to atomic units. This format works when you configured your route with `$`-prefixed pricing (e.g., `price: "$0.10"`). Token decimals are determined from the registered scheme. The result is rounded to the nearest atomic unit.

The resolved amount must always be \<= the authorized maximum. If the amount is `"0"`, no onchain transaction occurs and the client is not charged.

### 3. Test Your Integration

To verify:

1. Make a request to your endpoint (e.g., `curl http://localhost:4021/weather`).
2. The server responds with a 402 Payment Required, including payment instructions in the `PAYMENT-REQUIRED` header.
3. Complete the payment using a compatible client, wallet, or automated agent. This typically involves signing a payment payload, which is handled by the client SDK detailed in the [Quickstart for Buyers](/getting-started/quickstart-for-buyers).
4. Retry the request, this time including the `PAYMENT-SIGNATURE` header containing the cryptographic proof of payment.
5. The server verifies the payment via the facilitator and, if valid, returns your actual API response (e.g., `{ "data": "Your paid API response." }`).

### 4. Enhance Discovery with Metadata (Recommended)

When using a facilitator that supports the Bazaar extension, your endpoints can be listed in the [x402 Bazaar](/extensions/bazaar), the discovery layer that helps buyers and AI agents find services.

**For HTTP endpoints**, add the discovery extension to your route config:

```typescript theme={null}
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

{
  "GET /weather": {
    accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:8453", payTo: "0xYourAddress" }],
    description: "Get real-time weather data including temperature, conditions, and humidity",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { city: "San Francisco" },
        inputSchema: {
          properties: { city: { type: "string", description: "City name" } },
          required: ["city"],
        },
      }),
    },
  },
}
```

**For MCP tools**, pass the discovery extension in your payment wrapper config:

```typescript theme={null}
import { createPaymentWrapper } from "@x402/mcp";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  resource: {
    url: "mcp://tool/get_weather",
    description: "Get current weather for a city",
  },
  extensions: declareDiscoveryExtension({
    toolName: "get_weather",
    description: "Get current weather for a city",
    transport: "sse",
    inputSchema: {
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  }),
});
```

Learn more about the discovery layer in the [Bazaar documentation](/extensions/bazaar).

### 5. Error Handling

- If you run into trouble, check out the examples in the [repo](https://github.com/x402-foundation/x402/tree/main/examples) for more context and full code.
- Run `npm install` or `go mod tidy` to install dependencies

### 6. Enable Signed Offers & Receipts

The [Signed Offers & Receipts extension](/extensions/offer-receipt) adds cryptographic proof-of-interaction to your payment flows. When enabled, your server automatically signs **offers** on every `402` response (committing to payment terms) and a **receipt** on every `200` response (confirming service delivery).

This creates portable, verifiable artifacts that clients and third parties can use for auditing, dispute resolution, and increasing the reputation of your service. See the [full setup guide](/extensions/offer-receipt) for installation, configuration, and signer authorization options.

---

## Running on Mainnet

Once you've tested your integration on testnet, you're ready to accept real payments on mainnet.

### 1. Update the Facilitator URL

For mainnet, use a production facilitator. See [Facilitators](/dev-tools/facilitators) for selected options. Example using one facilitator:

<Tabs>
  <Tab title="Node.js">
    ```typescript theme={null}
    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://api.cdp.coinbase.com/platform/v2/x402"
      // url: "https://facilitator.payai.network"  // PayAI Facilitator
    });
    ```
  </Tab>

  <Tab title="Go (Gin)">
    ```go theme={null}
    facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
        URL: "https://api.cdp.coinbase.com/platform/v2/x402",
        // URL: "https://facilitator.payai.network",  // PayAI Facilitator
    })
    ```
  </Tab>

  <Tab title="Go (Echo)">
    ```go theme={null}
    facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{
        URL: "https://api.cdp.coinbase.com/platform/v2/x402",
        // URL: "https://facilitator.payai.network",  // PayAI Facilitator
    })
    ```
  </Tab>

  <Tab title="Python (FastAPI)">
    ```python theme={null}
    from x402.http import FacilitatorConfig, HTTPFacilitatorClient

    facilitator = HTTPFacilitatorClient(
        FacilitatorConfig(url="https://api.cdp.coinbase.com/platform/v2/x402")
        #FacilitatorConfig(url="https://facilitator.payai.network")  # PayAI Facilitator
    )
    ```

  </Tab>

  <Tab title="Python (Flask)">
    ```python theme={null}
    from x402.http import FacilitatorConfig, HTTPFacilitatorClientSync

    facilitator = HTTPFacilitatorClientSync(
        FacilitatorConfig(url="https://api.cdp.coinbase.com/platform/v2/x402")
        #FacilitatorConfig(url="https://facilitator.payai.network")  # PayAI Facilitator
    )
    ```

  </Tab>
</Tabs>

Do not reuse `https://x402.org/facilitator` for mainnet routes. The default x402.org facilitator is intended for testnet development only.

### 2. Update Your Network Identifier

Change from testnet to mainnet network identifiers:

<Tabs>
  <Tab title="Base Mainnet">
    ```typescript theme={null}
    // Testnet → Mainnet
    network: "eip155:8453", // Base mainnet (was eip155:84532)
    ```
  </Tab>

  <Tab title="Solana Mainnet">
    ```typescript theme={null}
    // Testnet → Mainnet
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", // Solana mainnet

    // For Solana, use a Solana wallet address (base58 format)
    payTo: "YourSolanaWalletAddress",
    ```

  </Tab>

  <Tab title="Multi-Network">
    ```typescript theme={null}
    // Support multiple networks on the same endpoint
    {
      "GET /weather": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",
            network: "eip155:8453",  // Base mainnet
            payTo: "0xYourEvmAddress",
          },
          {
            scheme: "exact",
            price: "$0.001",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // Solana mainnet
            payTo: "YourSolanaAddress",
          },
        ],
        description: "Weather data",
      },
    }
    ```
  </Tab>
</Tabs>

### 3. Register Multiple Schemes (Multi-Network)

For multi-network support, register both EVM and SVM schemes:

<Tabs>
  <Tab title="Express / Hono / Fastify">
    ```typescript theme={null}
    import { ExactEvmScheme } from "@x402/evm/exact/server";
    import { ExactSvmScheme } from "@x402/svm/exact/server";

    const server = new x402ResourceServer(facilitatorClient);
    server.register("eip155:*", new ExactEvmScheme());
    server.register("solana:*", new ExactSvmScheme());
    ```

  </Tab>

  <Tab title="Go (Gin)">
    ```go theme={null}
    import (
        evm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
        svm "github.com/x402-foundation/x402/go/v2/mechanisms/svm/exact/server"
    )

    r.Use(ginmw.X402Payment(ginmw.Config{
        // ...
        Schemes: []ginmw.SchemeConfig{
            {Network: x402.Network("eip155:8453"), Server: evm.NewExactEvmScheme()},
            {Network: x402.Network("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), Server: svm.NewExactSvmScheme()},
        },
    }))
    ```

  </Tab>

  <Tab title="Go (Echo)">
    ```go theme={null}
    import (
        evm "github.com/x402-foundation/x402/go/v2/mechanisms/evm/exact/server"
        svm "github.com/x402-foundation/x402/go/v2/mechanisms/svm/exact/server"
    )

    e.Use(echomw.X402Payment(echomw.Config{
        // ...
        Schemes: []echomw.SchemeConfig{
            {Network: x402.Network("eip155:8453"), Server: evm.NewExactEvmScheme()},
            {Network: x402.Network("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), Server: svm.NewExactSvmScheme()},
        },
    }))
    ```

  </Tab>

  <Tab title="Python">
    ```python theme={null}
    from x402.mechanisms.evm.exact import ExactEvmServerScheme
    from x402.mechanisms.svm.exact import ExactSvmServerScheme
    from x402.server import x402ResourceServer

    server = x402ResourceServer(facilitator)
    server.register("eip155:8453", ExactEvmServerScheme())  # Base mainnet
    server.register("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", ExactSvmServerScheme())  # Solana mainnet
    ```

  </Tab>
</Tabs>

### 4. Update Your Wallet

Make sure your receiving wallet address is a real mainnet address where you want to receive USDC payments.

### 5. Test with Real Payments

Before going live:

1. Test with small amounts first
2. Verify payments are arriving in your wallet
3. Monitor the facilitator for any issues

**Warning:** Mainnet transactions involve real money. Always test thoroughly on testnet first and start with small amounts on mainnet.

---

## Network Identifiers (CAIP-2)

x402 v2 uses [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format for network identifiers:

| Network        | CAIP-2 Identifier                         |
| -------------- | ----------------------------------------- |
| Base Mainnet   | `eip155:8453`                             |
| Base Sepolia   | `eip155:84532`                            |
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet  | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |

See [Network Support](/core-concepts/network-and-token-support) for the full list.

---

### Next Steps

- Check out the [Advanced Example](https://github.com/x402-foundation/x402/tree/main/examples/typescript/servers/advanced) for a more complex payment flow
- Explore [Advanced Concepts](/advanced-concepts/lifecycle-hooks) like lifecycle hooks for custom logic before/after verification/settlement
- Explore Extensions like [Bazaar](/extensions/bazaar) for service discovery and [Signed Offers & Receipts](/extensions/offer-receipt) for verifiable trust and reputation
- Get started as a [buyer](/getting-started/quickstart-for-buyers)

For questions or support, join our [Slack](http://slack.x402.org/).

### Summary

This quickstart covered:

- Installing the x402 SDK and relevant middleware
- Adding payment middleware to your API and configuring it
- Choosing between `exact` (fixed-price), `upto` (usage-based per settlement), and `batch-settlement` (EVM micropayments with batched redemption) payment schemes
- Testing your integration
- Deploying to mainnet with CAIP-2 network identifiers

Your API is now ready to accept crypto payments through x402.

Jump to Content
Web3 Antivirus
API Reference

Search
CTRL-K
Log In
Filter
CTRL-/
General
Introduction
Getting Started
Scam and Risk Library
Use Cases
Dapp Scanning
Scan Website
post
Transaction Scanning
Scan Transaction
post
Scan Message
post
Detect Transaction Poisoning
get
Detect Scam Transactions
get
Detect First-Time Transfer
post
Trace Raw Transaction
post
Trace Transaction
post
Simulate Balance Change
get
Decode Transaction
post
Decode Method Hex Signature
get
Decode Event Hex Signature
get
Validate Transaction
post
Validate Transaction (EVM)
post
Token Scanning
Scan Token
get
Scan Tokens
post
Detect Token Honeypot
get
Address Scanning
Summarize Address
get
Scan Contract
get
Deep Scan Address
get
Quick Scan Address
get
Detect Address Bot
get
Detect Address Impersonation
get
Detect Address Poisoning Attacks
get
Detect Malicious Tokens
get
Evaluate Address Health
get
Check Address Activity
get
List Address Approvals
get
Report
Report Transaction
post
Report Address
post
Report Website
post
Powered by

Copy Page
Scan Message
post
https://api.web3antivirus.io/api/public/v2/extension/analysis/signature

Endpoint for analyzing EIP-712 messages (off-chain signatures) It accepts the standard EIP-712 data format (domain, types, primaryType, message) and returns a structured analysis result, including the detected message type, aggregated riskGroup, involved addresses with labels and risk levels, and triggered detectors of potentially dangerous actions.

Recent Requests
Log in to see full request history
Time Status User Agent
Make a request to see history.
0 Requests This Month

Body Params
from
string
required
Signature owner address

website
string
The URL of the website/context in which the transaction is being processed

message
json
required
JSON signature payload

chainId
string
enum
Defaults to 1

1

Show 16 enum values
Response

200
Returns the signature analysis

Updated 5 months ago

Scan Transaction
Detect Transaction Poisoning
Did this page help you?
Language

Shell

Node

Ruby

PHP

Python
Credentials
Header
X-API-KEY

1
curl --request POST \
2
--url https://api.web3antivirus.io/api/public/v2/extension/analysis/signature \
3
--header 'accept: application/json' \
4
--header 'content-type: application/json' \
5
--data '{"chainId":"1"}'

Try It!
Response
Click Try It! to start a request and see the response here! Or choose an example:
application/json

200

Jump to Content
Web3 Antivirus
API Reference

Search
CTRL-K
Log In
Filter
CTRL-/
General
Introduction
Getting Started
Scam and Risk Library
Use Cases
Dapp Scanning
Scan Website
post
Transaction Scanning
Scan Transaction
post
Scan Message
post
Detect Transaction Poisoning
get
Detect Scam Transactions
get
Detect First-Time Transfer
post
Trace Raw Transaction
post
Trace Transaction
post
Simulate Balance Change
get
Decode Transaction
post
Decode Method Hex Signature
get
Decode Event Hex Signature
get
Validate Transaction
post
Validate Transaction (EVM)
post
Token Scanning
Scan Token
get
Scan Tokens
post
Detect Token Honeypot
get
Address Scanning
Summarize Address
get
Scan Contract
get
Deep Scan Address
get
Quick Scan Address
get
Detect Address Bot
get
Detect Address Impersonation
get
Detect Address Poisoning Attacks
get
Detect Malicious Tokens
get
Evaluate Address Health
get
Check Address Activity
get
List Address Approvals
get
Report
Report Transaction
post
Report Address
post
Report Website
post
Powered by

Copy Page
Quick Scan Address
get
https://api.web3antivirus.io/api/public/v2/extension/account/{address}/quick-scan

Performs a fast, high-level risk assessment of a blockchain address based on known malicious activity patterns and security flags.
Designed for real-time use cases where low latency is critical.

Recent Requests
Log in to see full request history
Time Status User Agent
Make a request to see history.
0 Requests This Month

Path Params
address
string
required
ETH address/ENS

Response

200
Returns the Toxic Score statistic

Updated 5 months ago

Deep Scan Address
Detect Address Bot
Did this page help you?
Language

Shell

Node

Ruby

PHP

Python
Credentials
Header
X-API-KEY

1
curl --request GET \
2
--url https://api.web3antivirus.io/api/public/v2/extension/account/address/quick-scan \
3
--header 'accept: application/json'

Try It!
Response
Click Try It! to start a request and see the response here! Or choose an example:
application/json

200

Jump to Content
Web3 Antivirus
API Reference

Search
CTRL-K
Log In
Filter
CTRL-/
General
Introduction
Getting Started
Scam and Risk Library
Use Cases
Dapp Scanning
Scan Website
post
Transaction Scanning
Scan Transaction
post
Scan Message
post
Detect Transaction Poisoning
get
Detect Scam Transactions
get
Detect First-Time Transfer
post
Trace Raw Transaction
post
Trace Transaction
post
Simulate Balance Change
get
Decode Transaction
post
Decode Method Hex Signature
get
Decode Event Hex Signature
get
Validate Transaction
post
Validate Transaction (EVM)
post
Token Scanning
Scan Token
get
Scan Tokens
post
Detect Token Honeypot
get
Address Scanning
Summarize Address
get
Scan Contract
get
Deep Scan Address
get
Quick Scan Address
get
Detect Address Bot
get
Detect Address Impersonation
get
Detect Address Poisoning Attacks
get
Detect Malicious Tokens
get
Evaluate Address Health
get
Check Address Activity
get
List Address Approvals
get
Report
Report Transaction
post
Report Address
post
Report Website
post
Powered by

Copy Page
Deep Scan Address
get
https://api.web3antivirus.io/api/public/v2/extension/account/{address}/toxic-score

Checks if the address has involvement in phishing, blackmail, stealing attacks, and more, alerting users about any suspicious actions.

Monitored Activities:

Honeypot-related addresses
Phishing, blackmail, and stealing activities
Darkweb transactions, cybercrime, and financial crime
Money laundering and sanctions flags
Creation or interaction with malicious contracts
Gas abuse, reinitiation, and fake standard interface in contracts
Recent Requests
Log in to see full request history
Time Status User Agent
Make a request to see history.
0 Requests This Month

Path Params
address
string
required
ETH address/ENS

Response

200
Returns the Toxic Score statistic

Updated 5 months ago

Scan Contract
Quick Scan Address
Did this page help you?
Language

Shell

Node

Ruby

PHP

Python
Credentials
Header
X-API-KEY

1
curl --request GET \
2
--url https://api.web3antivirus.io/api/public/v2/extension/account/address/toxic-score \
3
--header 'accept: application/json'

Try It!
Response
Click Try It! to start a request and see the response here! Or choose an example:
application/json

200

Jump to Content
Web3 Antivirus
API Reference

Search
CTRL-K
Log In
Filter
CTRL-/
General
Introduction
Getting Started
Scam and Risk Library
Use Cases
Dapp Scanning
Scan Website
post
Transaction Scanning
Scan Transaction
post
Scan Message
post
Detect Transaction Poisoning
get
Detect Scam Transactions
get
Detect First-Time Transfer
post
Trace Raw Transaction
post
Trace Transaction
post
Simulate Balance Change
get
Decode Transaction
post
Decode Method Hex Signature
get
Decode Event Hex Signature
get
Validate Transaction
post
Validate Transaction (EVM)
post
Token Scanning
Scan Token
get
Scan Tokens
post
Detect Token Honeypot
get
Address Scanning
Summarize Address
get
Scan Contract
get
Deep Scan Address
get
Quick Scan Address
get
Detect Address Bot
get
Detect Address Impersonation
get
Detect Address Poisoning Attacks
get
Detect Malicious Tokens
get
Evaluate Address Health
get
Check Address Activity
get
List Address Approvals
get
Report
Report Transaction
post
Report Address
post
Report Website
post
Powered by

Copy Page
Scan Token
get
https://api.web3antivirus.io/api/public/v2/extension/token-intelligence/token/{address}/risks

Evaluates ERC-20 tokens for key security risks based on real-time and historical blockchain data. This endpoint scans for:

Rug pull signs, like sudden liquidity removal or suspicious contract updates.
Honeypot behavior, where tokens can be bought but can’t be sold.
Abnormal buy/sell fees, especially large, unexpected fee spikes.
Sanctions risks, fake tokens, scam airdrops, and other known fraud patterns.
Recent Requests
Log in to see full request history
Time Status User Agent
Make a request to see history.
0 Requests This Month

Path Params
address
string
required
Contract address

Query Params
chainId
string
enum

Show 20 enum values
Response

200
Returns the token risk analysis

Updated 3 months ago

Validate Transaction (EVM)
Scan Tokens
Did this page help you?
Language

Shell

Node

Ruby

PHP

Python
Credentials
Header
X-API-KEY

1
curl --request GET \
2
--url https://api.web3antivirus.io/api/public/v2/extension/token-intelligence/token/address/risks \
3
--header 'accept: application/json'

Try It!
Response
Click Try It! to start a request and see the response here! Or choose an example:
application/json

200
