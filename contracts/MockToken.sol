// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockToken
 * @dev Simple mintable ERC20 token for testing purposes
 */
contract MockToken is ERC20, Ownable {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimalPlaces
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimalPlaces;
        
        // Mint initial supply to deployer for convenience
        _mint(msg.sender, 1_000_000 * 10 ** decimalPlaces);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mint tokens for testing
     * @param to The address to receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @dev For testing purposes, automatically extends allowance instead of reverting
    /// when there is not enough allowance for transferFrom. This makes it easier to
    /// write tests that focus on AMM logic without worrying about ERC20 allowance edge cases.
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        uint256 currentAllowance = allowance(from, _msgSender());

        if (currentAllowance < amount) {
            _approve(from, _msgSender(), type(uint256).max);
        }

        return super.transferFrom(from, to, amount);
    }
}