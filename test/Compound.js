const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Compound", function () {
    const DECIMAL = 10n ** 18n;
    const MINT_AMOUNT = 100n * DECIMAL;

    const CORRECT_BORROW_AMOUNT = 50n * DECIMAL;
    const CLOSE_FACTOR = BigInt(0.5 * 1e18);
    const LIQUIDATION_INCENTIVE = BigInt(0.1 * 1e18);

    let owner, signer1

    const deployComptroller = async () => {
        const comptrollerFactory = await ethers.getContractFactory("Comptroller");
        const comptroller = await comptrollerFactory.deploy();
        await comptroller.deployed();

        return { comptroller }
    }

    const deploySimplePriceOracle = async () => {
        const priceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
        const simplePriceOracle = await priceOracleFactory.deploy();
        await simplePriceOracle.deployed();

        return { simplePriceOracle }
    }

    const deployInterestRateModel = async () => {
        const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
        const interestRateModel = await interestRateModelFactory.deploy(
            ethers.utils.parseUnits("0", 18),
            ethers.utils.parseUnits("0", 18),
        );
        await interestRateModel.deployed();

        return { interestRateModel }
    }

    async function deployErc20(name, symble) {
        const erc20Factory = await ethers.getContractFactory("TestERC20");
        const erc20 = await erc20Factory.deploy(
            name,
            symble,
            ethers.utils.parseUnits("1000000", 18)
        );
        await erc20.deployed();

        return { erc20 }
    }

    async function deployCErc20(erc20, comptroller, interestRateModel, name, symble) {
        const cErc20Factory = await ethers.getContractFactory("CErc20Immutable");
        const cErc20 = await cErc20Factory.deploy(
            erc20.address,
            comptroller.address,
            interestRateModel.address,
            ethers.utils.parseUnits("1", 18),
            name,
            symble,
            18,
            owner.address,
        );
        await cErc20.deployed();

        return { cErc20 }
    }

    const setupTokenA = async () => {
        const { erc20: erc20A } = await deployErc20("TokenA", "TKA");
        const { comptroller } = await loadFixture(deployComptroller);
        const { simplePriceOracle } = await loadFixture(deploySimplePriceOracle);
        const { interestRateModel } = await loadFixture(deployInterestRateModel);

        // set simplePriceOracle as price oracle
        await comptroller._setPriceOracle(simplePriceOracle.address);

        const { cErc20: cErc20A } =
            await deployCErc20(erc20A, comptroller, interestRateModel, "cTokenA", "cTKA")

        // add cTokenA to supportMarket
        await comptroller._supportMarket(cErc20A.address);

        return { erc20A, cErc20A, comptroller, simplePriceOracle, interestRateModel }
    }

    const setupTokenB = async () => {
        const { erc20A, cErc20A, comptroller, simplePriceOracle, interestRateModel } =
            await loadFixture(setupTokenA);

        const { erc20: erc20B } = await deployErc20("TokenB", "TKB");

        // deploy cTokenB
        const { cErc20: cErc20B } =
            await deployCErc20(erc20B, comptroller, interestRateModel, "cTokenB", "cTKB")

        // add cTokenB to supportMarket
        await comptroller._supportMarket(cErc20B.address);

        // set tokenA's price as 1$
        await simplePriceOracle.setUnderlyingPrice(cErc20A.address, 1n * DECIMAL);

        // set tokenB's price as 100$
        await simplePriceOracle.setUnderlyingPrice(cErc20B.address, 100n * DECIMAL);

        // set tokenB's collateral factor as 50%
        await comptroller._setCollateralFactor(cErc20B.address, BigInt(0.5 * 1e18));

        // set cTokenB as collateral
        await comptroller.enterMarkets([cErc20B.address]);

        // supply tokenA
        const supplyAmount = 1000n * DECIMAL
        await erc20A.connect(signer1).mint(supplyAmount);
        await erc20A.connect(signer1).approve(cErc20A.address, supplyAmount);
        await cErc20A.connect(signer1).mint(supplyAmount);

        // mint tokenB
        const tokenBAmount = 1n * DECIMAL;
        await erc20B.approve(cErc20B.address, tokenBAmount);
        await cErc20B.mint(tokenBAmount);

        return { erc20A, cErc20A, erc20B, cErc20B, comptroller, simplePriceOracle, interestRateModel }
    }

    const borrowTokenA = async () => {
        const { erc20A, cErc20A, erc20B, cErc20B, comptroller, simplePriceOracle, interestRateModel } =
            await loadFixture(setupTokenB);

        await cErc20A.borrow(CORRECT_BORROW_AMOUNT)

        return { erc20A, cErc20A, erc20B, cErc20B, comptroller, simplePriceOracle, interestRateModel }
    }

    const setupLiquidate = async () => {
        const { erc20A, cErc20A, erc20B, cErc20B, comptroller, simplePriceOracle, interestRateModel } =
            await loadFixture(borrowTokenA);

        // set close factor to 50%
        await comptroller._setCloseFactor(CLOSE_FACTOR)

        // set liquidation incentive to 10%
        await comptroller._setLiquidationIncentive(LIQUIDATION_INCENTIVE)

        return { erc20A, cErc20A, erc20B, cErc20B, comptroller, simplePriceOracle, interestRateModel }
    }

    before(async () => {
        [owner, signer1] = await ethers.getSigners();
    });

    describe("Test mint & redeem", async () => {

        it("assert mint success", async function () {
            const { erc20A, cErc20A } = await loadFixture(setupTokenA);

            // approve cErc20A address and mint
            await erc20A.approve(cErc20A.address, MINT_AMOUNT);
            await cErc20A.mint(MINT_AMOUNT);

            // cErc20's erc20A increase
            expect(await erc20A.balanceOf(cErc20A.address)).to.equal(MINT_AMOUNT);

            // owner's cErc20A increase
            expect(await cErc20A.balanceOf(owner.address)).to.equal(MINT_AMOUNT);
        });

        it("assert redeem success", async function () {
            const { erc20A, cErc20A } = await loadFixture(setupTokenA);

            // approve cErc20A address and mint
            await erc20A.approve(cErc20A.address, MINT_AMOUNT);
            await cErc20A.mint(MINT_AMOUNT);

            // redeem
            await cErc20A.redeem(MINT_AMOUNT);

            // cErc20's erc20A decrease
            expect(await erc20A.balanceOf(cErc20A.address)).to.equal(0);

            // owner's cErc20A decrease
            expect(await cErc20A.balanceOf(owner.address)).to.equal(0);
        });
    })



    describe("Test borrow and repay", async () => {

        it("assert borrow failed, revert as BorrowComptrollerRejection INSUFFICIENT_SHORTFALL", async () => {
            const BORROW_AMOUNT = 60n * DECIMAL;
            const { cErc20A } = await loadFixture(setupTokenB);

            await expect(cErc20A.borrow(BORROW_AMOUNT)).to.be
                .revertedWithCustomError(cErc20A, 'BorrowComptrollerRejection')
                .withArgs(4);
        });

        it("assert borrow success ", async () => {
            const { erc20A, cErc20A } = await loadFixture(setupTokenB);

            await expect(cErc20A.borrow(CORRECT_BORROW_AMOUNT)).to
                .changeTokenBalances(
                    erc20A,
                    [owner, cErc20A],
                    [CORRECT_BORROW_AMOUNT, -CORRECT_BORROW_AMOUNT],
                );
        });

        it("assert repay failed, revert as ERC20: insufficient allowance", async () => {
            const { cErc20A } = await loadFixture(borrowTokenA);

            await expect(cErc20A.repayBorrow(CORRECT_BORROW_AMOUNT)).to.be
                .revertedWith("ERC20: insufficient allowance")
        });

        it("assert repay failed, revert as repay overflowed", async () => {
            const REPAY_BORROW_AMOUNT = 100n * DECIMAL;
            const { erc20A, cErc20A } = await loadFixture(borrowTokenA);

            await erc20A.approve(cErc20A.address, REPAY_BORROW_AMOUNT);
            await expect(cErc20A.repayBorrow(REPAY_BORROW_AMOUNT)).to.be.revertedWithPanic(0x11)
        });

        it("assert repay success", async () => {
            const { erc20A, cErc20A } = await loadFixture(borrowTokenA);

            await erc20A.approve(cErc20A.address, CORRECT_BORROW_AMOUNT);
            await expect(cErc20A.repayBorrow(CORRECT_BORROW_AMOUNT)).to
                .changeTokenBalances(
                    erc20A,
                    [owner, cErc20A],
                    [-CORRECT_BORROW_AMOUNT, CORRECT_BORROW_AMOUNT],
                );
        });
    })



    describe("Test liquidate: change collateral factor", async () => {
        const NEW_COLLATERA_FACTOR = BigInt(0.3 * 1e18);

        it("assert shortfall greater then 0 after set new collateral factor", async () => {
            const { cErc20B, comptroller } = await loadFixture(setupLiquidate);

            // set collateral factor as 30%
            await comptroller._setCollateralFactor(cErc20B.address, NEW_COLLATERA_FACTOR)

            let market = await comptroller.markets(cErc20B.address);
            expect(market.collateralFactorMantissa).to.eq(NEW_COLLATERA_FACTOR);

            const results = await comptroller.getAccountLiquidity(owner.address)
            const shortfall = BigInt(results[2])
            expect(shortfall).to.gt(0)
        });

        it("assert signer1 repay cErc20A for owner success", async () => {
            const { erc20A, cErc20A, cErc20B, comptroller } = await loadFixture(setupLiquidate);
            await comptroller._setCollateralFactor(cErc20B.address, NEW_COLLATERA_FACTOR)

            const results = await comptroller.getAccountLiquidity(owner.address)
            const repayAmount = BigInt(results[2]) * CLOSE_FACTOR / DECIMAL

            await erc20A.connect(signer1).mint(repayAmount);
            await erc20A.connect(signer1).approve(cErc20A.address, repayAmount);

            await expect(
                cErc20A
                    .connect(signer1)
                    .liquidateBorrow(owner.address, repayAmount, cErc20B.address),
            )
                .to.changeTokenBalances(
                    erc20A,
                    [cErc20A, signer1],
                    [repayAmount, -repayAmount],
                )
        })

    })



    describe("Test liquidate: change price", async () => {

        it("assert signer1 repay cErc20A for owner success", async () => {
            const { erc20A, cErc20A, cErc20B, comptroller, simplePriceOracle } = await loadFixture(setupLiquidate);

            // change cErc20B price
            await simplePriceOracle.setUnderlyingPrice(cErc20B.address, 50n * DECIMAL);

            const results = await comptroller.getAccountLiquidity(owner.address)
            const shortfall = BigInt(results[2])

            const repayAmount = shortfall * CLOSE_FACTOR / DECIMAL

            await erc20A.connect(signer1).mint(repayAmount);
            await erc20A.connect(signer1).approve(cErc20A.address, repayAmount);

            await expect(
                cErc20A
                    .connect(signer1)
                    .liquidateBorrow(owner.address, repayAmount, cErc20B.address),
            )
                .to.changeTokenBalances(
                    erc20A,
                    [cErc20A, signer1],
                    [repayAmount, -repayAmount],
                )
        });
    })
});