// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title Eggoria Birds
/// @notice A 500-item evolving ERC-721 collection distributed evenly across five lands.
/// @dev Rarity randomness is fulfilled by a dedicated role. Assign RANDOMIZER_ROLE to a
///      verifiable-randomness adapter before using this contract in production.
contract EggoriaBirds is ERC721, AccessControl {
    uint256 public constant MAX_SUPPLY = 500;
    uint8 public constant LAND_COUNT = 5;
    uint16 public constant LAND_MAX_SUPPLY = 100;
    uint8 public constant INTERMEDIATE_CHECK_INS = 10;
    uint8 public constant ADVANCED_CHECK_INS = 20;

    bytes32 public constant METADATA_ROLE = keccak256("METADATA_ROLE");
    bytes32 public constant RANDOMIZER_ROLE = keccak256("RANDOMIZER_ROLE");

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
    uint8 public evolutionTestLand; // First land in the five-mint QA rotation.
    Rarity public evolutionTestRarity = Rarity.Legendary;

    mapping(address account => bool minted) public hasMinted;
    mapping(address account => uint256 tokenId) public mintedTokenOf;
    mapping(uint256 tokenId => Bird bird) public birds;
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
    error EvolutionAlreadyComplete();
    error RarityNotRequested();
    error RarityAlreadyAssigned();
    error RarityPoolEmpty();
    error InvalidTestCheckIns();

    event LandRequested(uint256 indexed tokenId, address indexed owner);
    event BirdMinted(uint256 indexed tokenId, address indexed owner, uint8 indexed land);
    event BirdCheckedIn(uint256 indexed tokenId, uint8 checkIns, uint64 day);
    event BirdEvolved(uint256 indexed tokenId, Stage stage);
    event RarityRequested(uint256 indexed tokenId, address indexed owner);
    event RarityAssigned(uint256 indexed tokenId, Rarity rarity, uint256 randomWord);
    event MintingStatusChanged(bool enabled);
    event EvolutionTestModeChanged(bool enabled);
    event EvolutionShowcaseModeChanged(bool enabled);
    event EvolutionPairRotationModeChanged(bool enabled);
    event EvolutionTestLandChanged(uint8 indexed land);
    event EvolutionTestRarityChanged(Rarity rarity);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event TestBirdSeeded(uint256 indexed tokenId, address indexed owner, uint8 indexed land, uint8 checkIns);

    constructor(address initialAdmin) ERC721("Eggoria Birds", "EGBIRD") {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(METADATA_ROLE, initialAdmin);
        _grantRole(RANDOMIZER_ROLE, initialAdmin);

        for (uint8 land; land < LAND_COUNT; ++land) {
            _landRarityRemaining[land] = [uint16(60), 25, 10, 4, 1];
            _landRarityPoolRemaining[land] = LAND_MAX_SUPPLY;
        }
    }

    /// @notice Mints one bird with its land pending secure random fulfillment.
    function mint() external returns (uint256 tokenId) {
        if (!mintingEnabled) revert MintingDisabled();
        if (totalMinted >= MAX_SUPPLY) revert MaxSupplyReached();
        if (hasMinted[msg.sender]) revert WalletAlreadyMinted();

        tokenId = ++totalMinted;
        hasMinted[msg.sender] = true;
        mintedTokenOf[msg.sender] = tokenId;

        uint8 testLand;
        if (evolutionTestMode) {
            if (evolutionPairRotationMode) {
                testLand = uint8(((tokenId - 1) / 2) % LAND_COUNT);
            } else if (evolutionShowcaseMode && tokenId <= 12) {
                testLand = uint8((tokenId - 1) / 3 + 1);
            } else {
                testLand = uint8((uint256(evolutionTestLand) + (tokenId - 1) / 5) % LAND_COUNT);
            }
            if (landMinted[testLand] >= LAND_MAX_SUPPLY) revert LandPoolEmpty();
            Bird storage bird = birds[tokenId];
            bird.land = testLand;
            bird.landAssigned = true;
            bird.checkIns = INTERMEDIATE_CHECK_INS - 1;
            landMinted[testLand] += 1;
            totalLandsAssigned += 1;
        }

        _safeMint(msg.sender, tokenId);
        if (evolutionTestMode) {
            emit BirdMinted(tokenId, msg.sender, testLand);
            emit MetadataUpdate(tokenId);
        } else {
            emit LandRequested(tokenId, msg.sender);
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

    /// @notice Assigns a land by selecting one of all remaining land inventory slots.
    /// @dev The caller must be a trusted secure-randomness adapter with RANDOMIZER_ROLE.
    function fulfillLand(uint256 tokenId, uint256 randomWord) external onlyRole(RANDOMIZER_ROLE) {
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

    /// @notice Records one check-in per UTC day and evolves at check-ins 10 and 20.
    function checkIn(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        Bird storage bird = birds[tokenId];
        if (!bird.landAssigned) revert LandNotAssigned();
        if (bird.checkIns >= ADVANCED_CHECK_INS) revert EvolutionAlreadyComplete();

        uint64 today = uint64(block.timestamp / 1 days);
        if (bird.lastCheckInDay == today) revert AlreadyCheckedInToday();

        bird.lastCheckInDay = today;
        bird.checkIns += 1;
        emit BirdCheckedIn(tokenId, bird.checkIns, today);

        if (bird.checkIns == INTERMEDIATE_CHECK_INS) {
            bird.stage = Stage.Intermediate;
            emit BirdEvolved(tokenId, Stage.Intermediate);
            emit MetadataUpdate(tokenId);
            if (evolutionTestMode) {
                // QA mode skips the waiting period between evolution stages while
                // preserving the real 10-check-in progression when the mode is off.
                bird.checkIns = ADVANCED_CHECK_INS - 1;
                bird.lastCheckInDay = 0;
            }
        } else if (bird.checkIns == ADVANCED_CHECK_INS) {
            emit RarityRequested(tokenId, msg.sender);
            if (evolutionTestMode) {
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
            }
        }
    }

    /// @notice Assigns rarity and atomically completes the bird's final evolution.
    /// @dev Each land has its own shrinking 60/25/10/4/1 weighted pool.
    function fulfillRarity(uint256 tokenId, uint256 randomWord) external onlyRole(RANDOMIZER_ROLE) {
        ownerOf(tokenId);
        _fulfillRarity(tokenId, randomWord);
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

    /// @notice Makes newly minted testnet birds immediately land-assigned at check-in 9.
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
