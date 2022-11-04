const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Compound", function () {
    const DECIMAL = 10n ** 18n;
    const MINT_AMOUNT = 100n * DECIMAL;

    let owner, signer1
    let erc20Factory, cErc20Factory, erc20A, cErc20A, erc20B, cErc20B
    let comptroller, simplePriceOracle, interestRateModel

    it("get signers", async function () {
        [owner, signer1] = await ethers.getSigners();
    })

    describe("Deploy", async () => {
        it("deploy erc20A", async function () {
            erc20Factory = await ethers.getContractFactory("TestERC20");
            erc20A = await erc20Factory.deploy(
                "TokenA",
                "TKA",
                ethers.utils.parseUnits("1000000", 18)
            );
            await erc20A.deployed();
        })

        it("deploy comptroller", async function () {
            const comptrollerFactory = await ethers.getContractFactory("Comptroller");
            comptroller = await comptrollerFactory.deploy();
            await comptroller.deployed();
        })

        it("deploy simplePriceOracle", async function () {
            const priceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
            simplePriceOracle = await priceOracleFactory.deploy();
            await simplePriceOracle.deployed();
        })

        it("deploy interest rate model", async function () {
            const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
            interestRateModel = await interestRateModelFactory.deploy(
                ethers.utils.parseUnits("0", 18),
                ethers.utils.parseUnits("0", 18),
            );
            await interestRateModel.deployed();
        })

        it("deploy cErc20A", async function () {
            cErc20Factory = await ethers.getContractFactory("CErc20Immutable");
            cErc20A = await cErc20Factory.deploy(
                erc20A.address,
                comptroller.address,
                interestRateModel.address,
                ethers.utils.parseUnits("1", 18),
                "cTokenA",
                "cTKA",
                18,
                owner.address,
            );
            await cErc20A.deployed();
        })
    })

    describe("Settings", async () => {
        it("setup SimplePriceOracle to Comptroller", async function () {
            await comptroller._setPriceOracle(simplePriceOracle.address);
        })

        it("setup supportMarket to Comptroller", async function () {
            await comptroller._supportMarket(cErc20A.address);
        })
    })

    describe("Test mint and redeem", async () => {
        it("Test mint", async function () {
            // approve cErc20A address and mint
            await erc20A.approve(cErc20A.address, MINT_AMOUNT);
            await cErc20A.mint(MINT_AMOUNT);

            // cErc20's erc20A increase
            expect(await erc20A.balanceOf(cErc20A.address)).to.equal(MINT_AMOUNT);

            // owner's cErc20A increase
            expect(await cErc20A.balanceOf(owner.address)).to.equal(MINT_AMOUNT);
        });

        it("Test redeem", async function () {
            // redeem
            await cErc20A.redeem(MINT_AMOUNT);

            // cErc20's erc20A decrease
            expect(await erc20A.balanceOf(cErc20A.address)).to.equal(0);

            // owner's cErc20A decrease
            expect(await cErc20A.balanceOf(owner.address)).to.equal(0);
        });
    })

    describe("Test borrow and repay", async () => {
        describe("deploy erc20B and cErc20B", async () => {
            it("deploy erc20B", async function () {
                erc20B = await erc20Factory.deploy(
                    "TokenB",
                    "TKB",
                    ethers.utils.parseUnits("1000000", 18)
                );
                await erc20B.deployed();
            })

            it("deploy cErc20B", async function () {
                cErc20B = await cErc20Factory.deploy(
                    erc20B.address,
                    comptroller.address,
                    interestRateModel.address,
                    ethers.utils.parseUnits("1", 18),
                    "cTokenB",
                    "cTKB",
                    18,
                    owner.address,
                );
                await cErc20B.deployed();
            })
        })

        describe("Settings", async () => {
            it("setup cErc20B to supportMarket", async function () {
                await comptroller._supportMarket(cErc20B.address);
            })

            it("setup underlying price", async function () {
                // set tokenA's price as 1$
                await simplePriceOracle.setUnderlyingPrice(cErc20A.address, 1n * DECIMAL);

                // set tokenB's price as 100$
                await simplePriceOracle.setUnderlyingPrice(cErc20B.address, 100n * DECIMAL);
            })

            it("setup collateral factor", async function () {
                // set tokenB's collateral factor as 0.5
                await comptroller._setCollateralFactor(cErc20B.address, BigInt(0.5 * 1e18));
            })

            it("enter ctokenB to markets", async () => {
                // set cErc20B as collateral
                await comptroller.enterMarkets([cErc20B.address]);
            });

            it("supply erc20A", async () => {
                const supplyAmount = 1000n * DECIMAL
                await erc20A.connect(signer1).mint(supplyAmount);
                await erc20A.connect(signer1).approve(cErc20A.address, supplyAmount);
                await cErc20A.connect(signer1).mint(supplyAmount);
            })

            it("mint erc20B", async () => {
                const tokenBAmount = 1n * DECIMAL;
                await erc20B.approve(cErc20B.address, tokenBAmount);
                await cErc20B.mint(tokenBAmount);
            })
        })

        describe("test", async () => {
            const CORRECT_BORROW_AMOUNT = 50n * DECIMAL; 

            it("assert borrow failed, revert as BorrowComptrollerRejection INSUFFICIENT_SHORTFALL", async () => {
                const BORROW_AMOUNT = 60n * DECIMAL;

                await expect(cErc20A.borrow(BORROW_AMOUNT)).to.be
                    .revertedWithCustomError(cErc20A, 'BorrowComptrollerRejection')
                    .withArgs(4);
            });

            it("assert borrow success ", async () => {
                await expect(cErc20A.borrow(CORRECT_BORROW_AMOUNT)).to
                    .changeTokenBalances(
                        erc20A,
                        [owner, cErc20A],
                        [CORRECT_BORROW_AMOUNT, -CORRECT_BORROW_AMOUNT],
                    );
            });

            it("assert repay failed, revert as ERC20: insufficient allowance", async () => {
                await expect(cErc20A.repayBorrow(CORRECT_BORROW_AMOUNT)).to.be
                    .revertedWith("ERC20: insufficient allowance")
            });

            it("assert repay failed, revert as repay overflowed", async () => {
                const REPAY_BORROW_AMOUNT = 100n * DECIMAL;
                await erc20A.approve(cErc20A.address, REPAY_BORROW_AMOUNT);
                await expect(cErc20A.repayBorrow(REPAY_BORROW_AMOUNT)).to.be.revertedWithPanic(0x11)
            });

            it("assert repay success", async () => {
                await erc20A.approve(cErc20A.address, CORRECT_BORROW_AMOUNT);
                await expect(cErc20A.repayBorrow(CORRECT_BORROW_AMOUNT)).to
                    .changeTokenBalances(
                        erc20A,
                        [owner, cErc20A],
                        [-CORRECT_BORROW_AMOUNT, CORRECT_BORROW_AMOUNT],
                    );
            });
        })
    })
});