# The use case: the first payment after a vendor's bank details change

Bonded's core idea is simple: before any transaction goes out, independently re-check the facts it
depends on. That idea matters most at the one moment where a payment is **high-value, irreversible,
automated, and genuinely ambiguous at the same time**. In business payments, that moment is the first
invoice paid after a vendor's bank details change.

---

## Why this moment, and not another

| What makes a payment dangerous | Why this moment has all of them |
|---|---|
| **It's the attack vector itself** | Business Email Compromise almost always works the same way: impersonate a real vendor and change where the money goes. It cost **$3.04 billion in 2025**, the #2 cybercrime by dollar loss in the [FBI IC3 2025 report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf). |
| **It's irreversible** | 86% of those losses moved by wire or ACH. Once the money lands in a mule account, it's gone. |
| **It's large** | The average loss is about $123,000 per incident. That's not a rounding error for a mid-size company; it can be a quarter's margin. |
| **It's ambiguous** | Vendors *do* legitimately change banks. Blocking every change breaks real business, and approving every change pays the criminals. No rule can decide it alone. |
| **It's what stops AI agents** | Finance teams want AI agents to run accounts payable end to end. This exact risk is why they keep a human click on every payment, which removes the reason to automate. |

Every other check in accounts payable (Is the amount right? Is the vendor active?) has a right
answer a computer can find. A bank change doesn't, and that is where Bonded's design fits: settle the
clear cases automatically, and send only the ambiguous one to a verified human.

---

## The cast

**The customer (who buys it):** Dana, the Controller at *Kestrel Components*, a fictional mid-size
manufacturer paying around 400 vendor invoices a month. Her CFO wants accounts payable automated.
Her auditors want fraud controls that hold up. Today she can't satisfy both, so every payment still
waits for a human to click approve.

**The other kind of customer (the channel):** an AP-automation platform that sells to companies like
Kestrel. It builds Bonded into its product through the SDK, so every one of its customers gets the
check without doing any integration work.

**The main user:** Kestrel's AP agent, an AI that reads invoices, matches them to purchase orders and
pays them. It calls Bonded before every payment. No person is involved in routine payments.

**The occasional user:** Sam, an AP specialist on Dana's team. Sam only sees a payment when Bonded
holds it.

**The adversary:** someone who has been reading a compromised mailbox at *Globex Freight*, a real
freight vendor Kestrel pays every month.

---

## The scenario, step by step

**Monday.** Globex Freight's invoice for $8,450 arrives and is paid the usual way. The agent calls
Bonded, which checks the invoice against Kestrel's vendor master record: correct payout address,
vendor active, amount within tolerance. The verdict is `CLEARED` and the payment goes out. No human
sees it.

**Wednesday.** An email arrives from `accounts@globex-freight-payments.com`, a look-alike domain.
It says: *"URGENT — we've moved banks, please use the new remittance details for this week's
invoice."* It attaches a genuine-looking invoice with a new payout address.

**Without Bonded:** the agent reads the new address from the invoice and pays it. Kestrel loses
$8,450 and doesn't find out until the real Globex asks where its money is, weeks later.

**With Bonded:**

1. The agent proposes the payment and states what it believes: *pay Globex, at this address, this
   amount*.
2. Bonded doesn't trust that claim. It looks up Globex's real payout address in the vendor master
   record, a source the email can't touch, and compares the two.
3. The addresses don't match. Because this check is marked `holdOnMismatch`, the verdict is
   `HELD_FOR_STEPUP`, not `REFUSED` and not `CLEARED`. The payment doesn't go out.
4. Sam gets the held payment with the evidence side by side: the claimed address, the address on
   file, and when the one on file last changed.
5. Sam does what AP best practice already requires: calls Globex on the phone number already on file,
   not the one in the email.
6. **Fraud branch:** Globex says they never changed banks. Sam denies the payment. Nothing moved, and
   Kestrel has a real attack to report.
   **Legitimate branch:** Globex confirms the change. Sam completes a fresh World ID check, which
   proves a live human approved this one payment, not a reused login or a script. The payment can
   then be released.
7. On Sui, the release happens as a one-use object: the verdict and the approval are consumed in the
   same transaction and can never be settled a second time.

**The result:** of Kestrel's 400 monthly payments, the few dozen routine ones per vendor go through
with no human at all. A person is involved only in the handful of genuinely ambiguous moments, and
only when they can't be faked.

---

## Why Dana pays for it

- **It lets automation actually happen.** She can remove the blanket "approve every payment" step
  and keep a human only where it matters. That's the business case: the savings come from
  automating the other 99% safely.
- **One stopped incident pays for years of it.** At an average of $123,000 per BEC loss, a single
  prevented payment outweighs the cost of the tool.
- **It stands up in an audit.** Every refusal and every hold records the claimed value next to the
  real one. Every release is a single-use on-chain record. The trail says what was checked, not just
  that someone clicked.

---

## What each sponsor does in this story

- **Intercepta:** screens the new payout address against live threat intelligence, adding "this
  address is independently known to be bad" to "this address doesn't match our records". *(Currently
  limited: Intercepta screens EVM addresses, and this demo's addresses are Sui-shaped. See
  `sponsers.md`.)*
- **World ID:** proves Sam is a live human approving this specific payment right now. That's the one
  step an attacker most wants to fake.
- **Sui:** holds the funds and makes each approval single-use. A cleared verdict is an object that is
  deleted when it's used, so it can't be replayed.

---

## Competitors, and where Bonded is different

| Who | What they do well | What they don't do |
|---|---|---|
| **Vendor bank-verification tools** (e.g. Trustpair, Eftsure) | Verify and monitor vendor bank details; the closest competitors | Built as dashboards for human finance teams, not as a check an AI agent calls mid-decision |
| **AP-automation platforms** (e.g. Bill.com, Tipalti, AvidXchange) | Run the whole payables workflow, including built-in fraud checks | Their checks sit inside their own platform; they're not an independent layer an agent can call |
| **Treasury and payments security** (e.g. Bottomline, Kyriba) | Pattern-based risk scoring across large transaction volumes | Statistical risk scores, not an independent check of the specific facts one payment relies on |
| **Agent-payment standards** (Google's AP2, Visa's agent guardrails) | Prove what the agent was authorized to do | Prove the agent's *intent*, not that the facts it acted on were *true* |

**Bonded's position:** existing tools either watch payments from outside or prove what the agent
decided. Bonded sits inside the agent's decision. It re-checks the specific facts the payment depends
on, holds only the ambiguous case for a person whose identity is verified, and makes every release
impossible to replay.

---

## What's built today, honestly

**Built and tested:**
- this exact Globex scenario, end to end, including the spoofed email page, the three verdicts and
  the hold;
- the console, where Sam's review screen is the Invoice Inbox;
- the MCP tool and SDK;
- the World ID step-up;
- the Sui vault, live on testnet.

**Not yet:**
- a `CLEARED` or approved verdict doesn't automatically submit the Sui settlement yet;
- the vendor master is a disclosed stand-in, not a real ERP connection;
- Intercepta can't screen the Sui-shaped demo addresses.

See `docs/THREATMODEL.md` for all three.
