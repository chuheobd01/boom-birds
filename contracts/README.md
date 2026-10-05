# Eggoria Birds contract

`EggoriaBirds.sol` is a new ERC-721 implementation for the evolving 500-bird collection.

## Collection rules

- Maximum supply: 500; one mint per wallet.
- Five numeric lands (`0` through `4`), each with exactly 100 inventory slots.
- `mint()` creates the NFT, pays for a D20 VRF request, and emits `LandRequested`.
- The authenticated D20 coordinator callback selects one of all remaining land slots, then emits `BirdMinted`.
- Check-ins 1-9 are stored off-chain, at most once per UTC day.
- Check-in 10 commits the first 10-day checkpoint on-chain and changes the token to `Intermediate`.
- Check-ins 11-19 are stored off-chain; check-in 20 commits the second checkpoint and emits `RarityRequested`.
- The day-20 transaction requests a second VRF word. Its authenticated callback assigns rarity and changes the token to `Advanced`.
- Rarity uses a shrinking pool with exact final quotas: 300 Common, 125 Rare, 50 Epic, 20 Legendary, and 5 Mythic.

## Metadata setup

Before enabling minting, an account with `METADATA_ROLE` should configure:

1. `setStageURI(land, 0, uri)` for the five primary metadata URIs.
2. `setStageURI(land, 1, uri)` for the five intermediate metadata URIs.
3. `setAdvancedURI(land, rarity, uri)` for all 25 advanced land/rarity combinations.

This is exactly 35 token metadata URIs: seven for each of the five lands. There is no separate advanced-pending URI or stage.

Each URI must point to NFT metadata JSON. Change the JSON `image` field to change the bird artwork.

## Randomness

The contract inherits `D20VRFConsumer` and accepts randomness callbacks only from the coordinator address supplied to the constructor. There is no admin fulfillment role or manual result setter. On ARC Testnet use the verified coordinator proxy `0xd20DA0FF9087d053f0291524Eac12abA1ADBd945`.

The frontend obtains a buffered quote with `quoteFeeAt` using the latest ARC base fee, sends it with `mint()` or the day-20 `checkIn()`, and the contract returns unused buffer immediately. If a request expires after 60 seconds, anyone can call `refundRequest(requestId)` on the coordinator; after the refund callback, the token owner can call `retryRandomness(tokenId)`.

Compile with Solidity 0.8.28 and EVM target `cancun`, matching the D20 SDK requirements.

## Compile

```bash
npm run contract:compile
```

The generated ABI and bytecode are written to `artifacts/contracts/EggoriaBirds.json`. Deployment is intentionally separate so the existing live contract is not replaced accidentally.

After deployment, configure the frontend with the new address:

```bash
NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS=0xYourDeployedContractAddress
```
