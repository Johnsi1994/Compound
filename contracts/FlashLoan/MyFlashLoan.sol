// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.17;

import "./FlashLoanReceiverBase.sol";
import "./ILendingPoolAddressesProvider.sol";
import "../CErc20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract MyFlashLoan is FlashLoanReceiverBase {
    // Uniswap
    ISwapRouter public immutable swapRouter;

    uint24 public constant poolFee = 3000;

    constructor(
        ILendingPoolAddressesProvider _addressProvider,
        ISwapRouter _swapRouter
    ) FlashLoanReceiverBase(_addressProvider) {
        swapRouter = ISwapRouter(_swapRouter);
    }

    function flashLoan(
        address[] memory assets,
        uint256[] memory amounts,
        uint256[] memory modes,
        address owner,
        address cUsdc,
        address cUni,
        address uni
    ) external {
        bytes memory params = abi.encode(owner, cUsdc, cUni, uni);

        LENDING_POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0
        );
    }

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        (address owner, address cUsdc, address cUni, address uni) = abi.decode(
            params,
            (address, address, address, address)
        );

        {
            address usdc = assets[0];
            uint256 repayAmount = amounts[0];

            IERC20(usdc).approve(address(cUsdc), repayAmount);

            CErc20(cUsdc).liquidateBorrow(owner, repayAmount, CErc20(cUni));

            CErc20(cUni).redeem(IERC20(cUni).balanceOf(address(this)));

            uint256 uniBalance = IERC20(uni).balanceOf(address(this));

            IERC20(uni).approve(address(swapRouter), uniBalance);

            ISwapRouter.ExactInputSingleParams
                memory uniSwapparams = ISwapRouter.ExactInputSingleParams({
                    tokenIn: uni,
                    tokenOut: usdc,
                    fee: poolFee,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: uniBalance,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                });

            swapRouter.exactInputSingle(uniSwapparams);
        }

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amountOwing = amounts[i] + premiums[i];
            IERC20(assets[i]).approve(address(LENDING_POOL), amountOwing);
        }

        return true;
    }
}
