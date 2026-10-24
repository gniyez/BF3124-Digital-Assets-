# Rentra Prototype (MVP)

A demo-only rental-income tokenisation DApp using Solidity, Hardhat, React, Vite, ethers.js and MetaMask.

## Demo assumptions
- All values and properties are fictional.
- Investors buy RENT units with test ETH on a local Hardhat network. The operator deposits simulated rental income in test ETH.
- The owner sets the funding target, token count, and financing term when creating each offering, plus an optional funding end date and optional projected monthly/total rental income (shown to investors as estimates, not guarantees). The contract derives a uniform token price and requires the target to divide evenly by the token count.
- Funding closes automatically once every token is sold. The owner can also close funding early; closing is required before withdrawing the raised capital (a one-time transfer of the full amount raised).
- The owner can distribute rental income as soon as tokens have been bought — funding does not need to be closed first. Each deposit is split across the full token supply, so a holder of X% of the supply receives X% of that deposit. The portion mapped to unsold tokens stays in the contract and is returned to the owner at maturity.
- Rental accrues per holder. Investors claim their accrued distributions before maturity; after maturity, claims expire and the owner can recover all deposited rental income not yet claimed.
- Tokens are transferable and tradeable. A holder can transfer tokens directly, or use the built-in secondary market to list a lot for resale at a price; another investor buys the whole lot, paying the seller in ETH. Rental accrued before a sale stays with the seller; the buyer earns only from deposits made after the purchase.
- The local deployment deploys a single `RentraFactory` and seeds two offerings through it. There is no fixed listing cap: the owner can add unlimited listings from the UI, each of which is a fresh `RentraOffering` contract deployed on demand and tracked by the factory. Each listing has its own contract address and funding state.
- The marketplace shows up to eight listings per page, with separate account views for My listings and My investments.
- This is a technical demo, not an investment product or a legally enforceable rental-income instrument.

## Requirements
- Node.js 20 or newer
- MetaMask browser extension
- Two terminal windows

## 1. Install
```bash
npm install
npm --prefix frontend install
```

## 2. Start the local blockchain
Terminal 1:
```bash
npm run chain
```
Keep this terminal running. It creates local demo accounts and test ETH.

## 3. Deploy the contract
Terminal 2:
```bash
npm run deploy:local
```
The deploy script automatically writes the factory address into `frontend/.env` as `VITE_RENTRA_FACTORY_ADDRESS=0x...` — no manual copy-paste needed. That single address is all the app needs; it discovers every listing from the factory on-chain. If the Vite dev server is already running, restart it so it picks up the new address.

Note: the local Hardhat chain resets whenever `npm run chain` is restarted, which wipes all deployed contracts. After any chain restart, re-run `npm run deploy:local` (it re-seeds the listings and rewrites `.env`) and restart Vite.

## 4. Configure MetaMask
Add a network:
- Network name: Hardhat Local
- RPC URL: http://127.0.0.1:8545
- Chain ID: 31337
- Currency symbol: ETH

Import one of the private keys printed by the local Hardhat node into MetaMask. These keys are for local testing only. Never use them for a real wallet.

For a second investor account, import a different local Hardhat account key.

## 5. Run the frontend
```bash
npm run dev
```
Open the URL printed by Vite (usually http://localhost:5173).

## Demo flow
1. Connect MetaMask with the contract owner account. Use My listings to manage the two seeded listings, or select Add listing to deploy and publish a brand new listing (unlimited). When publishing, you can optionally set a funding end date and projected income figures.
2. Connect an investor account and buy tokens from a listing's detail page. Funding closes automatically when all tokens are sold.
3. (Optional) As the owner, close funding early, then transfer the raised capital to the owner (a one-time transfer).
4. After the financing start date, credit this month's rental income from the Owner dashboard. You can do this as soon as tokens are sold — funding does not need to be closed. Switch to the investor account to claim distributions before maturity.
5. (Optional) As an investor, resell tokens on the secondary market: list a lot at a price in the investor dashboard, then buy it from a second investor account. Tokens and ETH move accordingly.
6. At maturity, the owner can transfer any unclaimed rental income to themselves; claims and new rental deposits are then closed.

## Notes
- The deployment seeds Orchard Residences (4 ETH target, 4,000 tokens, projected 0.08/month and 4.8 total) and Harbourfront Lofts (6 ETH target, 3,000 tokens, projected 0.12/month and 7.2 total). Each has a five-year term, no funding deadline, and starts shortly after deployment. Add more at any time from the UI.
- To change the preloaded listings, edit the `listings` array in `scripts/deploy.js`, then redeploy.
- Deposited rental income is split across the full token supply and allocated to holders by their share of the supply. Claims are pull based: each investor claims their own accrued balance.
- A user must connect to chain ID 31337 for this local demo.
- If MetaMask has stale local-chain state after restarting Hardhat, reset the account activity in MetaMask settings.
- Gas on the local chain is paid in test ETH and has no real cost. Deploying a new listing uses far more gas than other actions because it deploys a fresh contract, so MetaMask may show a larger (still test-only) network fee for Add listing.
- Before any public testnet deployment, update environment configuration and review the contracts carefully.
