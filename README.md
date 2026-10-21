# Rentra Prototype (MVP)

A demo-only rental-income tokenisation DApp using Solidity, Hardhat, React, Vite, ethers.js and MetaMask.

## Demo assumptions
- All values and properties are fictional.
- Investors buy RENT units with test ETH on a local Hardhat network.
- The operator deposits simulated rental income in test ETH.
- Funding must be closed before rental distributions begin. This avoids late buyers receiving prior distributions.
- Closing funding lets the owner withdraw the full amount raised once; the contract records the amount raised and transferred.
- The owner sets the funding target, token count, and financing term when creating each offering. The contract derives a uniform token price and requires the target to divide evenly by the token count.
- Rental income deposited during the term is allocated 100% to investors, proportionally to the tokens they bought. Investors claim their accrued distributions before maturity; after maturity, claims expire and the owner can recover unclaimed allocations.
- The local deployment creates eight separate listing contracts and seeds three offerings. The remaining five are available for the owner to add listings. Each listing has its own contract address and funding state; all eight are deployed by the same owner wallet.
- The marketplace shows up to eight listings per page, with separate account views for My listings and My investments.
- Token transfers are intentionally not implemented in this first version.
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
Copy all eight printed contract addresses, in order and comma separated, into `frontend/.env` as `VITE_RENTRA_CONTRACT_ADDRESSES=0x...,0x...,0x...,0x...,0x...,0x...,0x...,0x...`.

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
1. Connect MetaMask with the contract owner account. Use My listings to manage the three published listings or select Add listing to publish into one of the five open slots.
2. Open the Investor dashboard, connect an investor account, and buy tokens.
3. Switch back to the owner account and close funding.
4. Transfer the raised capital to the owner (one time).
5. After the displayed financing start date, record eligible rental proceeds from the Owner dashboard. Switch to the investor account to claim distributions before maturity.
6. At maturity, the owner can transfer any unclaimed investor allocation to themselves; claims and new rental deposits are then closed.

## Notes
- The deployment seeds Orchard Residences (4 ETH target, 4,000 tokens), Harbourfront Lofts (6 ETH target, 3,000 tokens), and Garden District Offices (10 ETH target, 5,000 tokens). Each has a five-year term and starts shortly after deployment.
- To change the preloaded listings, edit the `listings` array in `scripts/deploy.js`, then redeploy the local chain and contracts.
- 100% of deposited rental income is allocated to investors by token ownership. Claims are pull based: each investor claims their own accrued balance.
- A user must connect to chain ID 31337 for this local demo.
- If MetaMask has stale local-chain state after restarting Hardhat, reset the account activity in MetaMask settings.
- Before any public testnet deployment, update environment configuration and review the contracts carefully.
