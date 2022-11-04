// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    
    constructor(
        string memory _name,
        string memory _symble,
        uint256 _supply
    ) ERC20(_name, _symble) {
        _mint(msg.sender, _supply);
    }

}
