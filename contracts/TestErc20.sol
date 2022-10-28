// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {

    constructor(uint _supply) ERC20("MyToken", "MTK") {
        _mint(msg.sender, _supply);
    }

}