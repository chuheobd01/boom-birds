import assert from "node:assert/strict";
import { test } from "node:test";

import { network } from "hardhat";

async function expectRevert(action, message) {
  try {
    await action();
  } catch {
    return;
  }

  assert.fail(message);
}

test("assigns lands from weighted remaining inventory and preserves rarity quotas", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const adminAddress = await admin.getAddress();
  const birds = await ethers.deployContract("EggoriaBirds", [adminAddress], admin);
  await birds.waitForDeployment();

  await (await birds.setStageURI(0, 0, "ipfs://forest-primary")).wait();
  await (await birds.setStageURI(1, 0, "ipfs://wind-primary")).wait();
  await (await birds.setMintingEnabled(true)).wait();

  for (let index = 0; index < 100; index += 1) {
    const address = `0x${(0x10_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [
      address,
      "0x56BC75E2D63100000",
    ]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const minter = await ethers.getSigner(address);

    await (await birds.connect(minter).mint()).wait();
    const tokenId = BigInt(index + 1);

    assert.equal(await birds.tokenURI(tokenId), "");
    await expectRevert(
      () => birds.tokenLand(tokenId),
      "tokenLand should revert while the land is pending",
    );

    await (await birds.fulfillLand(tokenId, 0)).wait();
    assert.equal(await birds.tokenLand(tokenId), 0n);

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  assert.equal(await birds.totalSupply(), 100n);
  assert.equal(await birds.totalLandsAssigned(), 100n);
  assert.equal(await birds.landMinted(0), 100n);
  assert.equal(await birds.landRemaining(0), 0n);
  assert.equal(await birds.landRemaining(1), 100n);

  const nextAddress = "0x0000000000000000000000000000000000020000";
  await ethers.provider.send("hardhat_setBalance", [
    nextAddress,
    "0x56BC75E2D63100000",
  ]);
  await ethers.provider.send("hardhat_impersonateAccount", [nextAddress]);
  const nextMinter = await ethers.getSigner(nextAddress);

  await (await birds.connect(nextMinter).mint()).wait();
  const fulfillment = await birds.fulfillLand(101, 0);
  const fulfillmentReceipt = await fulfillment.wait();

  assert.equal(await birds.tokenLand(101), 1n);
  assert.equal(await birds.landMinted(0), 100n);
  assert.equal(await birds.landMinted(1), 1n);
  assert.equal(await birds.landRemaining(1), 99n);
  assert.equal(await birds.tokenURI(101), "ipfs://wind-primary");

  const mintedEvent = fulfillmentReceipt.logs
    .map((log) => {
      try {
        return birds.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "BirdMinted");

  assert.ok(mintedEvent, "fulfillLand should emit BirdMinted");
  assert.equal(mintedEvent.args.tokenId, 101n);
  assert.equal(mintedEvent.args.owner.toLowerCase(), nextAddress.toLowerCase());
  assert.equal(mintedEvent.args.land, 1n);

  const state = await birds.tokenState(101);
  assert.equal(state.owner.toLowerCase(), nextAddress.toLowerCase());
  assert.equal(state.land, 1n);
  assert.equal(state.landAssigned, true);
  assert.equal(state.stage, 0n);
  assert.equal(state.rarityAssigned, false);
  assert.equal(state.checkIns, 0n);

  await expectRevert(
    () => birds.fulfillLand(101, 12345),
    "a token must not receive a second land",
  );
  await expectRevert(
    () => birds.connect(nextMinter).mint(),
    "one-wallet mint enforcement must remain active",
  );
  await expectRevert(
    () => birds.fulfillRarity(101, 0),
    "rarity must not be assigned before the twentieth check-in",
  );

  assert.deepEqual(
    await Promise.all([0, 1, 2, 3, 4].map((rarity) => birds.rarityRemaining(rarity))),
    [300n, 125n, 50n, 20n, 5n],
  );
  assert.equal(await birds.rarityPoolRemaining(), 500n);

  await ethers.provider.send("hardhat_stopImpersonatingAccount", [nextAddress]);
});
