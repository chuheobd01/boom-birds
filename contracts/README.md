# Eggoria Birds contract

`EggoriaBirds.sol` is a new ERC-721 implementation for the evolving 500-bird collection.

## Collection rules

- Maximum supply: 500; one mint per wallet.
- Five numeric lands (`0` through `4`). Round-robin assignment guarantees 100 birds per land when the collection sells out.
- One check-in per UTC day.
- Check-in 10 changes the token to `Intermediate`.
- Check-in 20 emits `RarityRequested`. The bird remains `Intermediate` while randomness is pending.
- `fulfillRarity` assigns rarity and changes the token directly to `Advanced` in the same transaction.
- Rarity uses a shrinking pool with exact final quotas: 300 Common, 125 Rare, 50 Epic, 20 Legendary, and 5 Mythic.

## Metadata setup

Before enabling minting, an account with `METADATA_ROLE` should configure:

1. `setStageURI(land, 0, uri)` for the five primary metadata URIs.
2. `setStageURI(land, 1, uri)` for the five intermediate metadata URIs.
3. `setAdvancedURI(land, rarity, uri)` for all 25 advanced land/rarity combinations.

This is exactly 35 token metadata URIs: seven for each of the five lands. There is no separate advanced-pending URI or stage.

Each URI must point to NFT metadata JSON. Change the JSON `image` field to change the bird artwork.

## Randomness

Do not generate rarity from `block.timestamp`, `blockhash`, or user input. Grant `RANDOMIZER_ROLE` to a reviewed VRF/oracle adapter. The adapter watches `RarityRequested` and calls `fulfillRarity(tokenId, randomWord)` with a verified random word. Revoke this role from the deployer after the adapter is configured.

## Compile

```bash
npm run contract:compile
```

The generated ABI and bytecode are written to `artifacts/contracts/EggoriaBirds.json`. Deployment is intentionally separate so the existing live contract is not replaced accidentally.

After deployment, configure the frontend with the new address:

```bash
NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS=0xYourDeployedContractAddress
```
