// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMockD20VRFConsumer {
    function rawFulfillRandomness(uint256 requestId, bytes32 randomness) external;
    function onRefund(uint256 requestId) external;
}

contract MockD20VRFCoordinator {
    uint256 public constant FEE = 0.08 ether;
    uint256 public nextRequestId = 1;
    mapping(uint256 requestId => address consumer) public consumers;

    error IncorrectFee();
    error UnknownRequest();

    function quoteFee(uint32) external pure returns (uint256) {
        return FEE;
    }

    function quoteFeeAt(uint32, uint256) external pure returns (uint256) {
        return FEE;
    }

    function requestRandomness(bytes32, uint32, address) external payable returns (uint256 requestId) {
        if (msg.value != FEE) revert IncorrectFee();
        requestId = nextRequestId++;
        consumers[requestId] = msg.sender;
    }

    function fulfill(uint256 requestId, bytes32 randomness) external {
        address consumer = consumers[requestId];
        if (consumer == address(0)) revert UnknownRequest();
        IMockD20VRFConsumer(consumer).rawFulfillRandomness(requestId, randomness);
    }

    function refund(uint256 requestId) external {
        address consumer = consumers[requestId];
        if (consumer == address(0)) revert UnknownRequest();
        IMockD20VRFConsumer(consumer).onRefund(requestId);
    }
}
