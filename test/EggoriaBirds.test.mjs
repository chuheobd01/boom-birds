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

    assert.equal(await birds.mintedTokenOf(address), tokenId);
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
  for (let land = 0; land < 5; land += 1) {
    assert.deepEqual(
      await Promise.all([0, 1, 2, 3, 4].map((rarity) => birds.landRarityRemaining(land, rarity))),
      [60n, 25n, 10n, 4n, 1n],
    );
    assert.equal(await birds.landRarityPoolRemaining(land), 100n);
  }
  assert.equal(await birds.rarityPoolRemaining(), 500n);

  await ethers.provider.send("hardhat_stopImpersonatingAccount", [nextAddress]);
});

test("admin can seed day nine and the owner evolves on check-in ten", async () => {
  const { ethers } = await network.connect();
  const [admin, owner, stranger] = await ethers.getSigners();
  const birds = await ethers.deployContract("EggoriaBirds", [await admin.getAddress()], admin);
  await birds.waitForDeployment();
  const ownerAddress = await owner.getAddress();

  await assert.rejects(
    () => birds.connect(stranger).seedTestBird(ownerAddress, 1, 9),
    /AccessControlUnauthorizedAccount/,
  );

  await (await birds.seedTestBird(ownerAddress, 1, 9)).wait();
  const before = await birds.tokenState(1);
  assert.equal(before.land, 1n);
  assert.equal(before.stage, 0n);
  assert.equal(before.checkIns, 9n);
  assert.equal(before.lastCheckInDay, 0n);

  await (await birds.connect(owner).checkIn(1)).wait();
  const after = await birds.tokenState(1);
  assert.equal(after.stage, 1n);
  assert.equal(after.checkIns, 10n);
  assert.ok(after.lastCheckInDay > 0n);
});

test("evolution test mode rotates every five mints and previews Legendary within quotas", async () => {
  const { ethers } = await network.connect();
  const [admin, firstOwner, secondOwner, thirdOwner, fourthOwner, fifthOwner] = await ethers.getSigners();
  const birds = await ethers.deployContract("EggoriaBirds", [await admin.getAddress()], admin);
  await birds.waitForDeployment();
  assert.equal(await birds.evolutionTestLand(), 0n);
  assert.equal(await birds.evolutionTestRarity(), 3n);
  await expectRevert(
    () => birds.connect(firstOwner).setEvolutionTestLand(1),
    "only an admin may change the test rotation start",
  );
  await expectRevert(
    () => birds.setEvolutionTestLand(5),
    "the test rotation start must be one of the five lands",
  );
  await expectRevert(
    () => birds.connect(firstOwner).setEvolutionTestRarity(4),
    "only an admin may change the preferred test rarity",
  );
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  const firstFiveOwners = [firstOwner, secondOwner, thirdOwner, fourthOwner, fifthOwner];
  for (const [index, owner] of firstFiveOwners.entries()) {
    await (await birds.connect(owner).mint()).wait();
    const bird = await birds.tokenState(index + 1);
    assert.equal(bird.landAssigned, true);
    assert.equal(bird.land, 0n);
    assert.equal(bird.checkIns, 9n);
    assert.equal(bird.stage, 0n);
  }
  assert.equal(await birds.totalLandsAssigned(), 5n);

  for (const [index, owner] of firstFiveOwners.entries()) {
    await (await birds.connect(owner).checkIn(index + 1)).wait();
    const fledgling = await birds.tokenState(index + 1);
    assert.equal(fledgling.checkIns, 19n);
    assert.equal(fledgling.stage, 1n);
    assert.equal(fledgling.lastCheckInDay, 0n);
    await (await birds.connect(owner).checkIn(index + 1)).wait();
    const soarling = await birds.tokenState(index + 1);
    assert.equal(soarling.stage, 2n);
    assert.equal(soarling.rarityAssigned, true);
    assert.equal(soarling.rarity, index < 4 ? 3n : 0n);
  }
  assert.equal(await birds.landRarityRemaining(0, 3), 0n);
  assert.equal(await birds.landRarityRemaining(0, 0), 59n);
  assert.equal(await birds.landRarityPoolRemaining(0), 95n);

  for (let index = 0; index < 495; index += 1) {
    const address = `0x${(0x30_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    await (await birds.connect(await ethers.getSigner(address)).mint()).wait();
    const tokenId = index + 6;
    assert.equal(await birds.tokenLand(tokenId), BigInt(Math.floor((tokenId - 1) / 5) % 5));
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 100n);
  }
  assert.equal(await birds.totalLandsAssigned(), 500n);
  await expectRevert(
    () => birds.connect(admin).mint(),
    "test minting must stop at the global 500-bird cap",
  );
});

test("showcase mode gives the first twelve mints the requested land and rarity sequence", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const birds = await ethers.deployContract("EggoriaBirds", [await admin.getAddress()], admin);
  await birds.waitForDeployment();
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setEvolutionShowcaseMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  const expected = [
    [1n, 2n], [1n, 2n], [1n, 2n],
    [2n, 3n], [2n, 3n], [2n, 3n],
    [3n, 3n], [3n, 3n], [3n, 3n],
    [4n, 3n], [4n, 3n], [4n, 3n],
  ];
  for (const [index, [land, rarity]] of expected.entries()) {
    const address = `0x${(0x50_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const owner = await ethers.getSigner(address);
    const tokenId = index + 1;
    await (await birds.connect(owner).mint()).wait();
    assert.equal(await birds.tokenLand(tokenId), land);
    await (await birds.connect(owner).checkIn(tokenId)).wait();
    await (await birds.connect(owner).checkIn(tokenId)).wait();
    const state = await birds.tokenState(tokenId);
    assert.equal(state.stage, 2n);
    assert.equal(state.rarity, rarity);
    assert.equal(state.rarityAssigned, true);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }
});

test("pair rotation repeats two mints per land", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const birds = await ethers.deployContract("EggoriaBirds", [await admin.getAddress()], admin);
  await birds.waitForDeployment();
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setEvolutionPairRotationMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  for (let index = 0; index < 20; index += 1) {
    const address = `0x${(0x60_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const owner = await ethers.getSigner(address);
    await (await birds.connect(owner).mint()).wait();
    assert.equal(await birds.tokenLand(index + 1), BigInt(Math.floor(index / 2) % 5));
    await (await birds.connect(owner).checkIn(index + 1)).wait();
    await (await birds.connect(owner).checkIn(index + 1)).wait();
    const state = await birds.tokenState(index + 1);
    assert.equal(state.stage, 2n);
    assert.equal(state.rarityAssigned, true);
    assert.equal(state.rarity, index % 10 === 7 ? 3n : 4n);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }
  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 4n);
    assert.equal(await birds.landRarityRemaining(land, 4), 1n);
  }
});
