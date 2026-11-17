// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// VINTrust prototype: one NFT ("Vehicle Passport") per car.
// Built on the class example MyNFT.sol (ERC721 + Ownable from OpenZeppelin).
//
// Roles:
//   owner of this contract = the VINTrust association (account 0)
//   approved garages       = organisations whose SSI credential was verified
//   token holder           = the current car owner (e.g. Marco, later Milo)

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract VehiclePassport is ERC721, Ownable {
    // One entry in the car's history. The full document (invoice, report,
    // photos) is stored off-chain in IPFS; only its CID is stored here.
    struct Record {
        address garage;        // who wrote the record
        uint256 mileage;       // km at the time of the record
        uint8 batteryHealth;   // EV battery state of health in %
        string recordType;     // e.g. "SERVICE", "ACCIDENT", "INSPECTION"
        string ipfsCid;        // IPFS content id of the document
        uint256 timestamp;     // block time when the record was added
    }

    uint256 private _nextTokenId = 1;                 // start at 1, so 0 means "no passport"
    mapping(bytes32 => uint256) public tokenIdOfVin;  // hash of VIN => token id
    mapping(address => bool) public approvedGarages;  // garages allowed to write
    mapping(uint256 => Record[]) private _records;    // token id => history

    event PassportMinted(uint256 indexed tokenId, bytes32 indexed vinHash, address owner);
    event GarageApproved(address indexed garage, bool approved);
    event RecordAdded(uint256 indexed tokenId, address indexed garage, uint256 mileage, string ipfsCid);

    constructor() ERC721("VINTrust Vehicle Passport", "VPASS") Ownable(msg.sender) {}

    // Association: create the passport for a car. Only one passport per VIN.
    function mintPassport(address carOwner, bytes32 vinHash) public onlyOwner returns (uint256) {
        require(tokenIdOfVin[vinHash] == 0, "Passport for this VIN already exists");
        uint256 tokenId = _nextTokenId++;
        tokenIdOfVin[vinHash] = tokenId;
        _safeMint(carOwner, tokenId);
        emit PassportMinted(tokenId, vinHash, carOwner);
        return tokenId;
    }

    // Association: allow / revoke a garage after checking its SSI credential.
    function setGarageApproval(address garage, bool approved) public onlyOwner {
        approvedGarages[garage] = approved;
        emit GarageApproved(garage, approved);
    }

    // Garage: append a record. Records are never changed or deleted.
    function addRecord(
        uint256 tokenId,
        uint256 mileage,
        uint8 batteryHealth,
        string memory recordType,
        string memory ipfsCid
    ) public {
        require(approvedGarages[msg.sender], "Not an approved garage");
        require(_ownerOf(tokenId) != address(0), "Passport does not exist");
        require(batteryHealth <= 100, "Battery health must be 0-100");

        Record[] storage history = _records[tokenId];
        if (history.length > 0) {
            // simple odometer-fraud check: mileage can never go down
            require(mileage >= history[history.length - 1].mileage, "Mileage lower than last record");
        }

        history.push(Record(msg.sender, mileage, batteryHealth, recordType, ipfsCid, block.timestamp));
        emit RecordAdded(tokenId, msg.sender, mileage, ipfsCid);
    }

    // Anyone (e.g. a buyer): read the full history of a car.
    function getRecords(uint256 tokenId) public view returns (Record[] memory) {
        return _records[tokenId];
    }
}
