// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EggoriaBirds} from "./EggoriaBirds.sol";

/// @title Eggoria Birds QA Testnet
/// @notice Test-only deployment that permits immediate on-chain evolution checkpoints.
/// @dev Never deploy this contract to production. All mint, ownership, quota, and VRF rules remain active.
contract EggoriaBirdsTestnet is EggoriaBirds {
    constructor(address initialAdmin, address coordinator) EggoriaBirds(initialAdmin, coordinator) {}

    function _enforceCheckpointTime(uint256, uint64) internal pure override {}
}
