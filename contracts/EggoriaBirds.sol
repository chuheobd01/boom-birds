// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {D20VRFConsumer} from "@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol";
import {ID20VRF} from "@d20dao/vrf-sdk/contracts/interfaces/ID20VRF.sol";

/// @title Eggoria Birds
/// @notice A 500-item evolving ERC-721 collection distributed evenly across five lands.
/// @dev Land and rarity draws are fulfilled only by the authenticated D20 VRF coordinator.
contract EggoriaBirds is ERC721, AccessControl, D20VRFConsumer {
    uint256 public constant MAX_SUPPLY = 500;
    uint8 public constant LAND_COUNT = 5;
    uint16 public constant LAND_MAX_SUPPLY = 100;
    uint8 public constant INTERMEDIATE_CHECK_INS = 10;
    uint8 public constant ADVANCED_CHECK_INS = 20;

    bytes32 public constant METADATA_ROLE = keccak256("METADATA_ROLE");
    uint32 public constant LAND_CALLBACK_GAS = 220_000;
    uint32 public constant RARITY_CALLBACK_GAS = 260_000;

    enum RandomnessPurpose {
        None,
        Land,
        Rarity
    }

    struct RandomnessRequest {
        uint256 tokenId;
        RandomnessPurpose purpose;
        bool pending;
    }

    enum Stage {
        Primary,
        Intermediate,
        Advanced
    }

    enum Rarity {
        Common,
        Rare,
        Epic,
        Legendary,
        Mythic
    }

    struct Bird {
        uint64 lastCheckInDay;
        uint8 land;
        uint8 checkIns;
        Stage stage;
        Rarity rarity;
        bool landAssigned;
        bool rarityAssigned;
    }

    uint256 public totalMinted;
    uint16 public totalLandsAssigned;
    bool public mintingEnabled;
    bool public evolutionTestMode;
    bool public evolutionShowcaseMode;
    bool public evolutionPairRotationMode;
    bool public evolutionLegendaryRotationMode;
    bool public evolutionEpicRotationMode;
    bool public evolutionRareCommonRotationMode;
    bool public evolutionAllRarityRotationMode;
    uint8 public evolutionTestLand; // First land in the five-mint QA rotation.
    Rarity public evolutionTestRarity = Rarity.Legendary;

    mapping(address account => bool minted) public hasMinted;
    mapping(address account => uint256 tokenId) public mintedTokenOf;
    mapping(uint256 tokenId => Bird bird) public birds;
    mapping(uint256 tokenId => uint64 day) public mintedAtDay;
    mapping(uint256 requestId => RandomnessRequest request) public randomnessRequests;
    mapping(uint256 tokenId => uint256 requestId) public activeRandomnessRequest;
    uint16[LAND_COUNT] public landMinted;

    // Exact full-collection quotas: 60%, 25%, 10%, 4%, 1% of 500.
    uint16[5] private _rarityRemaining = [uint16(300), 125, 50, 20, 5];
    uint16 private _rarityPoolRemaining = 500;
    // Each 100-bird land independently contains 60/25/10/4/1 rarities.
    uint16[5][LAND_COUNT] private _landRarityRemaining;
    uint16[LAND_COUNT] private _landRarityPoolRemaining;

    string[LAND_COUNT] private _primaryUris;
    string[LAND_COUNT] private _intermediateUris;
    mapping(uint8 land => mapping(uint8 rarity => string uri)) private _advancedUris;
    string private _contractUri;

    error MintingDisabled();
    error MaxSupplyReached();
    error WalletAlreadyMinted();
    error InvalidLand();
    error InvalidStage();
    error NotTokenOwner();
    error LandNotAssigned();
    error LandAlreadyAssigned();
    error LandPoolEmpty();
    error AlreadyCheckedInToday();
    error CheckpointNotReady(uint64 eligibleDay);
    error EvolutionAlreadyComplete();
    error RarityNotRequested();
    error RarityAlreadyAssigned();
    error RarityPoolEmpty();
    error InvalidTestCheckIns();
    error RandomnessFeeUnderpaid(uint256 required, uint256 supplied);
    error RandomnessChangeRefundFailed();
    error UnexpectedRandomnessCallback();
    error RandomnessRequestPending();
    error RandomnessNotRequired();

    event LandRequested(uint256 indexed tokenId, address indexed owner);
    event BirdMinted(uint256 indexed tokenId, address indexed owner, uint8 indexed land);
    event BirdCheckedIn(uint256 indexed tokenId, uint8 checkIns, uint64 day);
    event BirdEvolved(uint256 indexed tokenId, Stage stage);
    event RarityRequested(uint256 indexed tokenId, address indexed owner);
    event RarityAssigned(uint256 indexed tokenId, Rarity rarity, uint256 randomWord);
    event RandomnessRequested(uint256 indexed requestId, uint256 indexed tokenId, RandomnessPurpose purpose);
    event RandomnessRequestRefunded(uint256 indexed requestId, uint256 indexed tokenId, RandomnessPurpose purpose);
    event MintingStatusChanged(bool enabled);
    event EvolutionTestModeChanged(bool enabled);
    event EvolutionShowcaseModeChanged(bool enabled);
    event EvolutionPairRotationModeChanged(bool enabled);
    event EvolutionTestLandChanged(uint8 indexed land);
    event EvolutionTestRarityChanged(Rarity rarity);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event TestBirdSeeded(uint256 indexed tokenId, address indexed owner, uint8 indexed land, uint8 checkIns);

    constructor(address initialAdmin, address coordinator)
        ERC721("Eggoria Birds", "EGBIRD")
        D20VRFConsumer(coordinator)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(METADATA_ROLE, initialAdmin);

        for (uint8 land; land < LAND_COUNT; ++land) {
            _landRarityRemaining[land] = [uint16(60), 25, 10, 4, 1];
            _landRarityPoolRemaining[land] = LAND_MAX_SUPPLY;
        }
    }

    /// @notice Mints one bird with its land pending secure random fulfillment.
    function mint() external payable returns (uint256 tokenId) {
        if (!mintingEnabled) revert MintingDisabled();
        if (totalMinted >= MAX_SUPPLY) revert MaxSupplyReached();
        if (hasMinted[msg.sender]) revert WalletAlreadyMinted();

        tokenId = ++totalMinted;
        hasMinted[msg.sender] = true;
        mintedTokenOf[msg.sender] = tokenId;
        mintedAtDay[tokenId] = uint64(block.timestamp / 1 days);

        uint8 testLand;
        bool qaRotation = evolutionTestMode && _qaRotationEnabled();
        if (qaRotation) {
            if (
                evolutionLegendaryRotationMode || evolutionEpicRotationMode || evolutionRareCommonRotationMode
                    || evolutionAllRarityRotationMode
            ) {
                testLand = uint8((uint256(evolutionTestLand) + tokenId - 1) % LAND_COUNT);
            } else if (evolutionPairRotationMode) {
                testLand = uint8(((tokenId - 1) / 2) % LAND_COUNT);
            } else if (evolutionShowcaseMode && tokenId <= 12) {
                testLand = uint8((tokenId - 1) / 3 + 1);
            }
            if (landMinted[testLand] >= LAND_MAX_SUPPLY) revert LandPoolEmpty();
            Bird storage bird = birds[tokenId];
            bird.land = testLand;
            bird.landAssigned = true;
            // Freshly minted test birds follow the same 0-check-in starting
            // state as production birds. Test mode only assigns the land early.
            bird.checkIns = 0;
            landMinted[testLand] += 1;
            totalLandsAssigned += 1;
        }

        _safeMint(msg.sender, tokenId);
        if (qaRotation) {
            _refundChange(msg.value);
            emit BirdMinted(tokenId, msg.sender, testLand);
            emit MetadataUpdate(tokenId);
        } else {
            emit LandRequested(tokenId, msg.sender);
            _requestRandomness(tokenId, RandomnessPurpose.Land, LAND_CALLBACK_GAS, msg.value);
        }
    }

    /// @notice Seeds an owned bird at a chosen pre-evolution check-in count for testnet QA.
    /// @dev This admin-only helper must not be used for a production deployment.
    function seedTestBird(address recipient, uint8 land, uint8 checkIns)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 tokenId)
    {
        _validateLand(land);
        if (checkIns >= INTERMEDIATE_CHECK_INS) revert InvalidTestCheckIns();
        if (totalMinted >= MAX_SUPPLY) revert MaxSupplyReached();
        if (hasMinted[recipient]) revert WalletAlreadyMinted();
        if (landMinted[land] >= LAND_MAX_SUPPLY) revert LandPoolEmpty();

        tokenId = ++totalMinted;
        hasMinted[recipient] = true;
        mintedTokenOf[recipient] = tokenId;
        mintedAtDay[tokenId] = uint64(block.timestamp / 1 days);

        Bird storage bird = birds[tokenId];
        bird.land = land;
        bird.landAssigned = true;
        bird.checkIns = checkIns;
        bird.stage = Stage.Primary;
        landMinted[land] += 1;
        totalLandsAssigned += 1;

        _safeMint(recipient, tokenId);
        emit BirdMinted(tokenId, recipient, land);
        emit TestBirdSeeded(tokenId, recipient, land, checkIns);
        emit MetadataUpdate(tokenId);
    }

    function _fulfillLand(uint256 tokenId, uint256 randomWord) private {
        address owner = ownerOf(tokenId);
        Bird storage bird = birds[tokenId];
        if (bird.landAssigned) revert LandAlreadyAssigned();

        uint8 selected = _pickAvailableLand(randomWord);

        bird.land = selected;
        bird.landAssigned = true;
        landMinted[selected] += 1;
        totalLandsAssigned += 1;

        emit BirdMinted(tokenId, owner, selected);
        emit MetadataUpdate(tokenId);
    }

    /// @notice Commits ten off-chain daily check-ins at the 10-day evolution checkpoint.
    /// @dev The UI stores days 1-9 off-chain. The owner submits only checkpoints 10 and 20.
    function checkIn(uint256 tokenId) external payable {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        Bird storage bird = birds[tokenId];
        if (!bird.landAssigned) revert LandNotAssigned();
        if (bird.checkIns >= ADVANCED_CHECK_INS) revert EvolutionAlreadyComplete();

        uint64 today = uint64(block.timestamp / 1 days);
        _enforceCheckpointTime(tokenId, today);

        bird.lastCheckInDay = today;
        bird.checkIns += INTERMEDIATE_CHECK_INS;
        emit BirdCheckedIn(tokenId, bird.checkIns, today);

        if (bird.checkIns == INTERMEDIATE_CHECK_INS) {
            bird.stage = Stage.Intermediate;
            emit BirdEvolved(tokenId, Stage.Intermediate);
            emit MetadataUpdate(tokenId);
            _refundChange(msg.value);
        } else if (bird.checkIns == ADVANCED_CHECK_INS) {
            emit RarityRequested(tokenId, msg.sender);
            if (evolutionTestMode && _qaRotationEnabled()) {
                _refundChange(msg.value);
                if (evolutionAllRarityRotationMode) {
                    _fulfillAllRarityRotationTestRarity(tokenId);
                    return;
                }
                if (evolutionRareCommonRotationMode) {
                    _fulfillRareCommonRotationTestRarity(tokenId);
                    return;
                }
                if (evolutionEpicRotationMode) {
                    _fulfillEpicRotationTestRarity(tokenId);
                    return;
                }
                if (evolutionLegendaryRotationMode) {
                    _fulfillLegendaryRotationTestRarity(tokenId);
                    return;
                }
                if (evolutionPairRotationMode) {
                    _fulfillPairTestRarity(tokenId);
                    return;
                }
                uint8 selected = evolutionShowcaseMode && tokenId <= 12
                    ? uint8(tokenId <= 3 ? Rarity.Epic : Rarity.Legendary)
                    : uint8(evolutionTestRarity);
                // QA keeps the real 60/25/10/4/1 quotas: once the chosen rarity
                // is exhausted, use the first remaining slot in this land.
                if (_landRarityRemaining[bird.land][selected] == 0) {
                    for (uint8 i; i < 5; ++i) {
                        if (_landRarityRemaining[bird.land][i] > 0) {
                            selected = i;
                            break;
                        }
                    }
                }
                uint256 pick;
                for (uint8 i; i < selected; ++i) {
                    pick += _landRarityRemaining[bird.land][i];
                }
                _fulfillRarity(tokenId, pick);
            } else {
                _requestRandomness(tokenId, RandomnessPurpose.Rarity, RARITY_CALLBACK_GAS, msg.value);
            }
        }
    }

    /// @dev Enforces the production checkpoint interval. QA deployments may override this hook.
    function _enforceCheckpointTime(uint256 tokenId, uint64 today) internal view virtual {
        Bird storage bird = birds[tokenId];
        uint64 previousCheckpointDay = bird.lastCheckInDay == 0 ? mintedAtDay[tokenId] : bird.lastCheckInDay;
        uint64 eligibleDay = previousCheckpointDay + 9;
        if (today < eligibleDay) revert CheckpointNotReady(eligibleDay);
    }

    /// @notice Re-requests the same unresolved draw only after the coordinator has refunded an expired request.
    function retryRandomness(uint256 tokenId) external payable returns (uint256 requestId) {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (activeRandomnessRequest[tokenId] != 0) revert RandomnessRequestPending();
        Bird memory bird = birds[tokenId];
        if (!bird.landAssigned) {
            return _requestRandomness(tokenId, RandomnessPurpose.Land, LAND_CALLBACK_GAS, msg.value);
        }
        if (bird.checkIns == ADVANCED_CHECK_INS && bird.stage == Stage.Intermediate && !bird.rarityAssigned) {
            return _requestRandomness(tokenId, RandomnessPurpose.Rarity, RARITY_CALLBACK_GAS, msg.value);
        }
        revert RandomnessNotRequired();
    }

    function _requestRandomness(
        uint256 tokenId,
        RandomnessPurpose purpose,
        uint32 callbackGasLimit,
        uint256 supplied
    ) private returns (uint256 requestId) {
        if (activeRandomnessRequest[tokenId] != 0) revert RandomnessRequestPending();
        ID20VRF rng = ID20VRF(vrfCoordinator);
        uint256 fee = rng.quoteFee(callbackGasLimit);
        if (supplied < fee) revert RandomnessFeeUnderpaid(fee, supplied);
        requestId = rng.requestRandomness{value: fee}(
            keccak256(abi.encode(address(this), block.chainid, tokenId, purpose)),
            callbackGasLimit,
            msg.sender
        );
        randomnessRequests[requestId] = RandomnessRequest(tokenId, purpose, true);
        activeRandomnessRequest[tokenId] = requestId;
        emit RandomnessRequested(requestId, tokenId, purpose);
        _refundChange(supplied - fee);
    }

    function _refundChange(uint256 amount) private {
        if (amount == 0) return;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert RandomnessChangeRefundFailed();
    }

    function _fulfillRandomness(uint256 requestId, bytes32 randomness) internal override {
        RandomnessRequest storage request = randomnessRequests[requestId];
        if (!request.pending || activeRandomnessRequest[request.tokenId] != requestId) {
            revert UnexpectedRandomnessCallback();
        }
        request.pending = false;
        activeRandomnessRequest[request.tokenId] = 0;
        if (request.purpose == RandomnessPurpose.Land) {
            _fulfillLand(request.tokenId, uint256(randomness));
        } else if (request.purpose == RandomnessPurpose.Rarity) {
            _fulfillRarity(request.tokenId, uint256(randomness));
        } else {
            revert UnexpectedRandomnessCallback();
        }
    }

    function _onRefund(uint256 requestId) internal override {
        RandomnessRequest storage request = randomnessRequests[requestId];
        if (!request.pending || activeRandomnessRequest[request.tokenId] != requestId) return;
        request.pending = false;
        activeRandomnessRequest[request.tokenId] = 0;
        emit RandomnessRequestRefunded(requestId, request.tokenId, request.purpose);
    }

    function _fulfillRarity(uint256 tokenId, uint256 randomWord) private {
        Bird storage bird = birds[tokenId];
        if (bird.rarityAssigned) revert RarityAlreadyAssigned();
        if (bird.checkIns != ADVANCED_CHECK_INS || bird.stage != Stage.Intermediate) revert RarityNotRequested();
        uint8 land = bird.land;
        uint16 landPoolRemaining = _landRarityPoolRemaining[land];
        if (landPoolRemaining == 0) revert RarityPoolEmpty();

        uint256 pick = randomWord % landPoolRemaining;
        uint256 cumulative;
        uint8 selected;

        for (uint8 i; i < 5; ++i) {
            cumulative += _landRarityRemaining[land][i];
            if (pick < cumulative) {
                selected = i;
                _landRarityRemaining[land][i] -= 1;
                _rarityRemaining[i] -= 1;
                break;
            }
        }

        _landRarityPoolRemaining[land] -= 1;
        _rarityPoolRemaining -= 1;
        bird.rarity = Rarity(selected);
        bird.rarityAssigned = true;
        bird.stage = Stage.Advanced;

        emit BirdEvolved(tokenId, Stage.Advanced);
        emit RarityAssigned(tokenId, bird.rarity, randomWord);
        emit MetadataUpdate(tokenId);
    }

    /// @dev QA-only deterministic rarity; production rarity quotas are deliberately untouched.
    function _fulfillPairTestRarity(uint256 tokenId) private {
        Bird storage bird = birds[tokenId];
        if (bird.rarityAssigned) revert RarityAlreadyAssigned();
        if (bird.checkIns != ADVANCED_CHECK_INS || bird.stage != Stage.Intermediate) revert RarityNotRequested();

        // Each ten-mint cycle has two birds per land. Artist's second bird is Legendary.
        bird.rarity = (tokenId - 1) % 10 == 7 ? Rarity.Legendary : Rarity.Mythic;
        bird.rarityAssigned = true;
        bird.stage = Stage.Advanced;

        emit BirdEvolved(tokenId, Stage.Advanced);
        emit RarityAssigned(tokenId, bird.rarity, 0);
        emit MetadataUpdate(tokenId);
    }

    /// @dev QA-only Legendary assignment; production rarity quotas are deliberately untouched.
    function _fulfillLegendaryRotationTestRarity(uint256 tokenId) private {
        Bird storage bird = birds[tokenId];
        if (bird.rarityAssigned) revert RarityAlreadyAssigned();
        if (bird.checkIns != ADVANCED_CHECK_INS || bird.stage != Stage.Intermediate) revert RarityNotRequested();

        bird.rarity = Rarity.Legendary;
        bird.rarityAssigned = true;
        bird.stage = Stage.Advanced;

        emit BirdEvolved(tokenId, Stage.Advanced);
        emit RarityAssigned(tokenId, bird.rarity, 0);
        emit MetadataUpdate(tokenId);
    }

    /// @dev QA-only Epic assignment; production rarity quotas are deliberately untouched.
    function _fulfillEpicRotationTestRarity(uint256 tokenId) private {
        Bird storage bird = birds[tokenId];
        if (bird.rarityAssigned) revert RarityAlreadyAssigned();
        if (bird.checkIns != ADVANCED_CHECK_INS || bird.stage != Stage.Intermediate) revert RarityNotRequested();

        bird.rarity = Rarity.Epic;
        bird.rarityAssigned = true;
        bird.stage = Stage.Advanced;

        emit BirdEvolved(tokenId, Stage.Advanced);
        emit RarityAssigned(tokenId, bird.rarity, 0);
        emit MetadataUpdate(tokenId);
    }

    /// @dev QA-only rotation: five Rare birds, then five Common birds, repeating.
    ///      Production rarity quotas are deliberately untouched.
    function _fulfillRareCommonRotationTestRarity(uint256 tokenId) private {
        Bird storage bird = birds[tokenId];
        if (bird.rarityAssigned) revert RarityAlreadyAssigned();
        if (bird.checkIns != ADVANCED_CHECK_INS || bird.stage != Stage.Intermediate) revert RarityNotRequested();

        bird.rarity = (tokenId - 1) % 10 < 5 ? Rarity.Rare : Rarity.Common;
        bird.rarityAssigned = true;
        bird.stage = Stage.Advanced;

        emit BirdEvolved(tokenId, Stage.Advanced);
        emit RarityAssigned(tokenId, bird.rarity, 0);
        emit MetadataUpdate(tokenId);
    }

    /// @dev QA-only rotation: five lands per rarity from Common through Mythic, repeating.
    ///      Production rarity quotas are deliberately untouched.
    function _fulfillAllRarityRotationTestRarity(uint256 tokenId) private {
        Bird storage bird = birds[tokenId];
        if (bird.rarityAssigned) revert RarityAlreadyAssigned();
        if (bird.checkIns != ADVANCED_CHECK_INS || bird.stage != Stage.Intermediate) revert RarityNotRequested();

        bird.rarity = Rarity(uint8(((tokenId - 1) / LAND_COUNT) % 5));
        bird.rarityAssigned = true;
        bird.stage = Stage.Advanced;

        emit BirdEvolved(tokenId, Stage.Advanced);
        emit RarityAssigned(tokenId, bird.rarity, 0);
        emit MetadataUpdate(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        Bird memory bird = birds[tokenId];
        if (!bird.landAssigned) return "";

        if (bird.stage == Stage.Primary) return _primaryUris[bird.land];
        if (bird.stage == Stage.Intermediate) return _intermediateUris[bird.land];
        return _advancedUris[bird.land][uint8(bird.rarity)];
    }

    /// @notice Returns the number of Eggoria Birds minted so far.
    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    /// @notice Returns the remaining mint inventory for one land.
    function landRemaining(uint8 land) external view returns (uint16) {
        _validateLand(land);
        return LAND_MAX_SUPPLY - landMinted[land];
    }

    /// @notice Returns a token's assigned land and reverts while assignment is pending.
    function tokenLand(uint256 tokenId) external view returns (uint8) {
        ownerOf(tokenId);
        Bird memory bird = birds[tokenId];
        if (!bird.landAssigned) revert LandNotAssigned();
        return bird.land;
    }

    /// @notice Returns the owner and complete evolution state for one token.
    function tokenState(uint256 tokenId)
        external
        view
        returns (
            address owner,
            uint8 land,
            bool landAssigned,
            Stage stage,
            Rarity rarity,
            bool rarityAssigned,
            uint8 checkIns,
            uint64 lastCheckInDay
        )
    {
        owner = ownerOf(tokenId);
        Bird memory bird = birds[tokenId];
        return (
            owner,
            bird.land,
            bird.landAssigned,
            bird.stage,
            bird.rarity,
            bird.rarityAssigned,
            bird.checkIns,
            bird.lastCheckInDay
        );
    }

    function setMintingEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintingEnabled = enabled;
        emit MintingStatusChanged(enabled);
    }

    /// @notice Makes newly minted testnet birds immediately land-assigned from check-in 0.
    /// @dev Keep disabled for production deployments.
    function setEvolutionTestMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionTestMode = enabled;
        emit EvolutionTestModeChanged(enabled);
    }

    /// @notice QA only: first 12 mints are 3 Wind Epic, then 3 each Wizard, Artist and King Legendary.
    function setEvolutionShowcaseMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionShowcaseMode = enabled;
        emit EvolutionShowcaseModeChanged(enabled);
    }

    /// @notice QA only: two mints per land, all Mythic except the second Artist bird (Legendary).
    function setEvolutionPairRotationMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionPairRotationMode = enabled;
        emit EvolutionPairRotationModeChanged(enabled);
    }

    /// @notice QA only: one mint per land in sequence, always Legendary, repeating every five mints.
    function setEvolutionLegendaryRotationMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionLegendaryRotationMode = enabled;
    }

    /// @notice QA only: one mint per land in sequence, always Epic, repeating every five mints.
    function setEvolutionEpicRotationMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionEpicRotationMode = enabled;
    }

    /// @notice QA only: five Rare mints (one per land), followed by five Common mints, repeating.
    function setEvolutionRareCommonRotationMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionRareCommonRotationMode = enabled;
    }

    /// @notice QA only: Common through Mythic, five lands per rarity, repeating every 25 mints.
    function setEvolutionAllRarityRotationMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionAllRarityRotationMode = enabled;
    }

    /// @notice Chooses the first land in each five-mint test-mode rotation.
    function setEvolutionTestLand(uint8 land) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _validateLand(land);
        evolutionTestLand = land;
        emit EvolutionTestLandChanged(land);
    }

    /// @notice Chooses the preferred rarity for test-mode evolutions.
    function setEvolutionTestRarity(Rarity rarity) external onlyRole(DEFAULT_ADMIN_ROLE) {
        evolutionTestRarity = rarity;
        emit EvolutionTestRarityChanged(rarity);
    }

    function setStageURI(uint8 land, Stage stage, string calldata uri) external onlyRole(METADATA_ROLE) {
        _validateLand(land);
        if (stage == Stage.Advanced) revert InvalidStage();

        if (stage == Stage.Primary) _primaryUris[land] = uri;
        else _intermediateUris[land] = uri;
        _emitMetadataRefresh();
    }

    function setAdvancedURI(uint8 land, Rarity rarity, string calldata uri) external onlyRole(METADATA_ROLE) {
        _validateLand(land);
        _advancedUris[land][uint8(rarity)] = uri;
        _emitMetadataRefresh();
    }

    function setContractURI(string calldata uri) external onlyRole(METADATA_ROLE) {
        _contractUri = uri;
    }

    function contractURI() external view returns (string memory) {
        return _contractUri;
    }

    function rarityRemaining(Rarity rarity) external view returns (uint16) {
        return _rarityRemaining[uint8(rarity)];
    }

    function rarityPoolRemaining() external view returns (uint16) {
        return _rarityPoolRemaining;
    }

    function landRarityRemaining(uint8 land, Rarity rarity) external view returns (uint16) {
        _validateLand(land);
        return _landRarityRemaining[land][uint8(rarity)];
    }

    function landRarityPoolRemaining(uint8 land) external view returns (uint16) {
        _validateLand(land);
        return _landRarityPoolRemaining[land];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }

    function _validateLand(uint8 land) private pure {
        if (land >= LAND_COUNT) revert InvalidLand();
    }

    function _qaRotationEnabled() private view returns (bool) {
        return evolutionShowcaseMode || evolutionPairRotationMode || evolutionLegendaryRotationMode
            || evolutionEpicRotationMode || evolutionRareCommonRotationMode || evolutionAllRarityRotationMode;
    }

    function _pickAvailableLand(uint256 randomWord) private view returns (uint8) {
        uint256 slotsRemaining = MAX_SUPPLY - totalLandsAssigned;
        if (slotsRemaining == 0) revert LandPoolEmpty();

        uint256 pick = randomWord % slotsRemaining;
        uint256 cumulative;
        for (uint8 land; land < LAND_COUNT; ++land) {
            cumulative += LAND_MAX_SUPPLY - landMinted[land];
            if (pick < cumulative) return land;
        }
        revert LandPoolEmpty();
    }

    function _emitMetadataRefresh() private {
        if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
    }
}
