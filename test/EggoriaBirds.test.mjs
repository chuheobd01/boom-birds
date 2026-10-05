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

async function deployBirds(ethers, admin) {
  const vrf = await ethers.deployContract("MockD20VRFCoordinator", [], admin);
  await vrf.waitForDeployment();
  const birds = await ethers.deployContract(
    "EggoriaBirds",
    [await admin.getAddress(), await vrf.getAddress()],
    admin,
  );
  await birds.waitForDeployment();
  return { birds, vrf };
}

async function evolveTestBirdToSoarling(ethers, birds, owner, tokenId) {
  await ethers.provider.send("evm_increaseTime", [9 * 86_400]);
  await ethers.provider.send("evm_mine", []);
  await (await birds.connect(owner).checkIn(tokenId)).wait();

  const fledgling = await birds.tokenState(tokenId);
  assert.equal(fledgling.checkIns, 10n);
  assert.equal(fledgling.stage, 1n);
  assert.ok(fledgling.lastCheckInDay > 0n);

  await ethers.provider.send("evm_increaseTime", [9 * 86_400]);
  await ethers.provider.send("evm_mine", []);
  await (await birds.connect(owner).checkIn(tokenId)).wait();
}

test("assigns lands from weighted remaining inventory and preserves rarity quotas", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const { birds, vrf } = await deployBirds(ethers, admin);
  const vrfFee = await vrf.FEE();

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

    await (await birds.connect(minter).mint({ value: vrfFee })).wait();
    const tokenId = BigInt(index + 1);

    assert.equal(await birds.mintedTokenOf(address), tokenId);
    assert.equal(await birds.tokenURI(tokenId), "");
    await expectRevert(
      () => birds.tokenLand(tokenId),
      "tokenLand should revert while the land is pending",
    );

    await (await vrf.fulfill(tokenId, ethers.ZeroHash)).wait();
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

  await (await birds.connect(nextMinter).mint({ value: vrfFee })).wait();
  const fulfillment = await vrf.fulfill(101, ethers.ZeroHash);
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
    () => vrf.fulfill(101, ethers.id("second callback")),
    "a token must not receive a second land",
  );
  await expectRevert(
    () => birds.connect(nextMinter).mint(),
    "one-wallet mint enforcement must remain active",
  );
  await expectRevert(
    () => birds.rawFulfillRandomness(999, ethers.ZeroHash),
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

test("admin can seed a fresh bird at zero check-ins", async () => {
  const { ethers } = await network.connect();
  const [admin, owner, stranger] = await ethers.getSigners();
  const { birds } = await deployBirds(ethers, admin);
  const ownerAddress = await owner.getAddress();

  await assert.rejects(
    () => birds.connect(stranger).seedTestBird(ownerAddress, 1, 0),
    /AccessControlUnauthorizedAccount/,
  );

  await (await birds.seedTestBird(ownerAddress, 1, 0)).wait();
  const before = await birds.tokenState(1);
  assert.equal(before.land, 1n);
  assert.equal(before.stage, 0n);
  assert.equal(before.checkIns, 0n);
  assert.equal(before.lastCheckInDay, 0n);

  await expectRevert(
    () => birds.connect(owner).checkIn(1),
    "the on-chain checkpoint must remain locked until day ten",
  );
  await ethers.provider.send("evm_increaseTime", [9 * 86_400]);
  await ethers.provider.send("evm_mine", []);
  await (await birds.connect(owner).checkIn(1)).wait();
  const after = await birds.tokenState(1);
  assert.equal(after.stage, 1n);
  assert.equal(after.checkIns, 10n);
  assert.ok(after.lastCheckInDay > 0n);
});

test("D20 callbacks alone assign land and day-20 rarity, with expired-request retry", async () => {
  const { ethers } = await network.connect();
  const [admin, owner, secondOwner] = await ethers.getSigners();
  const { birds, vrf } = await deployBirds(ethers, admin);
  const fee = await vrf.FEE();
  await (await birds.setMintingEnabled(true)).wait();

  await expectRevert(
    () => birds.connect(owner).mint(),
    "mint must include the live VRF fee",
  );
  await (await birds.connect(owner).mint({ value: fee })).wait();
  assert.equal(await birds.activeRandomnessRequest(1), 1n);
  await expectRevert(
    () => birds.connect(admin).rawFulfillRandomness(1, ethers.ZeroHash),
    "an admin must not be able to forge a VRF callback",
  );
  await (await vrf.fulfill(1, ethers.ZeroHash)).wait();
  assert.equal(await birds.tokenLand(1), 0n);
  assert.equal(await birds.activeRandomnessRequest(1), 0n);

  await ethers.provider.send("evm_increaseTime", [9 * 86_400]);
  await ethers.provider.send("evm_mine", []);
  await (await birds.connect(owner).checkIn(1)).wait();
  await ethers.provider.send("evm_increaseTime", [9 * 86_400]);
  await ethers.provider.send("evm_mine", []);
  await (await birds.connect(owner).checkIn(1, { value: fee })).wait();
  let state = await birds.tokenState(1);
  assert.equal(state.checkIns, 20n);
  assert.equal(state.stage, 1n);
  assert.equal(state.rarityAssigned, false);
  assert.equal(await birds.activeRandomnessRequest(1), 2n);
  await (await vrf.fulfill(2, ethers.ZeroHash)).wait();
  state = await birds.tokenState(1);
  assert.equal(state.stage, 2n);
  assert.equal(state.rarity, 0n);
  assert.equal(state.rarityAssigned, true);

  await (await birds.connect(secondOwner).mint({ value: fee })).wait();
  assert.equal(await birds.activeRandomnessRequest(2), 3n);
  await (await vrf.refund(3)).wait();
  assert.equal(await birds.activeRandomnessRequest(2), 0n);
  await (await birds.connect(secondOwner).retryRandomness(2, { value: fee })).wait();
  assert.equal(await birds.activeRandomnessRequest(2), 4n);
});

test("QA land rotation remains explicit and never uses block producer randomness", async () => {
  const { ethers } = await network.connect();
  const [admin, firstOwner, secondOwner, thirdOwner, fourthOwner, fifthOwner] = await ethers.getSigners();
  const { birds } = await deployBirds(ethers, admin);
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
  await (await birds.setEvolutionLegendaryRotationMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  const firstFiveOwners = [firstOwner, secondOwner, thirdOwner, fourthOwner, fifthOwner];
  const mintedByLand = [0, 0, 0, 0, 0];
  for (const [index, owner] of firstFiveOwners.entries()) {
    await (await birds.connect(owner).mint()).wait();
    const bird = await birds.tokenState(index + 1);
    assert.equal(bird.landAssigned, true);
    const land = Number(bird.land);
    mintedByLand[land] += 1;
    assert.equal(await birds.landMinted(land), BigInt(mintedByLand[land]));
    assert.equal(await birds.landRemaining(land), BigInt(100 - mintedByLand[land]));
    assert.equal(bird.checkIns, 0n);
    assert.equal(bird.stage, 0n);
  }
  assert.equal(await birds.totalLandsAssigned(), 5n);

  for (let index = 0; index < 495; index += 1) {
    const address = `0x${(0x30_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    await (await birds.connect(await ethers.getSigner(address)).mint()).wait();
    const tokenId = index + 6;
    const land = Number(await birds.tokenLand(tokenId));
    mintedByLand[land] += 1;
    assert.equal(await birds.landMinted(land), BigInt(mintedByLand[land]));
    assert.equal(await birds.landRemaining(land), BigInt(100 - mintedByLand[land]));
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 100n);
    assert.equal(mintedByLand[land], 100);
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
  const { birds } = await deployBirds(ethers, admin);
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
    await evolveTestBirdToSoarling(ethers, birds, owner, tokenId);
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
  const { birds } = await deployBirds(ethers, admin);
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
    await evolveTestBirdToSoarling(ethers, birds, owner, index + 1);
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

test("legendary rotation repeats one Legendary mint per land without consuming quotas", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const { birds } = await deployBirds(ethers, admin);
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setEvolutionLegendaryRotationMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  for (let index = 0; index < 20; index += 1) {
    const address = `0x${(0x70_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const owner = await ethers.getSigner(address);
    const tokenId = index + 1;
    await (await birds.connect(owner).mint()).wait();
    assert.equal(await birds.tokenLand(tokenId), BigInt(index % 5));
    await evolveTestBirdToSoarling(ethers, birds, owner, tokenId);
    const state = await birds.tokenState(tokenId);
    assert.equal(state.stage, 2n);
    assert.equal(state.rarityAssigned, true);
    assert.equal(state.rarity, 3n);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 4n);
    assert.equal(await birds.landRarityRemaining(land, 3), 4n);
    assert.equal(await birds.landRarityPoolRemaining(land), 100n);
  }
  assert.equal(await birds.rarityRemaining(3), 20n);
  assert.equal(await birds.rarityPoolRemaining(), 500n);
});

test("epic rotation repeats one Epic mint per land without consuming quotas", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const { birds } = await deployBirds(ethers, admin);
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setEvolutionEpicRotationMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  for (let index = 0; index < 10; index += 1) {
    const address = `0x${(0x80_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const owner = await ethers.getSigner(address);
    const tokenId = index + 1;
    await (await birds.connect(owner).mint()).wait();
    assert.equal(await birds.tokenLand(tokenId), BigInt(index % 5));
    await evolveTestBirdToSoarling(ethers, birds, owner, tokenId);
    const state = await birds.tokenState(tokenId);
    assert.equal(state.stage, 2n);
    assert.equal(state.rarityAssigned, true);
    assert.equal(state.rarity, 2n);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 2n);
    assert.equal(await birds.landRarityRemaining(land, 2), 10n);
    assert.equal(await birds.landRarityPoolRemaining(land), 100n);
  }
  assert.equal(await birds.rarityRemaining(2), 50n);
  assert.equal(await birds.rarityPoolRemaining(), 500n);
});

test("rare/common rotation repeats five Rare then five Common birds without consuming quotas", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const { birds } = await deployBirds(ethers, admin);
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setEvolutionRareCommonRotationMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  for (let index = 0; index < 20; index += 1) {
    const address = `0x${(0x90_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const owner = await ethers.getSigner(address);
    const tokenId = index + 1;
    await (await birds.connect(owner).mint()).wait();
    assert.equal(await birds.tokenLand(tokenId), BigInt(index % 5));
    await evolveTestBirdToSoarling(ethers, birds, owner, tokenId);
    const state = await birds.tokenState(tokenId);
    assert.equal(state.stage, 2n);
    assert.equal(state.rarityAssigned, true);
    assert.equal(state.rarity, index % 10 < 5 ? 1n : 0n);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 4n);
    assert.equal(await birds.landRarityRemaining(land, 0), 60n);
    assert.equal(await birds.landRarityRemaining(land, 1), 25n);
    assert.equal(await birds.landRarityPoolRemaining(land), 100n);
  }
  assert.equal(await birds.rarityRemaining(0), 300n);
  assert.equal(await birds.rarityRemaining(1), 125n);
  assert.equal(await birds.rarityPoolRemaining(), 500n);
});

test("all-rarity rotation repeats Common through Mythic with five lands per rarity", async () => {
  const { ethers } = await network.connect();
  const [admin] = await ethers.getSigners();
  const { birds } = await deployBirds(ethers, admin);
  await (await birds.setEvolutionTestMode(true)).wait();
  await (await birds.setEvolutionAllRarityRotationMode(true)).wait();
  await (await birds.setMintingEnabled(true)).wait();

  for (let index = 0; index < 50; index += 1) {
    const address = `0x${(0xa0_000 + index).toString(16).padStart(40, "0")}`;
    await ethers.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    const owner = await ethers.getSigner(address);
    const tokenId = index + 1;
    await (await birds.connect(owner).mint()).wait();
    assert.equal(await birds.tokenLand(tokenId), BigInt(index % 5));
    await evolveTestBirdToSoarling(ethers, birds, owner, tokenId);
    const state = await birds.tokenState(tokenId);
    assert.equal(state.stage, 2n);
    assert.equal(state.rarityAssigned, true);
    assert.equal(state.rarity, BigInt(Math.floor((index % 25) / 5)));
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
  }

  for (let land = 0; land < 5; land += 1) {
    assert.equal(await birds.landMinted(land), 10n);
    assert.equal(await birds.landRarityPoolRemaining(land), 100n);
  }
  assert.equal(await birds.rarityPoolRemaining(), 500n);
});
