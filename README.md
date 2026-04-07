# Baptise

Upgrade any ERC-721 NFT into a BAP-578 autonomous agent.

If you already own an NFT from another collection and want to use it as a BAP-578 agent, this is how you do it. Lock your NFT in the portal, get a fully functional BAP-578 agent in return. Want your original back? Unwrap it. Nothing gets burned, provenance stays intact.

## Flow

```
User has NFT (any ERC-721 collection)
 → approves the portal
 → locks NFT in portal contract
 → portal mints a new BAP-578 agent linked to the original
 → user gets full agent capabilities: learning, staking, vaults, platform connections

Want to exit?
 → call unwrap
 → agent gets terminated
 → original NFT returned to user
```

## State Machine

### Upgrade Record Lifecycle

```
  ┌───────────┐
  │   None    │  NFT not in the system
  └─────┬─────┘
        │ user calls upgrade()
        ▼
  ┌───────────┐
  │  Active   │  Original NFT locked, BAP-578 agent live
  └─────┬─────┘
        │ user calls unwrap()
        ▼
  ┌───────────┐
  │ Unwrapped │  Agent terminated, original NFT returned
  └───────────┘
        │
        ▼ user can upgrade the same NFT again (new cycle)
```

### What happens on-chain during upgrade

```
  User                    Portal                   AgentFactory             BAP-578 Agent
   │                        │                          │                        │
   │  approve(portal)       │                          │                        │
   │──────────────────────►│                          │                        │
   │                        │                          │                        │
   │  upgrade() + 0.01 BNB  │                          │                        │
   │──────────────────────►│                          │                        │
   │                        │  transferFrom(user→portal)                        │
   │                        │  (locks original NFT)    │                        │
   │                        │                          │                        │
   │                        │  createAgent() + 0.01 BNB│                        │
   │                        │─────────────────────────►│                        │
   │                        │                          │  deploy new BAP-578    │
   │                        │                          │──────────────────────►│
   │                        │                          │  mint token #1→portal  │
   │                        │◄─────────────────────────│                        │
   │                        │                          │                        │
   │                        │  transfer agent→user     │                        │
   │◄──────────────────────│                          │                        │
   │                        │                          │                        │
   │  now owns BAP-578 agent│                          │                        │
```

### What happens on-chain during unwrap

```
  User                    Portal                   BAP-578 Agent
   │                        │                          │
   │  approve(portal)       │                          │
   │──────────────────────►│                          │
   │                        │                          │
   │  unwrap(upgradeId)     │                          │
   │──────────────────────►│                          │
   │                        │  transferFrom(user→portal)│
   │                        │  (takes agent token)     │
   │                        │                          │
   │                        │  terminate(tokenId)      │
   │                        │─────────────────────────►│
   │                        │  (BNB balance → portal)  │
   │                        │◄─────────────────────────│
   │                        │                          │
   │  ◄── forward BNB ─────│                          │
   │  ◄── return original ──│                          │
   │                        │                          │
   │  original NFT back     │                          │
```

### User journey (what you actually do)

**To upgrade:**
1. Go to the portal UI
2. Pick an NFT from your wallet
3. Click approve (one-time per NFT)
4. Click upgrade, pay 0.01 BNB
5. Done. You now have a BAP-578 agent. Set up learning, connect platforms, stake, whatever you want

**To unwrap:**
1. Go to the portal UI
2. Find your upgrade in the list
3. Click approve on the agent token
4. Click unwrap
5. Original NFT is back in your wallet. Any BNB left in the agent gets returned to you

## Why wrap instead of modify?

We can't touch other people's contracts. If someone holds a BAYC or any third-party NFT, there's no way to inject BAP-578 functionality into that contract. So we wrap it. The original sits safe inside the portal, and a new BAP-578 agent is created with a permanent on-chain link back to it. One original per agent, always reversible.

## Contracts

| Contract | What it does |
|----------|-------------|
| `NFTUpgradePortal.sol` | Core portal. Handles upgrade, unwrap, batch upgrades, collection whitelist, admin controls |
| `INFTUpgradePortal.sol` | Interface definition. Structs, events, function signatures |

The remaining contracts (`BAP578.sol`, `AgentFactory.sol`, `BAP578Treasury.sol`, `CircuitBreaker.sol`) are BAP-578 core dependencies included here so everything compiles and tests run standalone.

## Under the hood

The portal calls `AgentFactory.createAgent()` to mint new agents. This keeps the existing fee flow intact. Creation fees still route through `BAP578Treasury` with the standard 60/25/15 split (Foundation / Community / Staking).

Since `AgentFactory` mints to `msg.sender`, the portal receives the agent token first, then immediately transfers it to the user. The portal implements `IERC721Receiver` to handle this.

On unwrap, the portal takes the agent back, calls `terminate()` (which returns any remaining BNB balance), forwards those funds to the user, and sends the original NFT home.

## Fees

| Fee | Amount | Destination |
|-----|--------|-------------|
| Factory fee | 0.01 BNB | BAP-578 Treasury (standard split) |

## Features

- **Batch upgrades** up to 10 NFTs in a single transaction
- **Collection whitelist** optionally restrict which collections can upgrade (off by default, any ERC-721 works)
- **Bidirectional lookups** query by original NFT or by agent contract address
- **Emergency recovery** owner can recover stuck NFTs that aren't tied to active upgrades
- **Circuit breaker** respects the BAP-578 global pause system
- **UUPS upgradeable** contract can be upgraded through governance

## Setup

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Tests

62 tests covering the full lifecycle:

- Upgrade: lock NFT, mint agent, transfer to user, verify all mappings
- Unwrap: terminate agent, return original, forward BNB balance
- Batch: multiple upgrades in one tx
- Whitelist: block/allow collections, batch whitelist management
- Admin: fee updates, logic swaps, factory changes, fee withdrawal
- Circuit breaker: global and per-contract pause
- Edge cases: NFTs without tokenURI, double-upgrade prevention, agent ownership transfer then unwrap

## Deploy

```bash
cp .env.example .env
# fill in your BAP-578 contract addresses and deployer key

npx hardhat run scripts/deploy.js --network testnet
```

## License

MIT
